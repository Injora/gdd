// Phase III: the Forbidden Spell → Soul Merge → the Archon vs the Unbound
// Malphas Amalgam → the Hell Portal → victory (Phase IV is client-side).
//
//   CONVERGENCE  every wizard holds E at the altar; the chant only advances
//                while all of them are channelling (6 s), and decays otherwise
//   merge        3 s cinematic; all bodies become the one Archon (at the altar)
//   boss         the Unbound Amalgam (300 HP): orb volleys, floor shockwaves,
//                telegraphed charges, two invulnerable wards
//   portal       at 20 % a rift opens on the altar; it crawls away unless
//                bound; Wind shoves it in; Soul Grapple (hold E/R) drags it
//   sealing      3 s: dragged under → victory → PHASE.EPILOGUE
//
// The Archon is driven by one player (the host); everyone's position is the
// Archon's, everyone looks and casts independently. Masteries (keys 1–7)
// have cooldowns shared by the whole Archon.

import { FINALE as F, MASTERIES } from '../shared/finale.js';
import { ARCHON_COOLDOWN_SCALE } from '../shared/wizards.js';
import { PHASE, TILE, TILE_WALL, worldToTile, tileCenter, yawFromDir, SPEED } from '../shared/constants.js';
import { moveCircle, overlapsSolid, lineOfSight } from '../shared/collision.js';

const r2 = (v) => Math.round(v * 100) / 100;
const MASTERY_BY_KEY = Object.fromEntries(MASTERIES.map((m) => [m.key, m]));

export class Finale {
  constructor(game) {
    this.game = game;
    this.stage = null;
    this.ritual = 0;
    this.archon = null;
    this.mergeUntil = 0;
    this.masteryReady = {};
    this.orbs = [];
    this.nextOrbId = 1;
    this.wave = null;
    this.charge = null;
    this.timers = { volley: 0, wave: 0, charge: 0 };
    this.wardUntil = 0;
    this.wardsUsed = 0;
    this.portal = null;
    this.grapplers = new Set();
    this.sealUntil = 0;
  }

  get t() { return this.game.time; }
  get altar() { return this.game.props[this.game.map.ids.altar]; }
  get boss() { return this.game.monster; }
  /** After the merge has begun: the Archon exists. */
  get active() { return !!this.archon; }
  inFight() { return this.stage === 'boss' || this.stage === 'portal'; }

  // ---- the Forbidden Spell ---------------------------------------------------------

  chanting(p) { return !p.captured && !p.capturing && p.channel?.propId === this.game.map.ids.altar; }

  updateRitual(dt) {
    const ps = [...this.game.players.values()];
    if (!ps.length) return;
    if (ps.every((p) => this.chanting(p))) this.ritual = Math.min(1, this.ritual + dt / F.RITUAL_TIME);
    else this.ritual = Math.max(0, this.ritual - dt * F.RITUAL_DECAY);
    if (this.ritual >= 1) this.startMerge();
  }

  pickDriver() {
    const ps = [...this.game.players.values()];
    const host = ps.find((p) => p.id === this.game.lobby.hostId && !p.isBot);
    return (host ?? ps.find((p) => !p.isBot) ?? ps[0])?.id ?? null;
  }

  startMerge() {
    const g = this.game;
    const a = this.altar;
    const spot = a.front ?? { x: a.x, z: a.z + 2 };
    for (const p of g.players.values()) {
      if (p.channel) g.cancelChannel(p);
      p.buffs = {};
      p.captured = false;
      p.capturing = 0;
      p.shieldUntil = 0;
    }
    this.archon = {
      x: spot.x, z: spot.z, floor: a.floor, yaw: yawFromDir(spot.x - a.x, spot.z - a.z),
      hp: F.ARCHON_HP, driverId: this.pickDriver(),
    };
    this.stage = 'merge';
    this.mergeUntil = this.t + F.MERGE_TIME;
    this.ritual = 1;
    g.cooldownScale = ARCHON_COOLDOWN_SCALE;
    for (const p of g.players.values()) p.cooldowns = {};
    g.setPhase(PHASE.ARCHON);
    const m = this.boss;
    m.hidden = true;
    m.setState('boss');
    m.attack = null;
    g.emitAll({
      type: 'merge', floor: a.floor, x: r2(a.x), z: r2(a.z), ax: r2(spot.x), az: r2(spot.z), yaw: this.archon.yaw,
      duration: F.MERGE_TIME, driverId: this.archon.driverId,
    });
  }

