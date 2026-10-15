// One running match. The server owns the game state (phase, Hearts, props,
// channelled interactions, bots). Clients predict their own movement, which
// the server bounds-checks and corrects. See ARCHITECTURE.md.

import { performance } from 'node:perf_hooks';
import { generateMansion, publicMap, roomAt } from '../shared/mapgen.js';
import { createCollisionWorld, overlapsSolid, addBarrier, removeBarrier, moveCircle } from '../shared/collision.js';
import {
  PHASE, CHANNEL, INTERACT_RANGE, TICK_RATE, SPEED, HEART_COUNT, TILE, TILE_WALL, TILE_VOID, PLAYER_RADIUS, HP,
  tileCenter,
} from '../shared/constants.js';
import { DECOY_LINES, TOME_TEXT, TASKS, TASK_STEPS, HEART_TYPES } from '../shared/lore.js';
import { SINS } from '../shared/sins.js';
import { SinDemon } from './SinDemon.js';
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
import { zoneAt, nearCorridor } from '../shared/roomgraph.js';

const GATE_OPEN_TIME = 6;
const CAPTURE_DELAY = 1.5; // the victim's capture screen plays before the cage
const DEMON_LINGER = 3; // a slain Sin's body stays this long
/**
 * Step 8: activity pings send the Keeper to investigate (higher outranks lower
 * while it is already on its way somewhere).
 */
