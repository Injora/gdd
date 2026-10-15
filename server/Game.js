// One running match. The server owns the game state (phase, Hearts, props,
// channelled interactions, bots). Clients predict their own movement, which
// the server bounds-checks and corrects. See ARCHITECTURE.md.

import { performance } from 'node:perf_hooks';
import { generateMansion, publicMap } from '../shared/mapgen.js';
import { createCollisionWorld, overlapsSolid } from '../shared/collision.js';
import {
  PHASE, CHANNEL, INTERACT_RANGE, TICK_RATE, SPEED, HEART_COUNT, TILE, TILE_WALL, PLAYER_RADIUS, HP,
} from '../shared/constants.js';
import { DECOY_LINES, TOME_TEXT } from '../shared/lore.js';
import { PROP_LABELS } from '../shared/propdefs.js';
import { WIZARD_BY_ID, ULT } from '../shared/wizards.js';
import { Bot } from './Bot.js';
import { SpellSystem } from './SpellSystem.js';
import { TrainingHusk } from './TrainingHusk.js';
import { Monster } from './Monster.js';
import { Finale } from './Finale.js';
import { FINALE } from '../shared/finale.js';

const FINALE_BOSS_HP = FINALE.BOSS_HP;
import { botName } from './names.js';

const GATE_OPEN_TIME = 6;
const CAPTURE_DELAY = 0.9; // the victim's jumpscare plays before the teleport
const PING_COOLDOWN = 3;
const DEBUG_MODES = ['husk', 'haunt', 'stalk', 'hunt', 'capture', 'auto'];

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

export class Game {
  constructor(io, lobby, onEnd) {
    this.io = io;
    this.lobby = lobby;
    this.room = lobby.room;
    this.onEnd = onEnd;
    this.seed = Number.isInteger(lobby.seed) ? lobby.seed >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    this.map = generateMansion(this.seed);
    this.clientMap = publicMap(this.map);
    this.props = this.map.props;
    this.heartByProp = new Map(this.map.hearts.map((h) => [h.propId, h]));
    this.propState = {}; // propId -> { open?, destroyed? }
    this.world = createCollisionWorld(this.map, (prop) => !this.propState[prop.id]?.open);

    this.phase = PHASE.TOME;
    this.tomeReadBy = null;
    this.destroyed = new Set();
    this.time = 0;
    this.gateCloseAt = 0;
    this.cooldownScale = 1; // the Archon (Step 5) casts at ARCHON_COOLDOWN_SCALE
    this.spells = new SpellSystem(this);
    this.husk = null; // debug Training Husk
    this.phaseBefore = null; // phase to restore on "Retry" after a game over
    this.flood = null; // Abyssal Deluge: { until, slow }
    this.dawn = null; // Dawn of the Sacred Order: { until }
    this.debugModeIdx = -1;

    this.players = new Map();
    this.bots = [];
    lobby.members.forEach((m, i) => {
      const sp = this.map.spawn.points[i % this.map.spawn.points.length];
      const p = {
        id: m.id,
        name: m.name,
        wizardId: m.wizardId,
        isBot: m.isBot,
        x: sp.x,
        z: sp.z,
        floor: this.map.spawn.floor,
        yaw: this.map.spawn.yaw,
        pitch: 0,
        crouch: false,
        sprint: false,
        light: true,
        moving: false,
        tseq: 0,
        lastStateAt: Date.now(),
        channel: null,
        cooldowns: {},
        shieldUntil: 0,
        hp: HP.MAX,
        ult: 0, // Ultimate charge 0–100
        buffs: {},
        lastHurtAt: -Infinity,
        captured: false, // held in the Basement Ritual Cell
        capturing: 0, // game time at which the jumpscare ends and the teleport happens
        noiseAt: 0,
        pingAt: 0,
      };
      this.players.set(m.id, p);
      if (m.isBot) this.bots.push(new Bot(this, p, this.bots.length));
    });
    this.monster = new Monster(this);
    this.finale = new Finale(this);
  }