  /** The far side of the Chapel from the Archon. */
  bossSpawn() {
    const map = this.game.map;
    const room = map.rooms[map.ids.altarRoom];
    let best = null;
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const pt = { x: tileCenter(x), z: tileCenter(y) };
        if (overlapsSolid(this.game.world, room.floor, pt.x, pt.z, 0.7)) continue;
        const d = Math.hypot(pt.x - this.archon.x, pt.z - this.archon.z);
        if (!best || d > best.d) best = { pt, d };
      }
    }
    return { ...(best?.pt ?? { x: this.archon.x + 6, z: this.archon.z }), floor: room.floor };
  }

  beginBoss() {
    const m = this.boss;
    m.place(this.bossSpawn());
    m.hidden = false;
    m.dead = false;
    for (const k of Object.keys(m.st)) m.st[k] = 0;
    m.carry = null;
    m.bossHp = F.BOSS_HP;
    m.state = 'boss';
    m.action = null;
    this.stage = 'boss';
    this.wardUntil = 0;
    this.wardsUsed = 0;
    this.orbs = [];
    this.wave = null;
    this.charge = null;
    this.portal = null;
    this.grapplers.clear();
    this.timers = { volley: this.t + 2.5, wave: this.t + 5, charge: this.t + 7 };
    this.bossAt = this.t;
    this.game.emitAll({ type: 'boss:start', floor: m.floor, x: r2(m.x), z: r2(m.z), hp: F.BOSS_HP });
  }

  // ---- the Archon --------------------------------------------------------------------

  /** Driver input moves the Archon; everyone else only looks. Returns true if handled. */
  onPlayerState(p, d) {
    if (!this.archon) return false;
    p.yaw = Number.isFinite(Number(d.yaw)) ? Number(d.yaw) : p.yaw;
    p.pitch = Math.max(-1.5, Math.min(1.5, Number(d.pitch) || 0));
    if (p.id !== this.archon.driverId || this.stage === 'merge') return true;
    const x = Number(d.x), z = Number(d.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return true;
    const A = this.archon;
    const now = Date.now();
    const dt = Math.max(0.05, (now - (A.lastAt ?? now)) / 1000);
    A.lastAt = now;
    const moved = Math.hypot(x - A.x, z - A.z);
    if (moved <= SPEED.sprint * F.ARCHON_SPEED * 1.6 * dt + 0.75 && !this.game.insideWall(A.floor, x, z)) {
      A.x = x;
      A.z = z;
      A.yaw = p.yaw;
    }
    return true;
  }

  /** Every wizard is the Archon: keep their bodies on it. */
  followArchon() {
    const A = this.archon;
    for (const p of this.game.players.values()) {
      p.x = A.x;
      p.z = A.z;
      p.floor = A.floor;
      p.captured = false;
    }
  }

  damageArchon(amount, kind) {
    const g = this.game;
    if (!this.inFight() || g.phase !== PHASE.ARCHON) return 'none';
    const ps = [...g.players.values()];
    if (ps.some((p) => g.spells.hasBuff(p, 'union'))) {
      g.emitAll({ type: 'player:immune', id: this.archon.driverId, attacker: this.boss.id });
      return 'immune';
    }
    if (ps.some((p) => g.spells.isShielded(p))) {
      g.emitAll({ type: 'monster:blocked', id: this.boss.id, targetId: this.archon.driverId });
      return 'blocked';
    }
    let dmg = amount;
    if (ps.some((p) => g.spells.hasBuff(p, 'granite'))) dmg *= 0.4;
    this.archon.hp = Math.max(0, this.archon.hp - dmg);
    g.emitAll({ type: 'archon:hit', amount: Math.round(dmg), hp: Math.ceil(this.archon.hp), kind });
    if (this.archon.hp <= 0) {
      g.phaseBefore = PHASE.ARCHON;
      g.setPhase(PHASE.GAMEOVER);
      g.emitAll({ type: 'gameover', hostId: g.lobby.hostId, archon: true });
    }
    return 'hit';
  }

  /** Patronus / Tree heals land on the shared body. */
  healArchon(amount) {
    if (this.archon) this.archon.hp = Math.min(F.ARCHON_HP, this.archon.hp + amount);
  }

  // ---- the Unbound Amalgam -----------------------------------------------------------

  /** Any damage to the boss (spells are scaled up; masteries are not). */
  hitBoss(amount, source) {
    const m = this.boss;
    if (!this.inFight() || amount <= 0) return;
    if (this.t < this.wardUntil) {
      this.game.emitAll({ type: 'boss:warded', x: r2(m.x), z: r2(m.z), floor: m.floor });
      return;
    }
    const dealt = source === 'mastery' ? amount : amount * F.BOSS_SPELL_SCALE;
    const floor = this.stage === 'portal' ? 1 : 0; // in the portal stage it can't be killed, only dragged under
    m.bossHp = Math.max(floor, m.bossHp - dealt);
    this.game.emitAll({ type: 'monster:damage', id: m.id, amount: Math.round(dealt), source, hp: Math.ceil(m.bossHp) });
    const frac = m.bossHp / F.BOSS_HP;
    if (this.wardsUsed < F.WARDS.length && frac <= F.WARDS[this.wardsUsed]) {
      this.wardsUsed++;
      this.wardUntil = this.t + F.WARD_TIME;
      this.game.emitAll({ type: 'boss:ward', duration: F.WARD_TIME, x: r2(m.x), z: r2(m.z), floor: m.floor });
      this.volley(m, 24);
    }
    if (this.stage === 'boss' && frac <= F.PORTAL_AT) this.openPortal();
  }

  openPortal() {
    const a = this.altar;
    this.stage = 'portal';
    this.portal = { x: a.x, z: a.z, floor: a.floor };
    this.charge = null;
    this.boss.action = null;
    this.game.emitAll({ type: 'portal:open', floor: a.floor, x: r2(a.x), z: r2(a.z) });
  }

  volley(m, count = 16) {
    const A = this.archon;
    const aim = Math.atan2(A.z - m.z, A.x - m.x);
    for (let i = 0; i < count; i++) {
      const ang = aim + (i / count) * Math.PI * 2;
      this.orbs.push({ id: this.nextOrbId++, x: m.x, z: m.z, floor: m.floor, vx: Math.cos(ang) * F.ORB_SPEED, vz: Math.sin(ang) * F.ORB_SPEED, until: this.t + F.ORB_LIFE });
    }
    // and three aimed straight at the Archon
    for (let k = -1; k <= 1; k++) {
      const ang = aim + k * 0.12;
      this.orbs.push({ id: this.nextOrbId++, x: m.x, z: m.z, floor: m.floor, vx: Math.cos(ang) * F.ORB_SPEED * 1.4, vz: Math.sin(ang) * F.ORB_SPEED * 1.4, until: this.t + F.ORB_LIFE });
    }
    this.game.emitAll({ type: 'boss:volley', x: r2(m.x), z: r2(m.z), floor: m.floor });
  }

  /** Called from Monster.update while it's in the 'boss' state (and able to act). */
  updateBoss(m, dt) {
    const t = this.t;
    if (this.stage === 'merge') {
      if (t >= this.mergeUntil) this.beginBoss();
      return;
    }
    if (!this.inFight()) return;
    const A = this.archon;
    const d = Math.hypot(A.x - m.x, A.z - m.z);

    // Telegraphed charge
    if (this.charge) {
      const c = this.charge;
      if (t < c.startAt) {
        m.faceToward(A, dt, 10);
        return;
      }
      if (!c.dir) {
        const dd = Math.max(1e-3, d);
        c.dir = { x: (A.x - m.x) / dd, z: (A.z - m.z) / dd };
        c.until = t + F.CHARGE_TIME;
        m.action = 'lunge';
      }
      const r = moveCircle(this.game.world, m.floor, m.x, m.z, c.dir.x * F.CHARGE_SPEED * dt, c.dir.z * F.CHARGE_SPEED * dt, m.radius);
      m.x = r.x;
      m.z = r.z;
      m.moving = true;
      if (!c.hit && Math.hypot(A.x - m.x, A.z - m.z) < 1.9) {
        c.hit = true;
        this.damageArchon(F.CHARGE_DAMAGE, 'charge');
      }
      if (t >= c.until) {
        this.charge = null;
        m.action = null;
      }
      return;
    }

    if (this.stage === 'portal') {
      // Claw away from the rift (sliding along walls when backed into one).
      const P = this.portal;
      const base = Math.atan2(m.z - P.z, m.x - P.x);
      const d0 = Math.hypot(m.x - P.x, m.z - P.z);
      let dir = base;
      for (const off of [0, 0.7, -0.7, 1.4, -1.4]) {
        const a = base + off;
        const r = moveCircle(this.game.world, m.floor, m.x, m.z, Math.cos(a) * 0.8, Math.sin(a) * 0.8, m.radius);
        if (Math.hypot(r.x - P.x, r.z - P.z) > d0 + 0.15) { dir = a; break; }
      }
      m.stepToward(m.x + Math.cos(dir) * 4, m.z + Math.sin(dir) * 4, F.CRAWL_SPEED, dt);
      m.action = 'crawl';
    } else {
      // Keep 5–9 units from the Archon, circling it.
      let goal;
      if (d > 9) goal = A;
      else if (d < 5) goal = { x: m.x * 2 - A.x, z: m.z * 2 - A.z };
      else goal = { x: m.x - (A.z - m.z) * 0.5, z: m.z + (A.x - m.x) * 0.5 };
      m.stepToward(goal.x, goal.z, 3.2, dt);
      m.faceToward(A, dt, 4);
    }

    const slow = this.stage === 'portal' ? 1.5 : 1;
    if (t >= this.timers.volley) {
      this.timers.volley = t + F.VOLLEY_EVERY * slow;
      this.volley(m);
    }
    if (t >= this.timers.wave && !this.wave) {
      this.timers.wave = t + F.WAVE_EVERY * slow;
      this.wave = { x: m.x, z: m.z, floor: m.floor, r: 0, startAt: t + F.WAVE_WINDUP, hit: false };
      m.action = 'shockwave';
      this.game.emitAll({ type: 'boss:wave', stage: 'windup', x: r2(m.x), z: r2(m.z), floor: m.floor, windup: F.WAVE_WINDUP });
    }
    if (this.stage === 'boss' && t >= this.timers.charge) {
      this.timers.charge = t + F.CHARGE_EVERY;
      this.charge = { startAt: t + F.CHARGE_WINDUP };
      m.action = 'windup';
      this.game.emitAll({ type: 'boss:charge', x: r2(m.x), z: r2(m.z), floor: m.floor, windup: F.CHARGE_WINDUP });
    }
  }

  // ---- Elemental Masteries (keys 1–7) ------------------------------------------------

  mastery(p, key, yaw) {
    const M = MASTERY_BY_KEY[key];
    if (!M || !this.inFight()) return { ok: false, reason: 'unavailable' };
    const left = (this.masteryReady[M.id] ?? 0) - this.t;
    if (left > 0) return { ok: false, reason: 'cooldown', remaining: left };
    this.masteryReady[M.id] = this.t + M.cooldown;
    const g = this.game, m = this.boss, A = this.archon;
    const dir = Number.isFinite(yaw) ? { x: -Math.sin(yaw), z: -Math.cos(yaw) } : { x: m.x - A.x, z: m.z - A.z };
    const ev = { type: 'mastery', id: M.id, key, by: p.id, name: p.name, floor: A.floor, x: r2(A.x), z: r2(A.z), to: { x: r2(m.x), z: r2(m.z) }, hit: true };
    const towardPortal = () => {
      if (!this.portal) return null;
      return { x: m.x * 2 - this.portal.x, z: m.z * 2 - this.portal.z }; // a point behind it, so the push goes *in*
    };
    switch (M.id) {
      case 'm_fire_dragon': {
        const len = Math.hypot(dir.x, dir.z) || 1;
        g.spells.spawnDragon({ x: A.x, z: A.z, floor: A.floor }, { id: M.id, speed: 18, damage: M.damage, burnDps: 3, burnDuration: 3, life: 10, blast: 4, mastery: true },
          { x: dir.x / len, z: dir.z / len }, ev, 'fire_dragon', m);
        ev.hit = false; // lands when the dragon arrives
        break;
      }
      case 'm_wind_dragon': {
        const from = towardPortal() ?? A;
        m.knockback(from.x, from.z, M.push, 0.35);
        m.damage(M.damage, 'mastery');
        break;
      }
      case 'm_water_deluge':
        m.damage(M.damage, 'mastery');
        m.slow(M.slow, 4);
        g.flood = { until: this.t + 6, slow: 0 };
        break;
      case 'm_earth_pillars':
        m.damage(M.damage, 'mastery');
        m.root(M.root);
        break;
      case 'm_white_chains':
        m.damage(M.damage, 'mastery');
        m.freeze(M.freeze);
        break;
      case 'm_black_torment':
        m.damage(M.damage, 'mastery');
        m.torment(M.interrupt, 6);
        this.charge = null;
        break;
      case 'm_antimagic_slash': {
        const dx = m.x - A.x, dz = m.z - A.z, dd = Math.hypot(dx, dz) || 1;
        const inCone = (x, z) => {
          const ox = x - A.x, oz = z - A.z, od = Math.hypot(ox, oz) || 1;
          return od <= M.range && (ox * dir.x + oz * dir.z) / (od * (Math.hypot(dir.x, dir.z) || 1)) >= Math.cos(M.cone);
        };
        const before = this.orbs.length;
        this.orbs = this.orbs.filter((o) => !inCone(o.x, o.z));
        ev.cleared = before - this.orbs.length;
        if (inCone(m.x, m.z) || dd < 3) {
          this.wardUntil = 0; // anti-magic unmakes the ward
          this.charge = null;
          m.action = null;
          m.damage(M.damage, 'mastery');
        } else ev.hit = false;
        break;
      }
    }
    g.emitAll(ev);
    return { ok: true, cooldown: M.cooldown };
  }

  /** A mastery fire dragon reached it (masteries hit at face value). */
  dragonHit(e, m) {
    m.damage(e.a.damage, e.a.mastery ? 'mastery' : 'fire');
  }

  setGrapple(p, on) {
    if (on && this.stage === 'portal') this.grapplers.add(p.id);
    else this.grapplers.delete(p.id);
  }

  // ---- per tick ---------------------------------------------------------------------

  update(dt) {
    const g = this.game;
    if (!this.archon) {
      if (g.phase === PHASE.CONVERGENCE) this.updateRitual(dt);
      return;
    }
    this.followArchon();
    if (g.phase !== PHASE.ARCHON) return;
    const t = this.t;
    const A = this.archon;
    const m = this.boss;

    // A bound boss can't keep charging.
    if (this.charge && !m.canAct()) {
      this.charge = null;
      m.action = null;
    }

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.x += o.vx * dt;
      o.z += o.vz * dt;
      if (t >= o.until || overlapsSolid(g.world, o.floor, o.x, o.z, 0.2)) { this.orbs.splice(i, 1); continue; }
      if (Math.hypot(o.x - A.x, o.z - A.z) < 1.25) {
        this.orbs.splice(i, 1);
        this.damageArchon(F.ORB_DAMAGE, 'orb');
      }
    }

    if (this.wave && t >= this.wave.startAt) {
      const w = this.wave;
      w.r += F.WAVE_SPEED * dt;
      if (!w.hit && Math.abs(Math.hypot(A.x - w.x, A.z - w.z) - w.r) < 0.9) {
        w.hit = true;
        this.damageArchon(F.WAVE_DAMAGE, 'wave');
      }
      if (w.r > F.WAVE_RANGE) {
        this.wave = null;
        if (m.action === 'shockwave') m.action = null;
      }
    }

    if (this.stage === 'portal') {
      const P = this.portal;
      const inRange = Math.hypot(A.x - m.x, A.z - m.z) <= F.GRAPPLE_RANGE;
      const n = inRange ? Math.min(3, this.grapplers.size) : 0;
      if (n > 0) {
        const dx = P.x - m.x, dz = P.z - m.z, d = Math.hypot(dx, dz) || 1;
        const step = Math.min(d, F.GRAPPLE_PULL * n * dt);
        const r = moveCircle(g.world, m.floor, m.x, m.z, (dx / d) * step, (dz / d) * step, m.radius);
        m.x = r.x;
        m.z = r.z;
      }
      if (Math.hypot(P.x - m.x, P.z - m.z) <= F.PORTAL_RADIUS) {
        this.stage = 'sealing';
        this.sealUntil = t + F.SEAL_TIME;
        this.orbs = [];
        this.wave = null;
        this.charge = null;
        m.action = 'sealed';
        g.emitAll({ type: 'sealing', duration: F.SEAL_TIME, floor: P.floor, x: r2(P.x), z: r2(P.z) });
      }
    }

    if (this.stage === 'sealing') {
      const P = this.portal;
      m.x += (P.x - m.x) * Math.min(1, dt * 2);
      m.z += (P.z - m.z) * Math.min(1, dt * 2);
      m.action = 'sealed';
      if (t >= this.sealUntil) this.victory();
    }
  }

  victory() {
    const g = this.game;
    this.stage = 'victory';
    this.boss.hidden = true;
    g.flood = null;
    g.dawn = null;
    g.setPhase(PHASE.EPILOGUE);
    g.emitAll({ type: 'victory', coven: g.roster(), hostId: g.lobby.hostId });
  }

  /** "Retry" after the Archon fell: merge again and refight the boss. */
  restart() {
    const a = this.altar;
    const spot = a.front ?? { x: a.x, z: a.z + 2 };
    Object.assign(this.archon, { x: spot.x, z: spot.z, hp: F.ARCHON_HP, driverId: this.pickDriver() });
    this.masteryReady = {};
    this.stage = 'merge';
    this.mergeUntil = this.t + F.MERGE_TIME;
    this.boss.hidden = true;
    this.boss.state = 'boss';
    this.game.emitAll({
      type: 'merge', floor: a.floor, x: r2(a.x), z: r2(a.z), ax: r2(spot.x), az: r2(spot.z), yaw: this.archon.yaw,
      duration: F.MERGE_TIME, driverId: this.archon.driverId, retry: true,
    });
  }

  snapshot() {
    if (!this.stage && this.game.phase !== PHASE.CONVERGENCE) return null;
    const m = this.boss;
    const A = this.archon;
    const mr = {};
    for (const M of MASTERIES) {
      const left = (this.masteryReady[M.id] ?? 0) - this.t;
      if (left > 0) mr[M.id] = r2(left);
    }
    return {
      stage: this.stage ?? 'ritual',
      rt: r2(this.ritual),
      ar: A ? { x: r2(A.x), z: r2(A.z), f: A.floor, yaw: Math.round(A.yaw * 1000) / 1000, hp: Math.ceil(A.hp), max: F.ARCHON_HP, drv: A.driverId } : null,
      boss: A ? { hp: Math.ceil(m.bossHp ?? F.BOSS_HP), max: F.BOSS_HP, ward: this.t < this.wardUntil } : null,
      portal: this.portal,
      orbs: this.orbs.map((o) => [r2(o.x), r2(o.z)]),
      wave: this.wave && this.t >= this.wave.startAt ? { x: r2(this.wave.x), z: r2(this.wave.z), r: r2(this.wave.r) } : null,
      mr,
      gr: this.grapplers.size,
      seal: this.stage === 'sealing' ? r2(1 - (this.sealUntil - this.t) / F.SEAL_TIME) : 0,
    };
  }
}
