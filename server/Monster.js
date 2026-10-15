// THE MALPHAS AMALGAM: the mansion's Keeper.
//
// Built on MonsterBody, so every spell status from Step 3 applies unchanged.
//
//   dormant ──(timer)──► haunt ──(lit by a wand / timeout)──► dormant
//      │ Tome read
//      ▼
//   stalking ◄──────────────────────────────┐
//      │ seen too close / stare / noise /    │
//      │ random aggression                   │ search exhausted
//      ▼                                     │
//   hunting ──(lost sight)──► searching ─────┘
//      │ lunge lands → capture
//      ▼
//   retreating (also: stagger HP depleted, or 3 different spells within 5s)
//      └─ 12–18 s hidden, then reappears out of sight → stalking
//
// While anyone is held in the Cell, stalking goals favour the basement
// (guarding the prisoner) without camping the gate.

import { MonsterBody } from './MonsterBody.js';
import { findPath, pathToWorld } from '../shared/pathfinding.js';
import { lineOfSight, moveCircle } from '../shared/collision.js';
import { PHASE, TILE_WALL, TILE_DOOR, tileCenter, worldToTile } from '../shared/constants.js';

export const AI = {
  STALK_SPEED: 2.3,
  SEARCH_SPEED: 3.0,
  HUNT_SPEED: 4.4, // players sprint at 5.6 but run out of stamina
  ENRAGE_PER_HEART: 0.25,
  STALK_MIN: 12,
  STALK_MAX: 22,
  TOO_CLOSE: 8,
  SIGHT_LIT: 22,
  SIGHT_DARK: 10,
  SIGHT_SNEAK: 6,
  FOV_COS: Math.cos(1.1),
  STARE_TIME: 1.5,
  STARE_RANGE: 14,
  STARE_COS: Math.cos(0.26),
  LUNGE_RANGE: 2.4,
  LUNGE_WINDUP: 0.3,
  LUNGE_DASH: 0.25,
  LUNGE_SPEED: 8,
  CATCH_RANGE: 1.4,
  LUNGE_COOLDOWN: 1.2,
  LOSE_SIGHT: 3.5,
  HUNT_MAX: 40,
  SEARCH_TIME: 16,
  LISTEN_TIME: 2.5,
  RETREAT_MIN: 12,
  RETREAT_MAX: 18,
  RETREAT_FLEE: 1.0,
  STAGGER_HP: 40,
  COMBO_WINDOW: 5,
  COMBO_COUNT: 3,
  HAUNT_FIRST: 20,
  HAUNT_MIN: 35,
  HAUNT_MAX: 75,
  HAUNT_LIFE: 6,
  HAUNT_LIT_COS: Math.cos(0.38),
  HAUNT_LIT_GRACE: 0.3, // a lit glimpse before it vanishes
  AGGRO_INTERVAL: 7,
  AGGRO_CHANCE: 0.3,
  GUARD_CHANCE: 0.65, // chance a stalking goal pulls it down to the basement
  GUARD_STAY_CHANCE: 0.85, // ...and that it keeps prowling once it is down there
  GUARD_GATE_DIST: 6,
};

const rand = (a, b) => a + Math.random() * (b - a);
const r2 = (v) => Math.round(v * 100) / 100;

export class Monster extends MonsterBody {
  constructor(game) {
    super(game, { id: 'amalgam', kind: 'amalgam', x: 0, z: 0, floor: 0, maxHp: AI.STAGGER_HP, radius: 0.55, speed: AI.HUNT_SPEED });
    this.hidden = true;
    this.state = 'dormant';
    this.stateAt = 0;
    this.targetId = null;
    this.lastKnown = null;
    this.lastSeenAt = 0;
    this.goal = null;
    this.goalUntil = 0;
    this.peekUntil = 0;
    this.path = [];
    this.pathKey = '';
    this.repathAt = 0;
    this.stares = new Map();
    this.hits = [];
    this.aggroAt = 0;
    this.aggression = AI.AGGRO_CHANCE;
    this.lungeAt = 0;
    this.lungeEnd = 0;
    this.lungeDir = null;
    this.lungeReadyAt = 0;
    this.nextHauntAt = AI.HAUNT_FIRST + Math.random() * 20;
    this.hauntStart = 0;
    this.searchPoints = [];
    this.listenUntil = 0;
    this.retreatHideAt = 0;
    this.until = 0;
    this.tiles = this.buildTileIndex();
  }