  // --- lifecycle -----------------------------------------------------------

  start() {
    for (const p of this.players.values()) {
      if (!p.isBot) this.socketOf(p)?.emit('game:start', this.initPayload(p.id));
    }
    this.lastTick = performance.now();
    this.interval = setInterval(() => this.tick(), 1000 / TICK_RATE);
    console.log(`[game ${this.room}] started, seed ${this.seed}, ${this.players.size} wizards`);
  }

  stop() {
    clearInterval(this.interval);
    this.interval = null;
  }

  end() {
    this.stop();
    this.onEnd?.();
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.emitAll({ type: 'left', id, name: p.name });
  }

  // --- networking helpers --------------------------------------------------

  socketOf(p) { return this.io.sockets.sockets.get(p.id); }
  emitAll(event) { this.io.to(this.room).emit('game:event', event); }
  whisper(p, text) { if (!p.isBot) this.socketOf(p)?.emit('game:event', { type: 'whisper', text }); }

  roster() {
    return [...this.players.values()].map(({ id, name, wizardId, isBot }) => ({ id, name, wizardId, isBot }));
  }

  tomeInfo() {
    return {
      by: this.tomeReadBy,
      text: TOME_TEXT,
      hearts: this.map.hearts.map(({ id, type, name, propId, clue }) => ({ id, type, name, propId, clue })),
    };
  }

  initPayload(selfId) {
    return {
      selfId,
      seed: this.seed,
      map: this.clientMap,
      players: this.roster(),
      phase: this.phase,
      destroyed: [...this.destroyed],
      propState: this.propState,
      tome: this.tomeReadBy ? this.tomeInfo() : null,
      barriers: this.spells.activeBarriers(),
    };
  }

  /** Every hostile body in the game, visible or not. */
  bodies() {
    return [this.husk, this.monster].filter(Boolean);
  }

  /** Hostile bodies spells can currently hit. */
  monsters() {
    return this.bodies().filter((m) => m.targetable);
  }

  prisoners() {
    return [...this.players.values()].filter((p) => p.captured);
  }