export const ACTIVITY = {
  task: 5, gate: 5, help: 5, // a Sin task step; the cage breaking open; a prisoner's call
  spell: 4,
  sprint: 3, lumos: 3, // only near a corridor
  movement: 2, // (the Keeper's own sense: Monster.senseMovement)
};
const ACTIVITY_COOLDOWN = 2; // per wizard, for sprint / Lumos pings
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
    this.heartByTask = new Map(this.map.hearts.flatMap((h) => [...h.tasks, ...(h.sink !== null && h.sink !== undefined ? [h.sink] : [])].map((id) => [id, h])));
    this.arenas = new Map(); // heart propId -> { heart, room, tiles, barrierId, demon, by, startedAt }
    this.demons = [];
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
        ult: 0, // Ultimate charge 0–100 (5 minutes of match time)
        ultUsed: false, // an Ultimate is cast once per game
        buffs: {},
        lastHurtAt: -Infinity,
        captured: false, // held in the Basement Ritual Cell
        capturing: 0, // game time at which the jumpscare ends and the teleport happens
        noiseAt: 0,
        pingAt: 0,
        actAt: -Infinity, // last cast (gives an invisible wizard away)
        zone: null, // the room (or -1, a corridor) they were in last tick
        activityAt: -Infinity, // last sprint / Lumos ping
        impulseUntil: 0, // being yanked by a Sin (the speed check relaxes)
        impulse: null, // bots: { vx, vz, until }
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
      // Step 7: the Tome names each Sin's Heart, its room and its task (the map shows them).
      hearts: this.map.hearts.map(({ id, type, name, sin, propId, roomId, roomName, floor, tasks, sink, clue }) => ({
        id, type, name, sin, propId, roomId, roomName, floor, tasks, sink, clue, destroyed: this.destroyed.has(propId),
      })),
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
      arenas: [...this.arenas.values()].map((a) => this.arenaInfo(a)),
    };
  }

  /** Every hostile body in the game, visible or not. */
  bodies() {
    return [this.husk, this.monster, ...this.demons].filter(Boolean);
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
        cy: p.carry?.kind ?? null,
        u: Math.floor(p.ult),
        ux: !!p.ultUsed,
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
    this.updateImpulses(dt);
    for (const m of this.bodies()) m.update(dt);
    this.updateArenas();
    this.spells.update(dt);
    this.finale.update(dt);
    this.updateVitals(dt);
    for (const p of this.players.values()) if (p.channel) this.updateChannel(p);
    this.updateCrossings();
    this.updateCaptures();
    this.updateGate();
    this.io.to(this.room).emit('game:snap', this.snapshot());
  }

  insideWall(floor, x, z) {
    const f = this.map.floors[floor];
    const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
    if (tx < 0 || ty < 0 || tx >= f.w || ty >= f.h) return true;
    const t = f.tiles[ty * f.w + tx];
    return t === TILE_WALL || t === TILE_VOID;
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
    const yanked = this.time < p.impulseUntil ? 14 : 0; // a Sin's ribbons / vacuum
    if (moved > (SPEED.sprint * 1.5 * boost + yanked) * dt + 0.75 || this.insideWall(p.floor, x, z)) {
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
    const lit = !!d.li;
    // F, near a corridor: the Keeper notices (only real toggles, not the first state we hear).
    if (p.lightKnown && lit !== p.light) this.nearCorridorActivity(p, 'lumos');
    p.lightKnown = true;
    p.light = lit;
    p.moving = !!d.mv;
    if (p.sprint && p.moving && this.time >= p.noiseAt) this.sprintNoise(p);
  }

  /** Sprinting is loud: a 10u noise, and an activity ping near a corridor. */
  sprintNoise(p) {
    p.noiseAt = this.time + 0.5;
    this.noise(p, 10, 'sprint');
    this.nearCorridorActivity(p, 'sprint');
  }

  nearCorridorActivity(p, kind) {
    if (this.time < p.activityAt || !nearCorridor(this.map, p.floor, p.x, p.z)) return false;
    p.activityAt = this.time + ACTIVITY_COOLDOWN;
    return this.activity(kind, p, p);
  }

  /**
   * Step 8: something happened at `at` ({ x, z, floor }). Unless it is inside
   * a sealed Sin lockdown, the Keeper drops its patrol and comes to look.
   * @param extra passed to Monster.investigate (look: where it inspects; enter: false to stay at the doorway)
   */
  activity(kind, at, by = null, extra = {}) {
    const m = this.monster;
    if (!m || (by && this.inArena(by))) return false;
    const room = zoneAt(this.map, at.floor, at.x, at.z);
    if (room >= 0 && this.arenaRoom(room)) return false;
    this.lastActivity = { kind, x: at.x, z: at.z, floor: at.floor, roomId: room, by: by?.id ?? null, at: this.time };
    return m.investigate({ x: at.x, z: at.z, floor: at.floor, kind, priority: ACTIVITY[kind] ?? 1, by: by?.id, ...extra });
  }

  /** Doorway crossings: a wizard stepping into another room (Monster.crossed biases its patrol there). */
  updateCrossings() {
    for (const p of this.players.values()) {
      if (p.captured || p.capturing) { p.zone = null; continue; }
      const zone = zoneAt(this.map, p.floor, p.x, p.z);
      const was = p.zone;
      p.zone = zone;
      if (was === null || was === undefined || zone === was || zone < 0 || this.inArena(p)) continue;
      // The doorway they came through: the room's door nearest to them.
      let door = null;
      for (const d of this.monster?.rooms[p.floor].doors.get(zone) ?? []) {
        if (!door || Math.hypot(d.x - p.x, d.z - p.z) < Math.hypot(door.x - p.x, door.z - p.z)) door = d;
      }
      this.monster?.crossed(p, zone, door ?? { x: p.x, z: p.z });
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
        } else if (heart && this.arenas.has(prop.id)) {
          this.whisper(p, `${SINS[heart.sin].name} is loose. Kill it, and the Heart dies with it.`);
        } else if (heart && !this.propState[prop.id]?.unsealed) {
          const left = TASK_STEPS - this.tasksDone(heart);
          this.whisper(p, `It beats behind a seal. ${TASKS[heart.sin].objective} to unseal it (${TASK_STEPS - left} of ${TASK_STEPS}).`);
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

      case 'task': {
        const heart = this.heartByTask.get(prop.id);
        const st = this.propState[prop.id];
        if (!heart) break;
        const T = TASKS[heart.sin];
        if (this.phase === PHASE.TOME) {
          this.whisper(p, 'It means nothing to you yet. Not until the Tome has been read.');
        } else if (this.destroyed.has(heart.propId) || this.propState[heart.propId]?.unsealed) {
          this.whisper(p, `${T.done}. The Heart is already unsealed.`);
        } else if (prop.role === 'sink') {
          // The scale / the furnace: bring it what it wants.
          if (p.carry?.kind !== T.carry) this.whisper(p, T.carry === 'ingot' ? 'The scale waits, empty. Bring it gold from the display cases.' : 'The furnace roars, hungry. Bring it the rotting platters.');
          else this.startChannel(p, prop, T.time);
        } else if (st?.done) {
          this.whisper(p, `${T.done}.`);
        } else if (T.carry) {
          if (st?.taken) this.whisper(p, 'Empty. Someone is carrying it.');
          else if (p.carry) this.whisper(p, 'Your hands are full.');
          else this.startChannel(p, prop, T.takeTime);
        } else {
          this.startChannel(p, prop, T.time);
        }
        break;
      }

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
    if (prop.interact === 'task') return this.completeTask(p, prop);
    const heart = this.heartByProp.get(prop.id);
    if (heart && !this.destroyed.has(prop.id) && this.phase === PHASE.HEARTS && this.propState[prop.id]?.unsealed && !this.arenas.has(prop.id)) {
      this.startArena(heart, p);
    }
  }

  // --- Hearts: room tasks, the Sin's arena, destruction ------------------------------

  tasksDone(heart) {
    return heart.tasks.filter((id) => this.propState[id]?.done).length;
  }

  /** One step of a room task (a brazier lit, a mirror turned, a pedestal wound, a coin placed). */
  completeTask(p, prop) {
    const heart = this.heartByTask.get(prop.id);
    if (!heart || this.phase !== PHASE.HEARTS || this.propState[heart.propId]?.unsealed || this.destroyed.has(heart.propId)) return;
    const T = TASKS[heart.sin];
    const st = this.propState[prop.id] ?? {};
    let stepId = prop.id;
    if (prop.role === 'sink') {
      // Weigh the ingot / dump the platter: its source counts as done.
      if (p.carry?.kind !== T.carry) return;
      stepId = p.carry.from;
      this.propState[stepId] = { done: true };
      this.setCarry(p, null);
      const placed = heart.tasks.filter((id) => this.propState[id]?.done).length;
      this.propState[prop.id] = { count: placed };
      this.emitAll({ type: 'task', propId: prop.id, task: heart.sin, by: p.name, state: this.propState[prop.id], progress: placed, of: TASK_STEPS, sink: true });
      this.activity('task', prop, p);
    } else if (T.carry) {
      // Take the ingot / the platter (one at a time).
      if (st.done || st.taken || p.carry) return;
      this.propState[prop.id] = { taken: true };
      this.setCarry(p, { kind: T.carry, from: prop.id });
      this.emitAll({ type: 'task', propId: prop.id, task: heart.sin, by: p.name, state: this.propState[prop.id], progress: this.tasksDone(heart), of: TASK_STEPS, took: true });
      this.activity('task', prop, p);
      return;
    } else {
      if (st.done) return;
      this.propState[prop.id] = { done: true };
      this.activity('task', prop, p);
    }
    const done = this.tasksDone(heart);
    this.emitAll({ type: 'task', propId: stepId, task: heart.sin, by: p.name, state: this.propState[stepId], progress: done, of: TASK_STEPS });
    if (done < TASK_STEPS) return;
    this.propState[heart.propId] = { unsealed: true };
    this.emitAll({ type: 'heart:unsealed', propId: heart.propId, name: heart.name, room: heart.roomName, sin: heart.sin, by: p.name });
  }

  /** What p carries (an ingot, a platter), or null; everyone sees it in their hands. */
  setCarry(p, carry) {
    p.carry = carry;
    this.emitAll({ type: 'carry', id: p.id, kind: carry?.kind ?? null });
  }

  /** Taken (captured…) while carrying: the item goes back where it came from. */
  dropCarry(p) {
    if (!p.carry) return;
    const from = p.carry.from;
    if (this.propState[from]?.taken) {
      this.propState[from] = {};
      const heart = this.heartByTask.get(from);
      this.emitAll({ type: 'task', propId: from, task: heart?.sin, state: {}, progress: heart ? this.tasksDone(heart) : 0, of: TASK_STEPS, returned: true });
    }
    this.setCarry(p, null);
  }

  /** Walkable tiles just outside a room's doorways: where the blood-runes seal it. */
  arenaTiles(room) {
    const f = this.map.floors[room.floor];
    const at = (x, y) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? -2 : f.roomIds[y * f.w + x]);
    const out = [];
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        if (x < 0 || y < 0 || x >= f.w || y >= f.h || at(x, y) === room.id) continue;
        const t = f.tiles[y * f.w + x];
        if (t === TILE_WALL || t === TILE_VOID) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy) === room.id)) out.push([x, y]);
      }
    }
    return out;
  }

  arenaInfo(a) {
    return { heartPropId: a.heart.propId, roomId: a.room.id, floor: a.room.floor, sin: a.heart.sin, barrierId: a.barrierId, tiles: a.tiles };
  }

  /** Is p locked inside a Sin's arena? */
  inArena(p) {
    for (const a of this.arenas.values()) if (a.demon.inArena(p)) return true;
    return false;
  }

  /** Is room `roomId` sealed right now? */
  arenaRoom(roomId) {
    for (const a of this.arenas.values()) if (a.room.id === roomId) return true;
    return false;
  }

  /**
   * The Heart is broken open: its doors slam shut behind blood-runes and its
   * Sin erupts. Nobody leaves, and the Keeper can't come in, until it dies.
   */
  startArena(heart, p) {
    const room = this.map.rooms[heart.roomId];
    const tiles = this.arenaTiles(room);
    // Anyone standing in a doorway is pulled inside first.
    for (const o of this.players.values()) {
      if (o.captured || o.capturing || o.floor !== room.floor) continue;
      const tx = Math.floor(o.x / TILE), ty = Math.floor(o.z / TILE);
      if (!tiles.some(([x, y]) => x === tx && y === ty)) continue;
      const inside = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [tx + dx, ty + dy])
        .find(([x, y]) => this.map.floors[room.floor].roomIds[y * this.map.floors[room.floor].w + x] === room.id);
      if (inside) this.teleport(o, tileCenter(inside[0]), tileCenter(inside[1]), room.floor, o.yaw);
    }
    const barrierId = `arena:${heart.id}`;
    addBarrier(this.world, room.floor, barrierId, tiles);
    const demon = new SinDemon(this, heart, room);
    this.demons.push(demon);
    const arena = { heart, room, tiles, barrierId, demon, by: p.name, startedAt: this.time };
    this.arenas.set(heart.propId, arena);
    this.propState[heart.propId] = { unsealed: true, arena: true };
    const inside = [...this.players.values()].filter((o) => demon.inArena(o));
    // The Keeper can't stay in here, and loses anyone who is.
    const m = this.monster;
    if (m.floor === room.floor && !m.hidden && roomAt(this.map, m.floor, m.x, m.z)?.id === room.id && m.state !== 'boss') m.hideFor(8);
    if (m.state === 'hunting' && inside.some((o) => o.id === m.targetId)) m.breakLock('arena');
    for (const o of inside) if (o.channel) this.cancelChannel(o);
    const S = SINS[heart.sin];
    this.emitAll({
      type: 'arena:start', ...this.arenaInfo(arena), name: heart.name, demonId: demon.id,
      title: `${S.name.toUpperCase()}: ${S.title.toUpperCase()}`, blurb: S.blurb, by: p.name, inside: inside.map((o) => o.id),
    });
  }

  updateArenas() {
    for (const a of [...this.arenas.values()]) {
      if (a.demon.dead) continue; // (onDemonSlain ends it)
      if (!this.players.size || [...this.players.values()].some((o) => a.demon.inArena(o))) continue;
      // Everyone inside was taken: the Sin withdraws into its Heart, the doors open.
      this.endArena(a, false);
    }
    for (let i = this.demons.length - 1; i >= 0; i--) {
      const d = this.demons[i];
      if (d.removeAt && this.time >= d.removeAt) this.demons.splice(i, 1);
    }
  }

  onDemonSlain(demon) {
    const a = [...this.arenas.values()].find((x) => x.demon === demon);
    demon.removeAt = this.time + DEMON_LINGER;
    if (a) this.endArena(a, true);
  }

  endArena(a, won) {
    this.arenas.delete(a.heart.propId);
    removeBarrier(this.world, a.barrierId);
    if (!won) {
      const i = this.demons.indexOf(a.demon);
      if (i >= 0) this.demons.splice(i, 1);
      this.propState[a.heart.propId] = { unsealed: true };
    }
    this.emitAll({ type: 'arena:end', heartPropId: a.heart.propId, barrierId: a.barrierId, won, sin: a.heart.sin, demonId: a.demon.id });
    if (won) this.destroyHeart(a.heart, a.by);
  }

  /** A Heart dies for good (its Sin is slain). */
  destroyHeart(heart, by) {
    if (this.destroyed.has(heart.propId)) return;
    this.destroyed.add(heart.propId);
    this.propState[heart.propId] = { destroyed: true };
    this.emitAll({
      type: 'heart',
      propId: heart.propId,
      heartType: heart.type,
      name: heart.name,
      sin: heart.sin,
      by,
      count: this.destroyed.size,
    });
    if (this.destroyed.size === HEART_COUNT) this.setPhase(PHASE.CONVERGENCE);
    const prop = this.props[heart.propId];
    // The Amalgam feels every heart die, and comes to see.
    this.monster.hear({ x: prop.x, z: prop.z, floor: prop.floor }, Infinity, 'heart');
  }

  // --- Sins pulling wizards around --------------------------------------------------

  /** Yank p along (vx, vz) for `duration` seconds (a Sin's ribbons, a vacuum). */
  impulse(p, vx, vz, duration) {
    if (!p || p.captured || p.capturing) return;
    p.impulseUntil = this.time + duration + 0.4;
    if (p.isBot) p.impulse = { vx, vz, until: this.time + duration };
    else this.socketOf(p)?.emit('game:impulse', { vx: Math.round(vx * 100) / 100, vz: Math.round(vz * 100) / 100, duration });
  }

  updateImpulses(dt) {
    for (const p of this.players.values()) {
      const im = p.impulse;
      if (!im) continue;
      if (this.time >= im.until) { p.impulse = null; continue; }
      const r = moveCircle(this.world, p.floor, p.x, p.z, im.vx * dt, im.vz * dt, PLAYER_RADIUS);
      p.x = r.x;
      p.z = r.z;
    }
  }

  // --- the Disillusionment Charm (V) --------------------------------------------------

  /**
   * V: the Disillusionment Charm, an infinite toggle with no cooldown. Turning
   * it on FAILS if the Keeper can already see you (or has locked on): it comes
   * for you instead.
   */
  onInvis(id) {
    const p = this.players.get(id);
    if (!p || p.captured || p.capturing || this.finale.active) return { ok: false, reason: 'unavailable' };
    let res;
    if (this.spells.hasBuff(p, 'invis')) {
      delete p.buffs.invis;
      this.emitAll({ type: 'invis', id: p.id, on: false });
      res = { ok: true, on: false };
    } else {
      const m = this.monster;
      const seen = m && !m.hidden && m.state !== 'boss' && (m.lockedOn(p) || m.wouldSee(p));
      if (seen) {
        m.hunt(p, 'sighted'); // in front of it: the charm fails, and it charges
        this.emitAll({ type: 'invis', id: p.id, on: false, failed: true });
        res = { ok: false, reason: 'seen' };
      } else {
        this.spells.addBuff(p, 'invis', Infinity);
        this.emitAll({ type: 'invis', id: p.id, on: true });
        res = { ok: true, on: true };
      }
    }
    if (!p.isBot) this.socketOf(p)?.emit('game:invis', res);
    return res;
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
    p.impulse = null;
    this.dropCarry(p);
    if (p.channel) this.cancelChannel(p);
    // The capture screen always shows the Keeper's face, even when a Sin broke you.
    const by = monster?.kind === 'amalgam' ? monster : null;
    const yaw = by ? by.yaw : p.yaw + Math.PI;
    this.emitAll({
      type: 'capture', id: p.id, name: p.name, by: monster?.id ?? null, sin: monster?.sin ?? null,
      floor: p.floor, mx: r2(by ? by.x : p.x - Math.sin(yaw) * -1.1), mz: r2(by ? by.z : p.z - Math.cos(yaw) * -1.1), myaw: r3(yaw),
      duration: CAPTURE_DELAY,
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
      p.impulse = null;
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
    const gate = this.props[gateId];
    this.activity('gate', gate.front ? { ...gate.front, floor: gate.floor } : gate, rescuer ?? null, { look: gate.front ?? gate, enter: false });
    const freed = this.prisoners();
    for (const p of freed) p.captured = false;
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
    for (const a of [...this.arenas.values()]) this.endArena(a, false);
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
    const keeper = attacker?.kind === 'amalgam';
    if (keeper && this.inArena(p)) return 'none'; // behind a Sin's blood-runes
    if (this.spells.hasBuff(p, 'union')) {
      if (keeper) attacker.recoilFromUnion?.(p);
      else attacker?.block?.();
      this.emitAll({ type: 'player:immune', id: p.id, attacker: attacker?.id });
      return 'immune';
    }
    if (this.spells.isShielded(p)) {
      attacker?.block?.();
      this.emitAll({ type: 'monster:blocked', id: attacker?.id, targetId: p.id });
      return 'blocked';
    }
    if (kind !== 'sin') {
      // The Keeper: the heavy lunge always drags you away; other hits do when you're at ≤ 40 HP.
      if (kind === 'lunge') return this.capture(p, attacker) ? 'captured' : 'none';
      const splash = kind === 'shockwave';
      if (!splash && p.hp <= HP.CAPTURE_AT) return this.capture(p, attacker) ? 'captured' : 'none';
    }
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
    this.emitAll({ type: 'player:hit', id: p.id, amount: Math.round(dmg), absorbed: Math.round(absorbed), hp: Math.ceil(p.hp), kind, by: attacker?.id });
    // Broken by a Sin (or the Keeper): the Keeper drags you down to the cage.
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
    const ticking = this.phase !== PHASE.GAMEOVER && this.phase !== PHASE.EPILOGUE;
    for (const p of this.players.values()) {
      // The Ultimate charges strictly with match time (caged or not): 0 → READY in 5 minutes, once per game.
      if (ticking && !p.ultUsed) this.addUlt(p, (ULT.MAX / ULT.CHARGE_TIME) * dt);
      if (p.captured || p.capturing) continue;
      if (this.time - p.lastHurtAt > HP.REGEN_DELAY && p.hp < HP.REGEN_CAP) p.hp = Math.min(HP.REGEN_CAP, p.hp + HP.REGEN * dt);
    }
  }

  /** Debug U: ready (and un-spend) your Ultimate. */
  debugUlt(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.ult = ULT.MAX; // ready, and un-spent
    p.ultUsed = false;
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

  /** Debug H: skip to the Convergence (Tome read, all seven Hearts destroyed). */
  debugFinale() {
    if (this.finale.active) return;
    for (const a of [...this.arenas.values()]) this.endArena(a, false);
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

  /**
   * Debug L: break open the nearest sealed Heart (its room task done for you),
   * pull the coven into its room and start the Sin's lockdown. Pressed inside
   * a live arena, it slays the Sin instead. `d.sin` picks a specific Sin.
   */
  debugArena(id, d) {
    const p = this.players.get(id);
    if (!p || this.finale.active) return;
    const live = [...this.arenas.values()].find((a) => a.demon.inArena(p));
    if (live) return live.demon.damage(9999, 'debug');
    if (this.phase === PHASE.TOME) {
      this.tomeReadBy = 'debug';
      this.setPhase(PHASE.HEARTS);
      this.emitAll({ type: 'tome', by: this.tomeReadBy, tome: this.tomeInfo() });
      this.monster.awaken();
    }
    if (this.phase !== PHASE.HEARTS) return;
    const open = this.map.hearts.filter((h) => !this.destroyed.has(h.propId) && !this.arenas.has(h.propId));
    const heart = open.find((h) => h.sin === d?.sin) ??
      open.sort((a, b) => (a.floor === p.floor ? 0 : 1000) - (b.floor === p.floor ? 0 : 1000) +
        Math.hypot(this.props[a.propId].x - p.x, this.props[a.propId].z - p.z) - Math.hypot(this.props[b.propId].x - p.x, this.props[b.propId].z - p.z))[0];
    if (!heart) return;
    for (const tid of heart.tasks) {
      this.propState[tid] = { done: true, turns: 0 };
      this.emitAll({ type: 'task', propId: tid, task: heart.task, by: 'debug', state: this.propState[tid], progress: TASK_STEPS, of: TASK_STEPS });
    }
    this.propState[heart.propId] = { unsealed: true };
    this.emitAll({ type: 'heart:unsealed', propId: heart.propId, name: heart.name, room: heart.roomName, sin: heart.sin, by: 'debug' });
    // Everyone free comes along (spread around the Heart's room).
    const room = this.map.rooms[heart.roomId];
    const spots = [];
    for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
      for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
        const pt = { x: tileCenter(x), z: tileCenter(y) };
        if (!overlapsSolid(this.world, room.floor, pt.x, pt.z, 0.5)) spots.push(pt);
      }
    }
    const prop = this.props[heart.propId];
    spots.sort((a, b) => Math.hypot(a.x - prop.x, a.z - prop.z) - Math.hypot(b.x - prop.x, b.z - prop.z));
    let i = 0;
    for (const o of this.players.values()) {
      if (o.captured || o.capturing) continue;
      const spot = spots[Math.min(spots.length - 1, 3 + i * 2)] ?? spots[0];
      i++;
      this.teleport(o, spot.x, spot.z, room.floor, Math.atan2(-(prop.x - spot.x), -(prop.z - spot.z)));
    }
    this.startArena(heart, p);
  }

  onPing(id) {
    const p = this.players.get(id);
    if (!p || this.time < p.pingAt) return;
    p.pingAt = this.time + PING_COOLDOWN;
    this.emitAll({ type: 'ping', id: p.id, name: p.name, floor: p.floor, x: r2(p.x), z: r2(p.z), captured: p.captured });
    if (p.captured) {
      // A prisoner's cry carries: it comes to the cage to look in (it can't go inside).
      const gate = this.props[this.map.ids.gate];
      this.activity('help', { ...(gate.front ?? gate), floor: gate.floor }, null, { look: gate.front ?? gate, enter: false });
    }
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