  get targetable() {
    return !this.dead && !this.hidden && this.state !== 'dormant' && this.state !== 'haunt';
  }

  /** Walkable tiles per floor that the Amalgam may stand on (never inside the Cell). */
  buildTileIndex() {
    const { map } = this.game;
    const gate = map.props[map.ids.gate];
    return map.floors.map((f) => {
      const list = [];
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          const i = y * f.w + x;
          if (f.tiles[i] === TILE_WALL || f.blocked[i]) continue;
          if (f.id === map.cell.floor && f.roomIds[i] === map.cell.roomId) continue;
          if (f.id === gate.floor && x === gate.tx && y === gate.ty) continue;
          let walls = 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (f.tiles[(y + dy) * f.w + x + dx] === TILE_WALL) walls++;
          list.push({ x: tileCenter(x), z: tileCenter(y), floor: f.id, door: f.tiles[i] === TILE_DOOR, corner: walls >= 2, roomId: f.roomIds[i] });
        }
      }
      return list;
    });
  }

  // ---- helpers ------------------------------------------------------------------

  setState(state) {
    this.state = state;
    this.stateAt = this.t;
    this.path = [];
    this.goal = null;
    this.action = null;
    this.peekUntil = 0;
  }

  freePlayers() {
    return [...this.game.players.values()].filter((p) => !p.captured && !p.capturing);
  }

  dist(a) { return Math.hypot(a.x - this.x, a.z - this.z); }

  nearestFree() {
    let best = null;
    for (const p of this.freePlayers()) {
      const score = this.dist(p) + (p.floor === this.floor ? 0 : 60);
      if (!best || score < best.score) best = { p, score };
    }
    return best?.p ?? null;
  }

  los(a, b, floor) { return lineOfSight(this.game.map, floor, a.x, a.z, b.x, b.z); }

  /** Could the Amalgam see player p right now (stalking senses: view cone, lit wands carry further)? */
  canSee(p) {
    if (this.hidden || p.floor !== this.floor) return false;
    const d = this.dist(p);
    const range = p.light ? AI.SIGHT_LIT : p.crouch ? AI.SIGHT_SNEAK : AI.SIGHT_DARK;
    if (d > range) return false;
    if (d > 4) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      if (((p.x - this.x) * fx + (p.z - this.z) * fz) / d < AI.FOV_COS) return false;
    }
    return this.los(this, p, this.floor);
  }

  /** Is (x, z) inside any free player's wand cone? */
  inLight(pt, floor, range = 15, cos = 0.8) {
    return this.freePlayers().some((p) => {
      if (!p.light || p.floor !== floor) return false;
      const dx = pt.x - p.x, dz = pt.z - p.z, d = Math.hypot(dx, dz);
      if (d > range || d < 1e-3) return false;
      return (dx * -Math.sin(p.yaw) + dz * -Math.cos(p.yaw)) / d > cos && this.los(p, pt, floor);
    });
  }

  visibleToAnyone(pt, floor, range = 28) {
    return this.freePlayers().some((p) => p.floor === floor && Math.hypot(pt.x - p.x, pt.z - p.z) < range && this.los(p, pt, floor));
  }

  /**
   * A random tile unseen by every wizard, between minDist and maxDist from the
   * nearest of them, for appearing or hiding.
   */
  hiddenSpot(floor, minDist = 20, maxDist = Infinity) {
    const tiles = this.tiles[floor];
    let fallback = null;
    for (let i = 0; i < 400; i++) {
      const tile = tiles[Math.floor(Math.random() * tiles.length)];
      const nearest = Math.min(...this.freePlayers().filter((p) => p.floor === floor).map((p) => Math.hypot(tile.x - p.x, tile.z - p.z)), Infinity);
      if (nearest < minDist || nearest > maxDist) {
        if (!fallback || (nearest >= minDist && nearest < fallback.d)) fallback = { tile, d: nearest };
        continue;
      }
      if (!this.visibleToAnyone(tile, floor)) return tile;
      fallback = { tile, d: nearest };
    }
    return fallback.tile;
  }

  place(spot) {
    this.x = spot.x;
    this.z = spot.z;
    this.floor = spot.floor;
    this.path = [];
  }

  faceToward(p, dt, rate = 6) {
    const want = Math.atan2(-(p.x - this.x), -(p.z - this.z));
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const max = rate * this.turnMultiplier() * dt;
    this.yaw += Math.max(-max, Math.min(max, d));
  }

  huntSpeed() { return AI.HUNT_SPEED + AI.ENRAGE_PER_HEART * this.game.destroyed.size; }

  /**
   * Walk toward a goal on any floor (taking the servants' stair when needed).
   * Returns the remaining distance on the goal's floor, or Infinity.
   */
  travelTo(goal, speed, dt) {
    const g = this.game;
    let target = goal;
    if (goal.floor !== this.floor) {
      const stairs = g.props[this.floor === 0 ? g.map.ids.stairsDown : g.map.ids.stairsUp];
      if (this.dist(stairs.front) < 1.0) {
        const to = stairs.target;
        this.place({ x: to.x, z: to.z, floor: to.floor });
        this.yaw = to.yaw;
        return Infinity;
      }
      target = stairs.front;
    }
    const key = `${this.floor}:${worldToTile(target.x)},${worldToTile(target.z)}`;
    if (this.t >= this.repathAt || key !== this.pathKey) {
      const f = g.map.floors[this.floor];
      const tiles = findPath(f, worldToTile(this.x), worldToTile(this.z), worldToTile(target.x), worldToTile(target.z), 6000);
      this.path = tiles ? pathToWorld(tiles) : [];
      this.pathKey = key;
      this.repathAt = this.t + 0.5;
    }
    while (this.path.length && this.dist(this.path[0]) < 0.5) this.path.shift();
    const next = this.path.length > 1 ? this.path[0] : target;
    this.stepToward(next.x, next.z, speed, dt);
    return goal.floor === this.floor ? this.dist(goal) : Infinity;
  }

  // ---- transitions ------------------------------------------------------------------

  /** The Tome has been read. */
  awaken() {
    if (this.state !== 'dormant' && this.state !== 'haunt') return;
    const reader = this.nearestFree();
    this.place(this.hiddenSpot(reader?.floor ?? 0, 18));
    this.hidden = false;
    this.setState('stalking');
    this.game.emitAll({ type: 'monster:awaken' });
  }

  hunt(p, reason) {
    if (!p || p.captured || p.capturing || this.hidden) return;
    if (['dormant', 'haunt', 'retreating'].includes(this.state)) return;
    if (this.state === 'hunting' && this.targetId === p.id) return;
    this.setState('hunting');
    this.targetId = p.id;
    this.lastKnown = { x: p.x, z: p.z, floor: p.floor };
    this.lastSeenAt = this.t;
    this.game.emitAll({ type: 'monster:hunt', targetId: p.id, reason });
  }

  search(at) {
    this.setState('searching');
    this.targetId = null;
    this.lastKnown = at ?? this.lastKnown ?? { x: this.x, z: this.z, floor: this.floor };
    this.searchPoints = [];
    this.listenUntil = 0;
  }

  banish(reason) {
    if (['dormant', 'haunt', 'retreating'].includes(this.state)) return;
    this.setState('retreating');
    this.action = 'retreat';
    this.targetId = null;
    this.retreatHideAt = this.t + AI.RETREAT_FLEE;
    this.until = this.t + rand(AI.RETREAT_MIN, AI.RETREAT_MAX);
    this.hits = [];
    this.hp = this.maxHp;
    this.game.emitAll({ type: 'monster:banished', reason });
  }

  /** Disappear for `seconds` then come back stalking (used after a phase restart). */
  hideFor(seconds) {
    this.setState('retreating');
    this.hidden = true;
    this.retreatHideAt = this.t;
    this.until = this.t + seconds;
  }

  reappear() {
    const prey = this.nearestFree();
    const floor = this.guarding() && Math.random() < AI.GUARD_STAY_CHANCE ? this.game.map.cell.floor : prey?.floor ?? 0;
    this.place(this.hiddenSpot(floor, 20));
    this.hidden = false;
    this.setState('stalking');
  }

  /** Back to the state the current phase calls for (debug "auto"). */
  resume() {
    if (this.game.phase === PHASE.TOME) {
      this.hidden = true;
      this.setState('dormant');
      this.nextHauntAt = this.t + rand(AI.HAUNT_MIN, AI.HAUNT_MAX);
    } else if (this.hidden) {
      this.reappear();
    } else {
      this.setState('stalking');
    }
  }

  // ---- senses -------------------------------------------------------------------

  /** A noise at a player's position; `radius` = how far it carries (Infinity = everywhere). */
  hear(p, radius, kind) {
    if (!['stalking', 'searching'].includes(this.state) || this.hidden) return;
    const sameFloor = p.floor === this.floor;
    if (radius !== Infinity && (!sameFloor || this.dist(p) > radius)) return;
    if (kind === 'decoy') this.search({ x: p.x, z: p.z, floor: p.floor });
    else this.hunt(p, kind);
  }

  updateStares(dt) {
    if (this.hidden || !['stalking', 'searching'].includes(this.state)) return;
    for (const p of this.freePlayers()) {
      let staring = false;
      if (p.light && p.floor === this.floor) {
        const dx = this.x - p.x, dz = this.z - p.z, d = Math.hypot(dx, dz);
        if (d < AI.STARE_RANGE && d > 1e-3) {
          const dot = (dx * -Math.sin(p.yaw) + dz * -Math.cos(p.yaw)) / d;
          staring = dot > AI.STARE_COS && this.los(p, this, this.floor);
        }
      }
      const v = staring ? (this.stares.get(p.id) ?? 0) + dt : 0;
      this.stares.set(p.id, v);
      if (v >= AI.STARE_TIME) {
        this.stares.set(p.id, 0);
        if (Math.random() < 0.55) this.duck(p);
        else this.hunt(p, 'stare');
        return;
      }
    }
  }

  /** Slip out of a staring wizard's sight; with no cover nearby, charge instead. */
  duck(p) {
    let best = null;
    for (const tile of this.tiles[this.floor]) {
      const d = this.dist(tile);
      if (d > 14 || (best && d >= best.d) || this.los(p, tile, this.floor)) continue;
      best = { tile, d };
    }
    if (!best) return this.hunt(p, 'stare');
    this.setState('stalking');
    this.goal = { ...best.tile, peek: false };
    this.goalUntil = this.t + 5;
  }

  noteHit(source) {
    if (['dormant', 'haunt', 'retreating'].includes(this.state)) return;
    const t = this.t;
    this.hits = this.hits.filter((h) => t - h.t < AI.COMBO_WINDOW && h.source !== source);
    this.hits.push({ source, t });
    if (this.hits.length >= AI.COMBO_COUNT) this.banish('combo');
  }

  // Every spell effect also counts toward the "combined elements" banish.
  damage(amount, source) { super.damage(amount, source); this.noteHit(source); }
  torment(i, r) {
    super.torment(i, r);
    this.noteHit('black');
    if (this.state === 'hunting') this.search(this.lastKnown); // the chase is broken
  }
  stun(d) {
    super.stun(d);
    this.noteHit('white');
    if (this.state === 'hunting') this.search(this.lastKnown); // blinded: loses the target
  }
  knockback(...args) { super.knockback(...args); this.noteHit('wind'); }
  slow(f, d) { super.slow(f, d); if (d > 1) this.noteHit('water'); }
  burn(...args) { super.burn(...args); this.noteHit('fire'); }

  /** Stagger HP ran out: it doesn't die, it flees. */
  die() {
    this.hp = this.maxHp;
    this.banish('stagger');
  }

  guarding() { return this.game.prisoners().length > 0; }

  // ---- per-tick --------------------------------------------------------------------

  update(dt) {
    this.updateStatus(dt);
    this.moving = false;
    if (this.game.phase === PHASE.GAMEOVER) return;
    if (this.state === 'dormant' && this.game.phase !== PHASE.TOME && !this.debugHeld) this.awaken();
    this.updateStares(dt);
    if (!this.canAct() && this.state !== 'retreating' && this.state !== 'dormant') {
      this.action = null;
      return;
    }
    switch (this.state) {
      case 'dormant': return this.updateDormant();
      case 'haunt': return this.updateHaunt(dt);
      case 'stalking': return this.updateStalking(dt);
      case 'hunting': return this.updateHunting(dt);
      case 'searching': return this.updateSearching(dt);
      case 'retreating': return this.updateRetreating(dt);
    }
  }

  updateDormant() {
    this.hidden = true;
    if (this.t >= this.nextHauntAt) this.startHaunt();
  }

  startHaunt(victim) {
    const players = this.freePlayers();
    const p = victim ?? players[Math.floor(Math.random() * players.length)];
    if (!p) return;
    // Somewhere 14–24 units off, in view but out of the light; corners and doorways first.
    const candidates = this.tiles[p.floor].filter((tile) => {
      const d = Math.hypot(tile.x - p.x, tile.z - p.z);
      return d >= 14 && d <= 24 && this.los(p, tile, p.floor) && !this.inLight(tile, p.floor, 26, AI.HAUNT_LIT_COS);
    });
    const peeks = candidates.filter((tile) => tile.door || tile.corner);
    const pool = peeks.length ? peeks : candidates;
    const best = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    if (!best) {
      this.nextHauntAt = this.t + 10;
      return;
    }
    this.place(best);
    this.yaw = Math.atan2(-(p.x - this.x), -(p.z - this.z));
    this.hidden = false;
    this.setState('haunt');
    this.action = 'peek';
    this.targetId = p.id;
    this.hauntStart = this.t;
    this.litFor = 0;
    this.game.emitAll({ type: 'monster:haunt', targetId: p.id });
  }

  updateHaunt(dt) {
    const p = this.game.players.get(this.targetId);
    if (p) this.faceToward(p, dt, 2);
    // Caught in a wand beam it lingers for a heartbeat (so you *see* it), then it's gone.
    if (this.inLight(this, this.floor, 26, AI.HAUNT_LIT_COS)) this.litFor = (this.litFor ?? 0) + dt;
    else this.litFor = 0;
    const lit = this.litFor >= AI.HAUNT_LIT_GRACE;
    if (lit || this.t - this.hauntStart > AI.HAUNT_LIFE) {
      this.hidden = true;
      this.setState('dormant');
      this.targetId = null;
      this.nextHauntAt = this.t + rand(AI.HAUNT_MIN, AI.HAUNT_MAX);
      this.game.emitAll({ type: 'monster:vanish', lit });
    }
  }

  pickStalkGoal(prey) {
    const { map } = this.game;
    // Already downstairs: mostly stay near the prisoner.
    const guardChance = this.floor === map.cell.floor ? AI.GUARD_STAY_CHANCE : AI.GUARD_CHANCE;
    if (this.guarding() && Math.random() < guardChance) {
      // Guard the prisoner: prowl the basement, but keep off the gate.
      const gate = map.props[map.ids.gate];
      const tiles = this.tiles[map.cell.floor].filter((tl) => Math.hypot(tl.x - gate.x, tl.z - gate.z) >= AI.GUARD_GATE_DIST);
      const tile = tiles[Math.floor(Math.random() * tiles.length)];
      return { ...tile, peek: false, guard: true };
    }
    const tiles = this.tiles[prey.floor];
    let best = null;
    for (let i = 0; i < 70; i++) {
      const tile = tiles[Math.floor(Math.random() * tiles.length)];
      const d = Math.hypot(tile.x - prey.x, tile.z - prey.z);
      if (d < AI.STALK_MIN || d > AI.STALK_MAX) continue;
      let score = Math.random() * 1.5;
      if (!this.visibleToAnyone(tile, prey.floor)) score += 3;
      if (tile.door) score += 2;
      if (tile.corner) score += 1;
      if (this.inLight(tile, prey.floor)) score -= 4;
      if (!best || score > best.score) best = { tile, score };
    }
    if (!best) return { ...this.hiddenSpot(prey.floor, AI.STALK_MIN), peek: false };
    return { ...best.tile, peek: best.tile.door || best.tile.corner };
  }

  updateStalking(dt) {
    const prey = this.nearestFree();
    if (!prey) return;
    const t = this.t;
    if (this.canSee(prey)) {
      if (this.dist(prey) < AI.TOO_CLOSE) return this.hunt(prey, 'close');
      if (t >= this.aggroAt) {
        this.aggroAt = t + AI.AGGRO_INTERVAL;
        if (Math.random() < this.aggression) return this.hunt(prey, 'aggression');
      }
    }
    if (t < this.peekUntil) {
      this.action = 'peek';
      if (prey.floor === this.floor) this.faceToward(prey, dt, 3);
      return;
    }
    this.action = null;
    if (!this.goal || t >= this.goalUntil) {
      this.goal = this.pickStalkGoal(prey);
      // Commit to a goal on another floor until we get there, or it flip-flops.
      this.goalUntil = t + (this.goal.floor !== this.floor ? 45 : 7);
    }
    const crossing = this.goal.floor !== this.floor;
    const left = this.travelTo(this.goal, crossing ? AI.SEARCH_SPEED : AI.STALK_SPEED, dt);
    if (left < 0.7) {
      if (this.goal.peek) this.peekUntil = t + rand(1.5, 3);
      this.goal = null;
    }
  }

  updateHunting(dt) {
    const t = this.t;
    const p = this.game.players.get(this.targetId);
    if (!p || p.captured || p.capturing) return this.search(this.lastKnown);

    if (this.action === 'windup') {
      this.faceToward(p, dt, 12);
      if (t >= this.lungeAt) {
        this.action = 'lunge';
        this.lungeEnd = t + AI.LUNGE_DASH;
        const d = Math.max(1e-3, this.dist(p));
        this.lungeDir = { x: (p.x - this.x) / d, z: (p.z - this.z) / d };
      }
      return;
    }
    if (this.action === 'lunge') {
      const r = moveCircle(this.game.world, this.floor, this.x, this.z,
        this.lungeDir.x * AI.LUNGE_SPEED * dt, this.lungeDir.z * AI.LUNGE_SPEED * dt, this.radius);
      this.x = r.x;
      this.z = r.z;
      this.moving = true;
      if (p.floor === this.floor && this.dist(p) < AI.CATCH_RANGE + this.radius) return this.resolveLunge(p);
      if (t >= this.lungeEnd) {
        this.action = null;
        this.lungeReadyAt = t + AI.LUNGE_COOLDOWN;
      }
      return;
    }

    // Hunting senses: it tracks its prey in every direction.
    const sees = p.floor === this.floor && this.dist(p) < 30 && this.los(this, p, this.floor);
    if (sees) {
      this.lastKnown = { x: p.x, z: p.z, floor: p.floor };
      this.lastSeenAt = t;
    } else if (t - this.lastSeenAt > AI.LOSE_SIGHT) {
      return this.search(this.lastKnown);
    }
    if (t - this.stateAt > AI.HUNT_MAX) return this.search(this.lastKnown);

    if (sees && this.dist(p) < AI.LUNGE_RANGE && t >= this.lungeReadyAt) {
      this.action = 'windup';
      this.lungeAt = t + AI.LUNGE_WINDUP;
      return;
    }
    // Chase where it saw them last; through the stairs if they changed floor.
    const goal = sees ? p : (p.floor !== this.floor && t - this.lastSeenAt < 1 ? { x: p.x, z: p.z, floor: p.floor } : this.lastKnown);
    this.travelTo(goal, this.huntSpeed(), dt);
  }

  resolveLunge(p) {
    this.action = null;
    this.lungeReadyAt = this.t + AI.LUNGE_COOLDOWN;
    if (this.game.spells.isShielded(p)) {
      this.block();
      this.game.emitAll({ type: 'monster:blocked', id: this.id, targetId: p.id });
      return;
    }
    if (this.game.capture(p, this)) this.banish('capture');
  }

  updateSearching(dt) {
    const t = this.t;
    for (const p of this.freePlayers()) if (this.canSee(p)) return this.hunt(p, 'sighted');
    if (t - this.stateAt > AI.SEARCH_TIME) return this.setState('stalking');

    if (this.lastKnown && !this.listenUntil) {
      if (this.travelTo(this.lastKnown, AI.SEARCH_SPEED, dt) < 1) {
        this.listenUntil = t + AI.LISTEN_TIME;
        this.action = 'listen';
      }
      return;
    }
    if (t < this.listenUntil) return;
    this.action = null;
    if (!this.searchPoints.length) {
      // Sweep a couple of nearby rooms (corridor loops), nearest first.
      const rooms = this.game.map.rooms
        .filter((r) => r.floor === this.floor && r.type !== 'cell')
        .map((r) => ({ x: tileCenter(r.cx), z: tileCenter(r.cy), floor: r.floor }))
        .filter((pt) => this.dist(pt) < 26)
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);
      this.searchPoints = rooms.length ? rooms : [this.hiddenSpot(this.floor, 0)];
    }
    if (this.travelTo(this.searchPoints[0], AI.SEARCH_SPEED, dt) < 1.2) this.searchPoints.shift();
  }

  updateRetreating(dt) {
    const t = this.t;
    if (!this.hidden) {
      if (t < this.retreatHideAt) {
        // Flee away from the nearest wizard while melting into the dark.
        const p = this.nearestFree();
        if (p && p.floor === this.floor) this.stepToward(this.x * 2 - p.x, this.z * 2 - p.z, AI.HUNT_SPEED, dt);
        return;
      }
      this.hidden = true;
      this.action = null;
    }
    if (t >= this.until) this.reappear();
  }

  snapshot() {
    return {
      ...super.snapshot(),
      state: this.state,
      hid: this.hidden,
      tg: this.targetId,
      x: r2(this.x),
      z: r2(this.z),
    };
  }
}