  snapshot() {
    return {
      t: r3(this.time),
      phase: this.phase,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        x: r2(p.x),
        z: r2(p.z),
        f: p.floor,
        yaw: r3(p.yaw),
        pitch: r3(p.pitch),
        cr: p.crouch,
        sp: p.sprint,
        li: p.light,
        mv: p.moving,
        ch: p.channel?.propId ?? null,
        sh: this.spells.isShielded(p),
        cap: p.captured,
        cg: !!p.capturing,
        hp: Math.ceil(p.hp),
        u: Math.floor(p.ult),
        bf: this.spells.buffCodes(p),
      })),
      monsters: this.bodies().map((m) => m.snapshot()),
      prj: this.spells.snapshotProjectiles(),
      ents: this.spells.snapshotEntities(),
      fin: this.finale.snapshot(),
      fl: this.flood && this.time < this.flood.until ? r2(this.flood.until - this.time) : 0,
      dw: this.dawn && this.time < this.dawn.until ? r2(this.dawn.until - this.time) : 0,
    };
  }

  // --- simulation ----------------------------------------------------------

  tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.step(dt);
  }

  /** Advance the simulation by dt seconds and broadcast a snapshot. */
  step(dt) {
    this.time += dt;
    for (const bot of this.bots) if (this.players.has(bot.p.id)) bot.update(dt, this.time);
    for (const m of this.bodies()) m.update(dt);
    this.spells.update(dt);
    this.finale.update(dt);
    this.updateVitals(dt);
    for (const p of this.players.values()) if (p.channel) this.updateChannel(p);
    this.updateCaptures();
    this.updateGate();
    this.io.to(this.room).emit('game:snap', this.snapshot());
  }

  insideWall(floor, x, z) {
    const f = this.map.floors[floor];
    const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
    if (tx < 0 || ty < 0 || tx >= f.w || ty >= f.h) return true;
    return f.tiles[ty * f.w + tx] === TILE_WALL;
  }

  onPlayerState(id, d) {
    const p = this.players.get(id);
    if (!p || p.isBot || !d) return;
    if (this.finale.active && this.finale.onPlayerState(p, d)) return; // one body: the Archon
    if (d.tseq !== p.tseq || p.capturing) return; // stale, or frozen in a jumpscare
    const x = Number(d.x), z = Number(d.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    const now = Date.now();
    const dt = Math.max(0.05, (now - p.lastStateAt) / 1000);
    const moved = Math.hypot(x - p.x, z - p.z);
    // Speed buffs (Shadow Step, Phoenix Aura, Tailwind) raise the allowance.
    const boost = 1 + (this.spells.hasBuff(p, 'shadow') ? 0.4 : 0) + (this.spells.hasBuff(p, 'phoenix') ? 0.3 : 0) +
      (this.spells.hasBuff(p, 'tailwind') ? 0.45 : 0);
    if (moved > SPEED.sprint * 1.5 * boost * dt + 0.75 || this.insideWall(p.floor, x, z)) {
      this.teleport(p, p.x, p.z, p.floor, p.yaw);
      return;
    }
    p.x = x;
    p.z = z;
    p.lastStateAt = now;
    p.yaw = finite(Number(d.yaw), p.yaw);
    p.pitch = Math.max(-1.5, Math.min(1.5, finite(Number(d.pitch), 0)));
    p.crouch = !!d.cr;
    p.sprint = !!d.sp;
    p.light = !!d.li;
    p.moving = !!d.mv;
    if (p.sprint && p.moving && this.time >= p.noiseAt) {
      p.noiseAt = this.time + 0.5;
      this.noise(p, 10, 'sprint');
    }
  }

  /** Something loud happened at player p. `radius` = how far it carries. */
  noise(p, radius, kind) {
    for (const m of this.bodies()) m.hear?.(p, radius, kind);
  }

  teleport(p, x, z, floor, yaw) {
    p.x = x;
    p.z = z;
    p.floor = floor;
    p.yaw = yaw;
    p.tseq++;
    p.lastStateAt = Date.now();
    if (p.channel) this.cancelChannel(p);
    if (!p.isBot) this.socketOf(p)?.emit('game:teleport', { x, z, floor, yaw, tseq: p.tseq });
  }

  // --- interactions --------------------------------------------------------

  inRange(p, prop, slack) {
    return p.floor === prop.floor && Math.hypot(p.x - prop.x, p.z - prop.z) <= INTERACT_RANGE + slack;
  }

  onInteract(id, propId, entityId) {
    const p = this.players.get(id);
    if (entityId !== undefined && entityId !== null) {
      if (p && !p.capturing) this.spells.useEntity(p, entityId);
      return;
    }
    const prop = this.props[propId];
    if (!p || p.capturing || !prop?.interact || prop.floor !== p.floor) return;
    if (!this.inRange(p, prop, 0.75)) return this.whisper(p, 'You need to be closer.');

    switch (prop.interact) {
      case 'tome':
        if (this.tomeReadBy) this.socketOf(p)?.emit('game:event', { type: 'journal' });
        else this.startChannel(p, prop, CHANNEL.tome);
        break;

      case 'curio': {
        const heart = this.heartByProp.get(prop.id);
        if (heart && this.destroyed.has(prop.id)) {
          this.whisper(p, 'Silent now. Only ash and cold remain.');
        } else if (heart && this.phase === PHASE.TOME) {
          this.whisper(p, 'Something beneath the surface throbs against your palm. You do not yet know how to silence it.');
        } else if (heart) {
          this.startChannel(p, prop, CHANNEL.heart);
        } else {
          const line = DECOY_LINES[Math.floor(Math.random() * DECOY_LINES.length)];
          this.whisper(p, line.replace('{name}', `the ${PROP_LABELS[prop.kind] ?? prop.kind}`));
          this.noise(p, 8, 'decoy'); // rattling heirlooms draws attention
        }
        break;
      }

      case 'stairs':
        this.useStairs(p, prop);
        break;

      case 'altar':
        if (this.phase === PHASE.TOME) {
          this.whisper(p, 'Dried blood in the shape of a hand. The altar is waiting for something.');
        } else if (this.phase === PHASE.HEARTS) {
          const left = HEART_COUNT - this.destroyed.size;
          this.whisper(p, `The altar hungers. ${left} heart${left === 1 ? '' : 's'} still beat${left === 1 ? 's' : ''}.`);
        } else if (this.phase === PHASE.CONVERGENCE) {
          // The Forbidden Spell: hold E here, all of you together.
          this.startChannel(p, prop, Infinity);
          const missing = [...this.players.values()].filter((o) => !this.finale.chanting(o) && o !== p).length;
          if (missing) this.whisper(p, `You begin the Forbidden Spell. ${missing} more voice${missing === 1 ? '' : 's'} must join the chant.`);
        }
        break;

      case 'gate':
        if (this.propState[prop.id]?.open) this.whisper(p, 'The gate hangs open. It will not stay that way.');
        else this.startChannel(p, prop, CHANNEL.gate / (WIZARD_BY_ID[p.wizardId]?.passive?.gateUnlockSpeed ?? 1));
        break;
    }
  }

  onCancel(id) {
    const p = this.players.get(id);
    if (p?.channel) this.cancelChannel(p);
  }

  startChannel(p, prop, duration) {
    if (p.channel?.propId === prop.id) return;
    p.channel = { propId: prop.id, start: this.time, duration };
    if (!p.isBot) this.socketOf(p)?.emit('game:channel', { propId: prop.id, duration });
  }

  cancelChannel(p) {
    p.channel = null;
    if (!p.isBot) this.socketOf(p)?.emit('game:channel', { propId: null });
  }

  updateChannel(p) {
    const prop = this.props[p.channel.propId];
    if (!this.inRange(p, prop, 1.0)) return this.cancelChannel(p);
    if (this.time - p.channel.start < p.channel.duration) return;
    p.channel = null;
    if (!p.isBot) this.socketOf(p)?.emit('game:channel', { propId: null, done: true });
    this.completeInteraction(p, prop);
  }

  completeInteraction(p, prop) {
    if (prop.interact === 'gate') {
      this.openGate(p.name, p);
      return;
    }
    if (prop.interact === 'tome' && !this.tomeReadBy) {
      this.tomeReadBy = p.name;
      this.setPhase(PHASE.HEARTS);
      this.emitAll({ type: 'tome', by: p.name, tome: this.tomeInfo() });
      this.monster.awaken();
      return;
    }
    const heart = this.heartByProp.get(prop.id);
    if (heart && !this.destroyed.has(prop.id) && this.phase === PHASE.HEARTS) {
      this.destroyed.add(prop.id);
      this.propState[prop.id] = { destroyed: true };
      for (const o of this.players.values()) this.addUlt(o, ULT.HEART);
      this.emitAll({
        type: 'heart',
        propId: prop.id,
        heartType: heart.type,
        name: heart.name,
        by: p.name,
        count: this.destroyed.size,
      });
      if (this.destroyed.size === HEART_COUNT) this.setPhase(PHASE.CONVERGENCE);
      this.noise(p, Infinity, 'heart'); // the Amalgam feels every heart die
    }
  }

  // --- spells & debug ----------------------------------------------------------

  onCast(id, d) {
    const p = this.players.get(id);
    if (!p || p.isBot || p.capturing) return;
    if (p.channel) this.cancelChannel(p);
    const slot = d?.slot === 'ult' ? 'ult' : Math.max(0, Math.min(3, Math.floor(Number(d?.slot) || 0)));
    const res = this.spells.cast(p, Number(d?.yaw), Number(d?.pitch), slot);
    const spell = this.spells.spellFor(p, slot);
    this.socketOf(p)?.emit('game:cooldown', res.ok
      ? { ok: true, slot, ability: spell.id, readyIn: res.cooldown, duration: res.cooldown }
      : { ok: false, slot, ability: spell?.id, readyIn: res.remaining ?? 0, reason: res.reason });
  }

  /** Debug: spawn the Training Husk ~4 units in front of the player, or remove it. */
  debugHusk(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.husk) {
      this.husk = null;
      this.emitAll({ type: 'husk:despawn' });
      return;
    }
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    let at = { x: p.x, z: p.z };
    for (let d = 4; d >= 1.2; d -= 0.4) {
      const x = p.x + fx * d, z = p.z + fz * d;
      if (!overlapsSolid(this.world, p.floor, x, z, 0.5)) { at = { x, z }; break; }
    }
    this.husk = new TrainingHusk(this, at.x, at.z, p.floor);
    this.husk.yaw = p.yaw + Math.PI;
    this.emitAll({ type: 'husk:spawn' });
  }

  /** Debug: hot-swap a wizard. Whoever held that wizard takes yours. */
  debugWizard(id, wizardId) {
    const p = this.players.get(id);
    if (!p || !WIZARD_BY_ID[wizardId] || p.wizardId === wizardId) return;
    const holder = [...this.players.values()].find((o) => o.wizardId === wizardId);
    if (holder) holder.wizardId = p.wizardId;
    p.wizardId = wizardId;
    for (const o of [p, holder]) {
      if (!o) continue;
      o.cooldowns = {};
      if (o.isBot) o.name = botName(o.wizardId);
      const m = this.lobby.members.find((mm) => mm.id === o.id);
      if (m) {
        m.wizardId = o.wizardId;
        m.name = o.name;
      }
    }
    this.emitAll({ type: 'roster', players: this.roster() });
  }

  updateGate() {
    const gateId = this.map.ids.gate;
    if (!this.propState[gateId]?.open || this.time < this.gateCloseAt) return;
    const gate = this.props[gateId];
    const { x, z, hx, hz } = gate.collider;
    const bodies = [...this.players.values(), ...this.monsters()];
    const blocked = bodies.some((b) => b.floor === gate.floor &&
      Math.abs(b.x - x) < hx + 0.6 && Math.abs(b.z - z) < hz + 0.6);
    if (blocked) return; // never slam it shut on someone
    this.propState[gateId] = { open: false };
    this.emitAll({ type: 'gate', propId: gateId, open: false });
  }

  // --- capture, rescue, game over ------------------------------------------------

  /** The Amalgam's lunge landed. Returns false if p can't be taken. */
  capture(p, monster) {
    if (!p || p.captured || p.capturing) return false;
    p.capturing = this.time + CAPTURE_DELAY;
    if (p.channel) this.cancelChannel(p);
    this.emitAll({
      type: 'capture', id: p.id, name: p.name,
      floor: monster.floor, mx: r2(monster.x), mz: r2(monster.z), myaw: r3(monster.yaw),
    });
    return true;
  }

  updateCaptures() {
    for (const p of this.players.values()) {
      if (!p.capturing || this.time < p.capturing) continue;
      p.capturing = 0;
      p.captured = true;
      p.hp = Math.max(p.hp, HP.CELL); // prisoners stabilise
      p.buffs = {};
      this.closeGate();
      const held = this.prisoners().length - 1;
      const spot = this.map.cell.points[held % this.map.cell.points.length];
      this.teleport(p, spot.x, spot.z, this.map.cell.floor, this.map.cell.yaw);
      this.emitAll({ type: 'captured', id: p.id, name: p.name });
      this.checkGameOver();
    }
  }

  openGate(by, rescuer) {
    const gateId = this.map.ids.gate;
    this.propState[gateId] = { open: true };
    this.gateCloseAt = this.time + GATE_OPEN_TIME;
    this.emitAll({ type: 'gate', propId: gateId, open: true, by });
    const freed = this.prisoners();
    for (const p of freed) p.captured = false;
    if (freed.length && rescuer && !rescuer.captured) this.addUlt(rescuer, ULT.RESCUE);
    if (freed.length) this.emitAll({ type: 'freed', ids: freed.map((p) => p.id), names: freed.map((p) => p.name), by });
  }

  closeGate() {
    const gateId = this.map.ids.gate;
    if (!this.propState[gateId]?.open) return;
    this.propState[gateId] = { open: false };
    this.emitAll({ type: 'gate', propId: gateId, open: false });
  }

  checkGameOver() {
    if (this.phase === PHASE.GAMEOVER || this.players.size === 0) return;
    const free = [...this.players.values()].filter((p) => !p.captured && !p.capturing);
    if (free.length) return;
    this.phaseBefore = this.phase;
    this.setPhase(PHASE.GAMEOVER);
    this.emitAll({ type: 'gameover', hostId: this.lobby.hostId });
  }

  /** "Retry": everyone back to the Foyer, the phase they died in resumes. */
  restartPhase() {
    if (this.phase !== PHASE.GAMEOVER) return;
    if (this.phaseBefore === PHASE.ARCHON) {
      this.setPhase(PHASE.ARCHON);
      this.finale.restart();
      this.emitAll({ type: 'restart', archon: true });
      return;
    }
    let i = 0;
    for (const p of this.players.values()) {
      p.captured = false;
      p.capturing = 0;
      p.shieldUntil = 0;
      p.hp = HP.MAX;
      p.buffs = {};
      const sp = this.map.spawn.points[i++ % this.map.spawn.points.length];
      this.teleport(p, sp.x, sp.z, this.map.spawn.floor, this.map.spawn.yaw);
    }
    this.closeGate();
    this.setPhase(this.phaseBefore ?? PHASE.HEARTS);
    if (this.phase === PHASE.TOME) this.monster.resume();
    else this.monster.hideFor(10);
    this.emitAll({ type: 'restart' });
  }

  // --- health & ultimate charge ------------------------------------------------------

  addUlt(p, amount) {
    if (!p) return;
    p.ult = Math.min(ULT.MAX, (p.ult ?? 0) + amount);
  }

  /**
   * A Monster attack lands on p. Resolution order: Devil Union (no effect,
   * attacker recoils) → Void shield (blocked) → capture rule (HP ≤ 40, unless
   * it's a splash) → Granite Skin → Sea Dragon's Cradle → HP; 0 HP = captured.
   * @returns 'immune' | 'blocked' | 'captured' | 'hit' | 'none'
   */
  damagePlayer(p, amount, attacker, kind) {
    if (this.finale.active) return this.finale.damageArchon(amount, kind); // one shared body
    if (!p || p.captured || p.capturing || this.phase === PHASE.GAMEOVER) return 'none';
    if (this.spells.hasBuff(p, 'union')) {
      attacker?.block?.();
      this.emitAll({ type: 'player:immune', id: p.id, attacker: attacker?.id });
      return 'immune';
    }
    if (this.spells.isShielded(p)) {
      attacker?.block?.();
      this.emitAll({ type: 'monster:blocked', id: attacker?.id, targetId: p.id });
      return 'blocked';
    }
    // The heavy telegraphed lunge always drags you away; other hits do when you're at ≤ 40 HP.
    if (kind === 'lunge') return this.capture(p, attacker) ? 'captured' : 'none';
    const splash = kind === 'shockwave';
    if (!splash && p.hp <= HP.CAPTURE_AT) return this.capture(p, attacker) ? 'captured' : 'none';
    let dmg = amount;
    if (this.spells.hasBuff(p, 'granite')) dmg *= 1 - WIZARD_BY_ID.sushantus.spells[3].reduction;
    let absorbed = 0;
    const cradle = p.buffs.cradle;
    if (cradle && this.spells.hasBuff(p, 'cradle')) {
      absorbed = Math.min(cradle.hp, dmg);
      cradle.hp -= absorbed;
      dmg -= absorbed;
      if (cradle.hp <= 0) delete p.buffs.cradle;
    }
    p.hp = Math.max(0, p.hp - dmg);
    p.lastHurtAt = this.time;
    this.emitAll({ type: 'player:hit', id: p.id, amount: Math.round(dmg), absorbed: Math.round(absorbed), hp: Math.ceil(p.hp), kind });
    if (p.hp <= 0) return this.capture(p, attacker) ? 'captured' : 'hit';
    return 'hit';
  }

  updateVitals(dt) {
    if (this.flood && this.time >= this.flood.until) {
      this.flood = null;
      this.emitAll({ type: 'flood:end' });
    }
    if (this.dawn && this.time >= this.dawn.until) {
      this.dawn = null;
      this.emitAll({ type: 'dawn:end' });
    }
    const awake = !!this.tomeReadBy;
    for (const p of this.players.values()) {
      if (p.captured || p.capturing) continue;
      if (this.time - p.lastHurtAt > HP.REGEN_DELAY && p.hp < HP.REGEN_CAP) p.hp = Math.min(HP.REGEN_CAP, p.hp + HP.REGEN * dt);
      if (awake) this.addUlt(p, ULT.PASSIVE * dt);
      if (this.monster?.state === 'hunting' && this.monster.targetId === p.id) this.addUlt(p, ULT.CHASED * dt);
    }
  }

  /** Debug U: fill your Ultimate. */
  debugUlt(id) {
    const p = this.players.get(id);
    if (p) p.ult = ULT.MAX;
  }

  // --- Phase III input ---------------------------------------------------------------

  onMastery(id, d) {
    const p = this.players.get(id);
    if (!p) return;
    const res = this.finale.mastery(p, Math.floor(Number(d?.key)), Number(d?.yaw));
    this.socketOf(p)?.emit('game:mastery', { key: d?.key, ...res });
  }

  onGrapple(id, d) {
    const p = this.players.get(id);
    if (p) this.finale.setGrapple(p, !!d?.on);
  }

  /** Debug H: skip to the Convergence (Tome read, all six Hearts destroyed). */
  debugFinale() {
    if (this.finale.active) return;
    this.tomeReadBy ??= 'debug';
    for (const h of this.map.hearts) {
      if (this.destroyed.has(h.propId)) continue;
      this.destroyed.add(h.propId);
      this.propState[h.propId] = { destroyed: true };
      this.emitAll({ type: 'heart', propId: h.propId, heartType: h.type, name: h.name, by: 'debug', count: this.destroyed.size });
    }
    this.emitAll({ type: 'tome', by: this.tomeReadBy, tome: this.tomeInfo() });
    const altar = this.props[this.map.ids.altar];
    for (const p of this.players.values()) {
      if (!p.captured) continue;
      p.captured = false; // out of the Cell, straight to the Chapel
      this.teleport(p, altar.front.x, altar.front.z, altar.floor, p.yaw);
    }
    if (this.monster.state === 'dormant' || this.monster.state === 'haunt') this.monster.awaken();
    this.setPhase(PHASE.CONVERGENCE);
  }

  /** Debug N: bring the Unbound one to the brink of the portal. */
  debugPortal() {
    const m = this.monster;
    if (!this.finale.inFight()) return;
    m.bossHp = Math.min(m.bossHp, FINALE_BOSS_HP * 0.25);
    this.finale.wardsUsed = 2;
  }

  onPing(id) {
    const p = this.players.get(id);
    if (!p || this.time < p.pingAt) return;
    p.pingAt = this.time + PING_COOLDOWN;
    this.emitAll({ type: 'ping', id: p.id, name: p.name, floor: p.floor, x: r2(p.x), z: r2(p.z), captured: p.captured });
  }

  /** Debug P: cycle Husk → Haunt → Stalk → Hunt → Capture test → Auto. */
  debugMode(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.debugModeIdx = (this.debugModeIdx + 1) % DEBUG_MODES.length;
    const mode = DEBUG_MODES[this.debugModeIdx];
    const m = this.monster;
    if (this.husk && mode !== 'husk') {
      this.husk = null;
      this.emitAll({ type: 'husk:despawn' });
    }
    m.debugHeld = mode === 'husk' || mode === 'haunt';
    switch (mode) {
      case 'husk':
        m.hidden = true;
        m.setState('dormant');
        m.nextHauntAt = Infinity;
        if (!this.husk) this.debugHusk(id);
        break;
      case 'haunt':
        m.hidden = true;
        m.setState('dormant');
        m.startHaunt(p);
        break;
      case 'stalk':
        if (m.hidden || ['dormant', 'haunt', 'retreating'].includes(m.state)) m.place(m.hiddenSpot(p.floor, 14, 24));
        m.hidden = false;
        m.setState('stalking');
        break;
      case 'hunt':
        if (m.hidden || ['dormant', 'haunt', 'retreating'].includes(m.state)) {
          m.place(m.hiddenSpot(p.floor, 10, 18));
          m.hidden = false;
          m.setState('stalking');
        }
        m.hunt(p, 'debug');
        break;
      case 'capture': {
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
        let at = { x: p.x, z: p.z };
        for (let d = 3; d >= 1.2; d -= 0.3) {
          if (!overlapsSolid(this.world, p.floor, p.x + fx * d, p.z + fz * d, m.radius)) { at = { x: p.x + fx * d, z: p.z + fz * d }; break; }
        }
        m.place({ ...at, floor: p.floor });
        m.yaw = p.yaw + Math.PI;
        m.hidden = false;
        m.setState('stalking');
        m.hunt(p, 'debug');
        m.attackReadyAt = 0;
        m.forceLunge = true; // the heavy lunge: a guaranteed capture
        break;
      }
      case 'auto':
        m.debugHeld = false;
        m.nextHauntAt = this.time + 30;
        m.resume();
        break;
    }
    this.emitAll({ type: 'debug:mode', mode });
  }

  /** Debug K: capture yourself instantly, or (if held) break the lock. */
  debugCapture(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.captured) {
      this.openGate(`${p.name} (debug)`);
      return;
    }
    const m = this.monster;
    m.place({ x: p.x - Math.sin(p.yaw) * 1.2, z: p.z - Math.cos(p.yaw) * 1.2, floor: p.floor });
    m.yaw = p.yaw + Math.PI;
    m.hidden = false;
    if (m.state === 'dormant' || m.state === 'haunt') m.setState('stalking');
    if (this.capture(p, m)) m.banish('capture');
  }

  setPhase(phase) {
    this.phase = phase;
    this.emitAll({ type: 'phase', phase });
  }

  debugTeleport(id, d) {
    const p = this.players.get(id);
    const floor = Number(d?.floor), x = Number(d?.x), z = Number(d?.z);
    if (!p || !this.map.floors[floor] || !Number.isFinite(x) || !Number.isFinite(z)) return;
    if (this.insideWall(floor, x, z)) return;
    this.teleport(p, x, z, floor, finite(Number(d.yaw), p.yaw));
  }

  /** Nearest clear spot to (x, z) that no other wizard is standing on. */
  freeSpotNear(floor, x, z, self) {
    const offsets = [[0, 0], [0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9], [0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]];
    for (const [ox, oz] of offsets) {
      const nx = x + ox, nz = z + oz;
      if (overlapsSolid(this.world, floor, nx, nz, PLAYER_RADIUS)) continue;
      let taken = false;
      for (const o of this.players.values()) {
        if (o !== self && o.floor === floor && Math.hypot(o.x - nx, o.z - nz) < 0.8) { taken = true; break; }
      }
      if (!taken) return { x: nx, z: nz };
    }
    return { x, z };
  }

  useStairs(p, prop) {
    const t = prop.target;
    const spot = this.freeSpotNear(t.floor, t.x, t.z, p);
    this.teleport(p, spot.x, spot.z, t.floor, t.yaw);
  }
}
