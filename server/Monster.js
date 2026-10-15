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
//   hunting = LOCKED on the first wizard it spotted ───┘ (lock broken)
//      │ it tracks them anywhere, at a lethal charge; the lunge always captures
//      ▼
//   retreating (after a capture): 12–18 s hidden, then reappears → stalking
//
// Until all seven Hearts are destroyed it is UNKILLABLE: spells only stagger
// it for a moment (crowd control is capped at AI.CC_CAP) and never break the
// lock. Only three Ultimates can stop it and wipe its sight-lock:
//   Dawn of the Sacred Order (White)  frozen in golden chains for 30s
//   Abyssal Mind Fracture (Black)     its mind locked in place for 10s
//   Devil Union (Anti-magic)          touching an immune wizard: recoil + 6s freeze
//
// The Disillusionment Charm (V) hides a wizard from its sight, but only if
// cast BEFORE it locks on, and only while they hold still: moving or casting
// within INVIS.sense units of it gives them away, and it charges.
//
// While anyone is held in the Cage, stalking goals favour the basement
// (guarding the prisoner) without camping the gate. It can never enter a
// Sin's locked arena.
//
// Activity (Step 8). It hunts down whatever the coven DOES:
//   - Activity pings (Game.activity): a Sin task step, a spell, sprinting or
//     Lumos near a corridor, the cage gate breaking, a prisoner's call (G).
//   - Movement 1 room away: anyone moving in a room next to its own (the room
//     graph, shared/roomgraph.js) or within ADJACENT_RANGE units.
//   Either sends it from its patrol into INVESTIGATING: a brisk march to the
//   room's doorway (paced so its footsteps are heard for at least
//   INVESTIGATE_WARN seconds), in toward the spot, a 3–4s look around, and
//   back out. Its senses never change: whoever it sees is locked on, an
//   invisible wizard who moves (or keeps working a task) within INVIS.sense
//   is sensed. Toggle V before it steps in and stand completely still, and it
//   leaves without you.
//   - Crossing a doorway into another room only biases its patrol there.

import { MonsterBody } from './MonsterBody.js';
import { findPath, pathToWorld, isPassable } from '../shared/pathfinding.js';
import { lineOfSight, moveCircle } from '../shared/collision.js';
import { stairToward } from '../shared/nav.js';
import { PHASE, TILE_WALL, TILE_DOOR, HP, LUMOS, INVIS, tileCenter, worldToTile } from '../shared/constants.js';
import { buildRoomGraph, zoneAt, oneRoomAway } from '../shared/roomgraph.js';
import { FINALE } from '../shared/finale.js';

export const AI = {
  STALK_SPEED: 2.3,
  SEARCH_SPEED: 3.0,
  HUNT_SPEED: 4.8, // players sprint at 5.6 but run out of stamina
  CHARGE_SPEED: 6.4, // the lethal charge, once it has you in sight and close
  CHARGE_RANGE: 10,
  ENRAGE_PER_HEART: 0.12, // 5.64 u/s at seven Hearts
  AGGRO_PER_HEART: 0.08,
  STALK_MIN: 12,
  STALK_MAX: 22,
  TOO_CLOSE: 8,
  SIGHT: 16, // a wizard with a plain wand glow (Lumos ×1.5)
  SIGHT_SNEAK: 8, // crouched
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
  SPOT_TIME: 0.35, // seconds of continuous sight before it locks on
  CC_CAP: 0.8, // ordinary spells only hold the unkillable Keeper this long
  KNOCK_CAP: 2.5, // ...and shove it this far
  UNION_RECOIL: 6, // touching a Devil Union wizard: frozen this long
  RELEASE_BLIND: 1.5, // after a lock-break ends, it is blind this long
  SEARCH_TIME: 16,
  LISTEN_TIME: 2.5,
  RETREAT_MIN: 12,
  RETREAT_MAX: 18,
  RETREAT_FLEE: 1.0,
  // Attacks (all damage is to wizards' HP; see Game.damagePlayer)
  CLAW_RANGE: 2.6,
  CLAW_WINDUP: 0.35,
  CLAW_DAMAGE: 30,
  RECOVER: 0.8,
  GRAB_WINDUP: 0.3, // on a wizard at ≤ 40 HP: the grab that captures
  LUNGE_CHANCE: 0.22, // the heavy, telegraphed lunge: always captures
  SHOCK_WINDUP: 0.6,
  SHOCK_RADIUS: 3.5,
  SHOCK_DAMAGE: 15,
  SHOCK_COOLDOWN: 4,
  TENDRIL_HEARTS: 2,
  TENDRIL_RANGE: 7,
  TENDRIL_WINDUP: 0.5,
  TENDRIL_DAMAGE: 20,
  TENDRIL_COOLDOWN: 4,
  SMASH_HEARTS: 4,
  SMASH_WINDUP: 0.5,
  PHANTOM_HEARTS: 4,
  PHANTOM_LIFE: 4,
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
  // Step 8: activity and room movement
  INVESTIGATE_SPEED: 4.2, // the brisk march toward activity
  INVESTIGATE_WARN: 4, // at least this many seconds of footsteps before it reaches the doorway
  INVESTIGATE_MIN_SPEED: 1.6, // (it slows to keep that window, never below this)
  INVESTIGATE_ENTER: 1.8, // it stops this far from the activity's spot to look around
  INSPECT_MIN: 3,
  INSPECT_MAX: 4,
  INVESTIGATE_MAX: 40, // gives up on an unreachable room
  ADJACENT_RANGE: 18, // "1 room away" also means within this many units
  MOVE_SENSE_COOLDOWN: 3, // per wizard, between movement pings
  OVERRIDE_AFTER: 8, // a lower-priority ping can redirect its march after this long (not once it is in the room)
};

const rand = (a, b) => a + Math.random() * (b - a);
const r2 = (v) => Math.round(v * 100) / 100;

export class Monster extends MonsterBody {
  constructor(game) {
    super(game, { id: 'amalgam', kind: 'amalgam', x: 0, z: 0, floor: 0, maxHp: 999, radius: 0.55, speed: AI.HUNT_SPEED });
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
    this.attack = null;
    this.attackReadyAt = 0;
    this.shockReadyAt = 0;
    this.tendrilReadyAt = 0;
    this.phantomAt = 0;
    this.tauntUntil = 0;
    this.spotting = new Map(); // playerId -> seconds in continuous sight
    this.blindUntil = 0;
    this.rooms = buildRoomGraph(game.map); // Step 8: who is "1 room away"
    this.ping = null; // the activity it is investigating
    this.movedSensedAt = new Map(); // playerId -> last movement ping
    this.disturbance = null; // the last doorway someone crossed (biases its patrol)
  }

  /** Unkillable until the Hearts are gone (as the Unbound boss it has HP). */
  get immune() { return this.state !== 'boss'; }

  get targetable() {
    return !this.dead && !this.hidden && this.state !== 'dormant' && this.state !== 'haunt';
  }

  /** Walkable tiles per floor that the Amalgam may stand on (never inside the Cell). */
  buildTileIndex() {
    const { map } = this.game;
    const gate = map.props[map.ids.gate];
    return map.floors.map((f) => {
      const ff = { ...f, dyn: null };
      const list = [];
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          const i = y * f.w + x;
          if (!isPassable(ff, x, y)) continue;
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
    if (state !== 'investigating') this.ping = null;
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

  /** Shadow Step and the Disillusionment Charm (V) hide a wizard from its sight. */
  isInvisible(p) { return this.game.spells.hasBuff(p, 'shadow') || this.game.spells.hasBuff(p, 'invis'); }

  /** Is it locked on to p (hunting them)? */
  lockedOn(p) { return this.state === 'hunting' && this.targetId === p?.id; }

  /** Tiles it may use as goals: never inside a Sin's locked arena. */
  goalTiles(floor) {
    const arena = this.game.arenaRoom;
    return arena ? this.tiles[floor].filter((tl) => !arena.call(this.game, tl.roomId)) : this.tiles[floor];
  }

  /** Wizards it can actually perceive. */
  prey() { return this.freePlayers().filter((p) => !this.isInvisible(p)); }

  dist(a) { return Math.hypot(a.x - this.x, a.z - this.z); }

  nearestFree() {
    let best = null;
    for (const p of this.prey()) {
      const score = this.dist(p) + (p.floor === this.floor ? 0 : 60);
      if (!best || score < best.score) best = { p, score };
    }
    return best?.p ?? null;
  }

  los(a, b, floor) { return lineOfSight(this.game.map, floor, a.x, a.z, b.x, b.z); }

  /** Could the Amalgam see player p right now (stalking senses: view cone, lit wands carry further)? */
  canSee(p) {
    if (this.hidden || p.floor !== this.floor || this.isInvisible(p) || this.t < this.blindUntil) return false;
    const d = this.dist(p);
    const range = (p.crouch ? AI.SIGHT_SNEAK : AI.SIGHT) * (p.light ? LUMOS.detection : 1);
    if (d > range) return false;
    if (d > 4) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      if (((p.x - this.x) * fx + (p.z - this.z) * fz) / d < AI.FOV_COS) return false;
    }
    return this.los(this, p, this.floor);
  }

  /** Would it see p right now if p weren't invisible? (V cast in front of it fails.) */
  wouldSee(p) {
    if (this.hidden || p.floor !== this.floor || this.t < this.blindUntil || !this.canAct()) return false;
    const d = this.dist(p);
    const range = (p.crouch ? AI.SIGHT_SNEAK : AI.SIGHT) * (p.light ? LUMOS.detection : 1);
    if (d > range) return false;
    if (d > 4) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      if (((p.x - this.x) * fx + (p.z - this.z) * fz) / d < AI.FOV_COS) return false;
    }
    return this.los(this, p, this.floor);
  }

  /** Is (x, z) inside any free wizard's beam? A plain wand glow reaches 16u; Lumos 28u and wider. */
  inLight(pt, floor) {
    return this.freePlayers().some((p) => {
      if (p.floor !== floor) return false;
      const range = p.light ? LUMOS.range : 16;
      const cos = p.light ? Math.cos(LUMOS.angle * 0.7) : AI.HAUNT_LIT_COS;
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
    const tiles = this.goalTiles(floor);
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

  /** Hunting speed: enrages with every destroyed Heart (Black Slash strips it). */
  huntSpeed() {
    const hearts = Math.min(7, this.game.destroyed.size);
    return AI.HUNT_SPEED + (this.isCalm() ? 0 : AI.ENRAGE_PER_HEART * hearts);
  }

  aggressionNow() {
    if (this.aggression === 0 || this.isCalm()) return this.aggression;
    return this.aggression + AI.AGGRO_PER_HEART * this.game.destroyed.size;
  }

  /** Shadow Step: too late once it has locked on — it still tracks them. */
  loseTarget() {}

  /** Bull Thrust: it turns on the wizard who struck it. */
  taunt(p, seconds) {
    if (['dormant', 'haunt', 'retreating'].includes(this.state) || this.hidden) return;
    if (this.state !== 'hunting' || this.targetId !== p.id) {
      this.setState('hunting');
      this.targetId = p.id;
      this.lastSeenAt = this.t;
      this.game.emitAll({ type: 'monster:hunt', targetId: p.id, reason: 'taunt' });
    }
    this.lastKnown = { x: p.x, z: p.z, floor: p.floor };
    this.tauntUntil = this.t + seconds;
  }

  onDropped() {
    if (this.state === 'hunting') this.search({ x: this.x, z: this.z, floor: this.floor });
  }

  /**
   * Walk toward a goal on any floor (taking the nearest staircase on the
   * route when needed). Returns the remaining distance on the goal's floor,
   * or Infinity.
   */
  travelTo(goal, speed, dt) {
    const g = this.game;
    let target = goal;
    if (goal.floor !== this.floor) {
      const stairs = stairToward(g.map, this.floor, this.x, this.z, goal.floor);
      if (!stairs) return Infinity;
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

  /**
   * Lock on to p and charge. It keeps the FIRST wizard it locks on to (only a
   * taunt redirects it); an invisible wizard can only be locked on to when
   * they give themselves away ('sensed').
   */
  hunt(p, reason) {
    if (!p || p.captured || p.capturing || this.hidden) return;
    if (this.isInvisible(p) && !['sensed', 'taunt', 'debug'].includes(reason)) return;
    if (this.game.inArena?.(p)) return; // behind a Sin's blood-runes: out of its reach
    if (['dormant', 'haunt', 'retreating', 'boss'].includes(this.state)) return;
    if (!this.canAct() && reason !== 'debug') return; // chained, or its mind locked
    if (this.state === 'hunting') return; // already locked: the first one it saw
    this.setState('hunting');
    this.targetId = p.id;
    this.lastKnown = { x: p.x, z: p.z, floor: p.floor };
    this.lastSeenAt = this.t;
    this.spotting.clear();
    this.game.emitAll({ type: 'monster:hunt', targetId: p.id, reason, lock: true });
  }

  /**
   * One of the three Ultimates (or a Sin's blood-runes) wiped its sight-lock.
   * It forgets its target and, once free to move again, is blind for a moment.
   */
  breakLock(reason, holdFor = 0) {
    const was = this.state === 'hunting' ? this.targetId : null;
    if (this.state === 'hunting' || this.state === 'searching') this.setState('stalking');
    this.targetId = null;
    this.attack = null;
    this.spotting.clear();
    this.tauntUntil = 0;
    this.blindUntil = Math.max(this.blindUntil, this.t + holdFor + AI.RELEASE_BLIND);
    this.goal = null;
    this.game.emitAll({ type: 'monster:lockbroken', reason, targetId: was, hold: holdFor });
  }

  /** Devil Union: it touched an immune wizard. It recoils, frozen, and forgets. */
  recoilFromUnion(p) {
    if (this.state === 'boss' || this.isFrozen()) return;
    super.freeze(AI.UNION_RECOIL);
    this.game.emitAll({ type: 'monster:recoil', id: this.id, by: p?.id, floor: this.floor, x: r2(this.x), z: r2(this.z), duration: AI.UNION_RECOIL });
    this.breakLock('union', AI.UNION_RECOIL);
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
    if (!['stalking', 'searching', 'investigating'].includes(this.state) || this.hidden || !this.canAct()) return;
    const sameFloor = p.floor === this.floor;
    if (kind === 'heart') {
      // A Heart died: it goes to see (it never knows who).
      return this.search({ x: p.x, z: p.z, floor: p.floor });
    }
    if (radius !== Infinity && (!sameFloor || this.dist(p) > radius)) return;
    if (this.isInvisible(p)) {
      if (sameFloor && this.dist(p) <= INVIS.sense) this.hunt(p, 'sensed');
      return;
    }
    if (kind === 'decoy') this.search({ x: p.x, z: p.z, floor: p.floor });
    else this.hunt(p, kind);
  }

  /**
   * Sight and the invisible: a wizard in plain view for SPOT_TIME seconds is
   * locked on to; an invisible one who moves or casts within INVIS.sense units
   * is sensed (and locked on to) at once. Standing still while invisible: it
   * walks right past.
   */
  updateSenses(dt) {
    if (this.hidden || !['stalking', 'searching', 'investigating'].includes(this.state) || !this.canAct()) return;
    for (const p of this.freePlayers()) {
      if (p.floor !== this.floor) continue;
      if (this.isInvisible(p)) {
        this.spotting.delete(p.id);
        const d = this.dist(p);
        // Casting, or still working a task / a lock with your hands, gives you away too.
        const acted = this.t - (p.actAt ?? -Infinity) < 0.6 || !!p.channel;
        if (d <= INVIS.sense && (p.moving || acted) && this.t >= this.blindUntil) return this.hunt(p, 'sensed');
        continue;
      }
      if (this.canSee(p)) {
        const v = (this.spotting.get(p.id) ?? 0) + dt;
        this.spotting.set(p.id, v);
        if (v >= AI.SPOT_TIME || this.dist(p) < 3) return this.hunt(p, 'sighted');
      } else {
        this.spotting.delete(p.id);
      }
    }
  }

  updateStares(dt) {
    if (this.hidden || !['stalking', 'searching'].includes(this.state)) return;
    for (const p of this.prey()) {
      let staring = false;
      if (p.floor === this.floor) {
        const dx = this.x - p.x, dz = this.z - p.z, d = Math.hypot(dx, dz);
        if (d < AI.STARE_RANGE * (p.light ? LUMOS.detection : 1) && d > 1e-3) {
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

  // ---- spells against it ----------------------------------------------------------------
  //
  // Unkillable until the Hearts are gone: damage does nothing, and ordinary
  // crowd control only staggers it for AI.CC_CAP seconds without breaking its
  // lock. Dawn ('dawn') and the Mind Fracture ('fracture') hold it for their
  // full duration and wipe the lock. As the Unbound boss it has its own health
  // pool (Finale.hitBoss) and a 2.5s cap on everything.

  damage(amount, source) {
    if (this.state === 'boss') return this.game.finale.hitBoss(amount, source);
    if (amount <= 0 || this.dead) return;
    this.game.emitAll({ type: 'monster:damage', id: this.id, amount: 0, source, immune: true, hp: this.hp });
  }

  /** How long ordinary crowd control may hold it. */
  cap(d) { return this.state === 'boss' ? Math.min(d, FINALE.BOSS_CC_CAP) : Math.min(d, AI.CC_CAP); }

  freeze(d, src) {
    if (src === 'dawn' && this.state !== 'boss') {
      // Dawn of the Sacred Order: chained in golden light, its sight wiped.
      super.freeze(d);
      return this.breakLock('dawn', d);
    }
    super.freeze(this.cap(d));
  }
  confuse(d, dps, src) {
    if (src === 'fracture' && this.state !== 'boss') {
      // Abyssal Mind Fracture: its mind locked in place, clawing at itself.
      super.confuse(d, dps);
      return this.breakLock('fracture', d);
    }
    super.confuse(this.cap(d), dps);
  }
  root(d) { super.root(this.cap(d)); }
  pin(d) { super.pin(this.cap(d)); }
  lift(d) { super.lift(this.cap(d)); }
  stun(d) { super.stun(this.cap(d)); }
  torment(i, r) { super.torment(this.cap(i), r); }
  pull(x, z, d, speed) { super.pull(x, z, this.cap(d), speed); }
  knockback(fromX, fromZ, distance, time, fallbackDir) {
    if (this.state === 'boss') return super.knockback(fromX, fromZ, distance, time, fallbackDir);
    super.knockback(fromX, fromZ, Math.min(distance, AI.KNOCK_CAP), Math.min(time, 0.3), fallbackDir);
  }
  /** The wind dragon can't carry it off: it slams it (toward the portal, if open). */
  sweep(path, speed, stagger) {
    if (this.state !== 'boss') {
      const end = path.at(-1) ?? { x: this.x + 1, z: this.z };
      return this.knockback(this.x * 2 - end.x, this.z * 2 - end.z, AI.KNOCK_CAP, 0.3);
    }
    const P = this.game.finale.portal;
    const from = P ? { x: this.x * 2 - P.x, z: this.z * 2 - P.z } : this.game.finale.archon ?? this;
    super.knockback(from.x, from.z, 6, 0.4);
    this.st.staggerUntil = Math.max(this.st.staggerUntil, this.t + 1);
  }
  burn(dps, d, slow) { super.burn(this.state === 'boss' ? dps : 0, d, slow); }

  /** An attack bounced off a Void shield: a stagger, never a lock-break. */
  block() { super.block(); }

  /** It cannot die outside the finale. */
  die() {
    if (this.state === 'boss') return super.die();
    this.hp = this.maxHp;
    this.dead = false;
  }

  guarding() { return this.game.prisoners().length > 0; }

  // ---- per-tick --------------------------------------------------------------------

  update(dt) {
    this.updateStatus(dt);
    this.moving = false;
    if (this.game.phase === PHASE.GAMEOVER) return;
    if (this.state === 'boss') {
      const finale = this.game.finale;
      if (this.canAct() || finale.stage === 'merge') finale.updateBoss(this, dt);
      else this.action = this.isConfused() ? 'confused' : null;
      return;
    }
    if (this.state === 'dormant' && this.game.phase !== PHASE.TOME && !this.debugHeld) this.awaken();
    this.hp = this.maxHp; // unkillable (fire and its own claws included)
    // Devil Union: touching an immune wizard throws it back, frozen and forgetful.
    if (!this.hidden && this.canAct() && ['stalking', 'hunting', 'searching'].includes(this.state)) {
      for (const p of this.freePlayers()) {
        if (p.floor === this.floor && this.dist(p) < this.radius + 0.75 && this.game.spells.hasBuff(p, 'union')) return this.recoilFromUnion(p);
      }
    }
    this.updateStares(dt);
    this.updateSenses(dt);
    this.senseMovement();
    if (!this.canAct() && this.state !== 'retreating' && this.state !== 'dormant') {
      this.action = this.isConfused() ? 'confused' : null;
      this.attack = null;
      return;
    }
    switch (this.state) {
      case 'dormant': return this.updateDormant();
      case 'haunt': return this.updateHaunt(dt);
      case 'stalking': return this.updateStalking(dt);
      case 'hunting': return this.updateHunting(dt);
      case 'searching': return this.updateSearching(dt);
      case 'investigating': return this.updateInvestigating(dt);
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
    // Somewhere 14–24 units off, in view but out of everyone's light; corners and
    // doorways first. With every wand glowing that can leave nothing, so relax:
    // any such tile, then 10–28 units out of just the victim's own beam.
    const inBeamOf = (q, tile) => {
      const dx = tile.x - q.x, dz = tile.z - q.z, d = Math.hypot(dx, dz);
      const range = q.light ? LUMOS.range : 16;
      return d <= range && (dx * -Math.sin(q.yaw) + dz * -Math.cos(q.yaw)) / Math.max(d, 1e-3) > AI.HAUNT_LIT_COS;
    };
    const ring = (min, max) => this.tiles[p.floor].filter((tile) => {
      const d = Math.hypot(tile.x - p.x, tile.z - p.z);
      return d >= min && d <= max && this.los(p, tile, p.floor);
    });
    const near = ring(14, 24).filter((tile) => !this.inLight(tile, p.floor));
    const tiers = [
      near.filter((tile) => tile.door || tile.corner),
      near,
      ring(10, 28).filter((tile) => !inBeamOf(p, tile)),
    ];
    const pool = tiers.find((tier) => tier.length) ?? [];
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
    const tiles = this.goalTiles(prey.floor);
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

  /** Brief phantom Amalgams in the corners of your eye (4+ Hearts). */
  spawnPhantoms(prey) {
    const spots = [];
    for (const tile of this.tiles[prey.floor]) {
      if (spots.length >= 2) break;
      if (Math.random() > 0.05) continue;
      const d = Math.hypot(tile.x - prey.x, tile.z - prey.z);
      if (d < 10 || d > 18 || !this.los(prey, tile, prey.floor)) continue;
      spots.push({ x: tile.x, z: tile.z, yaw: Math.atan2(-(prey.x - tile.x), -(prey.z - tile.z)) });
    }
    if (spots.length) this.game.emitAll({ type: 'monster:phantoms', floor: prey.floor, spots, life: AI.PHANTOM_LIFE });
  }

  updateStalking(dt) {
    // It prowls toward where the wizards are (even unseen ones: it smells them),
    // but it only locks on through updateSenses().
    let prey = null;
    for (const p of this.freePlayers()) {
      const score = this.dist(p) + (p.floor === this.floor ? 0 : 60);
      if (!prey || score < prey.score) prey = { p, score };
    }
    prey = prey?.p;
    if (!prey) return;
    const t = this.t;
    if (this.game.destroyed.size >= AI.PHANTOM_HEARTS && t >= this.phantomAt) {
      const first = this.phantomAt === 0;
      this.phantomAt = t + rand(16, 26);
      if (!first) this.spawnPhantoms(prey);
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
    if (this.game.inArena?.(p)) return this.breakLock('arena'); // the blood-runes sever its sight
    if (this.attack) return this.updateAttack(p, dt);

    // Locked on: it always knows where they are, invisible or not, on any floor.
    this.lastKnown = { x: p.x, z: p.z, floor: p.floor };
    const sees = p.floor === this.floor && this.los(this, p, this.floor);
    if (sees) this.lastSeenAt = t;

    const d = p.floor === this.floor ? this.dist(p) : Infinity;
    const hearts = this.game.destroyed.size;
    if (sees && t >= this.attackReadyAt) {
      if (d < AI.CLAW_RANGE * this.reachScale()) return this.startAttack(this.chooseMelee(p), p);
      if (hearts >= AI.TENDRIL_HEARTS && d >= 3 && d <= AI.TENDRIL_RANGE * this.reachScale() && t >= this.tendrilReadyAt) {
        return this.startAttack('tendril', p);
      }
    }
    // Tears through Earth barricades (4+ Hearts).
    if (hearts >= AI.SMASH_HEARTS && t >= this.attackReadyAt) {
      const b = this.game.spells.barrierNear(this.floor, this.x, this.z, 2.4);
      if (b) return this.startAttack('smash', p, { barrierId: b.id });
    }
    // The lethal charge once it has them in sight and close; otherwise it runs them down.
    const charging = sees && d < AI.CHARGE_RANGE;
    this.travelTo({ x: p.x, z: p.z, floor: p.floor }, charging ? Math.max(AI.CHARGE_SPEED, this.huntSpeed()) : this.huntSpeed(), dt);
  }

  /** Pick a close-range attack. */
  chooseMelee(p) {
    if (this.forceLunge) {
      this.forceLunge = false;
      return 'lunge';
    }
    // Locked on: its catch is the capture. Crowded, it may sweep them all back first.
    const crowd = this.prey().filter((o) => o.floor === this.floor && this.dist(o) <= AI.SHOCK_RADIUS).length;
    if (this.t >= this.shockReadyAt && crowd >= 3 && Math.random() < 0.35) return 'shockwave';
    return p.hp <= HP.CAPTURE_AT ? 'grab' : 'lunge';
  }

  startAttack(kind, p, extra = {}) {
    const windup = {
      claw: AI.CLAW_WINDUP, grab: AI.GRAB_WINDUP, lunge: AI.LUNGE_WINDUP,
      shockwave: AI.SHOCK_WINDUP, tendril: AI.TENDRIL_WINDUP, smash: AI.SMASH_WINDUP,
    }[kind];
    this.attack = { kind, strikeAt: this.t + windup, ...extra };
    // Lunges/grabs telegraph with the classic windup pose.
    this.action = kind === 'lunge' || kind === 'grab' ? 'windup' : kind;
    this.game.emitAll({ type: 'monster:attack', kind, stage: 'windup', id: this.id, targetId: p.id, floor: this.floor, x: r2(this.x), z: r2(this.z), windup });
  }

  updateAttack(p, dt) {
    const t = this.t;
    const a = this.attack;
    if (a.kind === 'dash') {
      const r = moveCircle(this.game.world, this.floor, this.x, this.z, a.dir.x * AI.LUNGE_SPEED * dt, a.dir.z * AI.LUNGE_SPEED * dt, this.radius);
      this.x = r.x;
      this.z = r.z;
      this.moving = true;
      if (p.floor === this.floor && this.dist(p) < AI.CATCH_RANGE + this.radius) {
        this.attack = null;
        this.action = null;
        this.attackReadyAt = t + AI.LUNGE_COOLDOWN;
        return this.landed(this.game.damagePlayer(p, AI.CLAW_DAMAGE, this, a.grab));
      }
      if (t >= a.end) {
        this.attack = null;
        this.action = null;
        this.attackReadyAt = t + AI.LUNGE_COOLDOWN;
      }
      return;
    }
    this.faceToward(p, dt, 12);
    if (t < a.strikeAt) return;

    this.attack = null;
    this.action = null;
    this.attackReadyAt = t + AI.RECOVER;
    const reach = AI.CLAW_RANGE * this.reachScale() + 0.5;
    switch (a.kind) {
      case 'grab':
      case 'lunge': {
        const d = Math.max(1e-3, this.dist(p));
        this.attack = { kind: 'dash', grab: a.kind, end: t + AI.LUNGE_DASH, dir: { x: (p.x - this.x) / d, z: (p.z - this.z) / d } };
        this.action = 'lunge';
        return;
      }
      case 'claw': {
        const hit = p.floor === this.floor && this.dist(p) <= reach;
        this.game.emitAll({ type: 'monster:attack', kind: 'claw', stage: 'strike', id: this.id, targetId: p.id, hit, floor: this.floor, x: r2(this.x), z: r2(this.z) });
        if (hit) return this.landed(this.game.damagePlayer(p, AI.CLAW_DAMAGE, this, 'claw'));
        return;
      }
      case 'shockwave': {
        this.shockReadyAt = t + AI.SHOCK_COOLDOWN;
        this.game.emitAll({ type: 'monster:attack', kind: 'shockwave', stage: 'strike', id: this.id, floor: this.floor, x: r2(this.x), z: r2(this.z), r: AI.SHOCK_RADIUS });
        let captured = false;
        for (const o of this.prey()) {
          if (o.floor !== this.floor || this.dist(o) > AI.SHOCK_RADIUS) continue;
          if (this.game.damagePlayer(o, AI.SHOCK_DAMAGE, this, 'shockwave') === 'captured') captured = true;
        }
        if (captured) this.banish('capture');
        return;
      }
      case 'tendril': {
        this.tendrilReadyAt = t + AI.TENDRIL_COOLDOWN;
        const hit = p.floor === this.floor && this.dist(p) <= AI.TENDRIL_RANGE * this.reachScale() + 0.5 && this.los(this, p, this.floor);
        this.game.emitAll({ type: 'monster:attack', kind: 'tendril', stage: 'strike', id: this.id, targetId: p.id, hit, floor: this.floor, x: r2(this.x), z: r2(this.z), tx: r2(p.x), tz: r2(p.z) });
        if (hit) return this.landed(this.game.damagePlayer(p, AI.TENDRIL_DAMAGE, this, 'tendril'));
        return;
      }
      case 'smash':
        this.game.emitAll({ type: 'monster:attack', kind: 'smash', stage: 'strike', id: this.id, floor: this.floor, x: r2(this.x), z: r2(this.z), barrierId: a.barrierId });
        this.game.spells.hitBarrier(a.barrierId);
        return;
    }
  }

  /** After an attack resolves on a wizard. */
  landed(result) {
    if (result === 'captured') this.banish('capture');
  }

  updateSearching(dt) {
    const t = this.t;
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
        .filter((r) => r.floor === this.floor && r.type !== 'cell' && !this.game.arenaRoom?.(r.id))
        .map((r) => ({ x: tileCenter(r.cx), z: tileCenter(r.cy), floor: r.floor }))
        .filter((pt) => this.dist(pt) < 26)
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);
      this.searchPoints = rooms.length ? rooms : [this.hiddenSpot(this.floor, 0)];
    }
    if (this.travelTo(this.searchPoints[0], AI.SEARCH_SPEED, dt) < 1.2) this.searchPoints.shift();
  }

  // ---- Step 8: activity, room movement, investigation ---------------------------------

  /** Patrolling (not locked on, not busy with something louder). */
  idle() {
    return !this.hidden && this.canAct() && ['stalking', 'searching'].includes(this.state) && this.game.phase !== PHASE.TOME;
  }

  /**
   * Something happened at `ping` = { x, z, floor, kind, priority, by?, look? }:
   * drop the patrol and go and check that room. Returns true if it goes.
   */
  investigate(ping) {
    if (this.hidden || !this.canAct() || this.game.phase === PHASE.TOME) return false;
    if (!['stalking', 'searching', 'investigating'].includes(this.state)) return false;
    const roomId = zoneAt(this.game.map, ping.floor, ping.x, ping.z);
    if (roomId >= 0 && this.game.arenaRoom?.(roomId)) return false; // a sealed lockdown: none of its business
    const cur = this.ping;
    if (this.state === 'investigating' && cur) {
      if (roomId >= 0 && roomId === cur.roomId && ping.floor === cur.floor) {
        // Same room: it just listens harder for the new spot.
        Object.assign(cur, { x: ping.x, z: ping.z, look: ping.look ?? { x: ping.x, z: ping.z }, kind: ping.kind, by: ping.by ?? cur.by });
        cur.priority = Math.max(cur.priority, ping.priority);
        return true;
      }
      // Something quieter can turn it while it is still on its way (after a while), never once it has stepped in.
      if (ping.priority < cur.priority && (cur.stage !== 'approach' || this.t - cur.at < AI.OVERRIDE_AFTER)) return false;
    }
    const entry = this.entryFor(ping, roomId);
    const route = this.routeLength(entry);
    this.setState('investigating');
    this.targetId = null;
    this.ping = {
      x: ping.x, z: ping.z, floor: ping.floor, roomId, kind: ping.kind, priority: ping.priority, by: ping.by ?? null,
      look: ping.look ?? { x: ping.x, z: ping.z }, enter: ping.enter !== false, at: this.t, entry, stage: 'approach', stageAt: this.t,
      // Paced: its footsteps are heard for at least INVESTIGATE_WARN seconds before it reaches the doorway.
      speed: Math.max(AI.INVESTIGATE_MIN_SPEED, Math.min(AI.INVESTIGATE_SPEED, route / AI.INVESTIGATE_WARN)),
    };
    this.game.emitAll({
      type: 'monster:investigate', kind: ping.kind, floor: ping.floor, x: r2(ping.x), z: r2(ping.z), roomId,
      room: roomId >= 0 ? this.game.map.rooms[roomId].name : null, by: ping.by ?? null,
      eta: r2(route / this.ping.speed),
    });
    return true;
  }

  /** The doorway it will come through: the room's door nearest to it (or the spot itself, in a corridor). */
  entryFor(ping, roomId) {
    if (roomId < 0) return { x: ping.x, z: ping.z, floor: ping.floor };
    const doors = this.rooms[ping.floor].doors.get(roomId) ?? [];
    let best = null;
    for (const d of doors) {
      const score = ping.floor === this.floor ? Math.hypot(d.x - this.x, d.z - this.z) : Math.hypot(d.x - ping.x, d.z - ping.z);
      if (!best || score < best.score) best = { d, score };
    }
    return best ? { x: best.d.x, z: best.d.z, floor: ping.floor, door: true } : { x: ping.x, z: ping.z, floor: ping.floor };
  }

  /** Walking distance to `pt` on its own floor (Infinity on another floor or unreachable). */
  routeLength(pt) {
    if (pt.floor !== this.floor) return Infinity;
    const tiles = findPath(this.game.map.floors[this.floor], worldToTile(this.x), worldToTile(this.z), worldToTile(pt.x), worldToTile(pt.z), 6000);
    if (!tiles?.length) return Math.hypot(pt.x - this.x, pt.z - this.z);
    let len = 0;
    const w = pathToWorld(tiles);
    for (let i = 1; i < w.length; i++) len += Math.hypot(w[i].x - w[i - 1].x, w[i].z - w[i - 1].z);
    return len + Math.hypot(w[0].x - this.x, w[0].z - this.z);
  }

  /** March to the doorway, step in toward the spot, look around, leave. */
  updateInvestigating(dt) {
    const pg = this.ping;
    const t = this.t;
    if (!pg || t - pg.at > AI.INVESTIGATE_MAX) return this.endInvestigation();
    const stage = (s) => { pg.stage = s; pg.stageAt = t; };
    switch (pg.stage) {
      case 'approach': {
        this.action = null;
        if (this.travelTo(pg.entry, pg.speed, dt) < 0.8) {
          if (pg.enter) return stage('enter');
          stage('inspect'); // (the cage: it looks in from the gate)
          pg.until = t + rand(AI.INSPECT_MIN, AI.INSPECT_MAX);
        }
        return;
      }
      case 'enter': {
        const left = this.travelTo({ ...pg.look, floor: pg.floor }, AI.STALK_SPEED, dt);
        if (left < AI.INVESTIGATE_ENTER || t - pg.stageAt > 8) {
          stage('inspect');
          pg.until = t + rand(AI.INSPECT_MIN, AI.INSPECT_MAX);
        }
        return;
      }
      case 'inspect': {
        // It looks around the spot: its head (and its sight) sweep the room.
        this.action = 'listen';
        pg.baseYaw ??= Math.atan2(-(pg.look.x - this.x), -(pg.look.z - this.z));
        this.yaw = pg.baseYaw + Math.sin((t - pg.stageAt) * 1.7) * 1.2;
        if (t >= pg.until) this.endInvestigation();
        return;
      }
      default: return this.endInvestigation();
    }
  }

  /** Nothing there: back out the way it came, and on with its patrol. */
  endInvestigation() {
    const pg = this.ping;
    this.ping = null;
    this.setState('stalking');
    if (pg?.entry && pg.entry.floor === this.floor) {
      this.goal = { x: pg.entry.x, z: pg.entry.z, floor: pg.entry.floor, peek: false };
      this.goalUntil = this.t + 8;
    }
    this.lastInvestigation = { roomId: pg?.roomId ?? -1, floor: pg?.floor, at: this.t, stage: pg?.stage };
  }

  /** Anyone moving 1 room away (or within ADJACENT_RANGE) is heard: it goes to check. */
  senseMovement() {
    if (!this.idle()) return;
    for (const p of this.freePlayers()) {
      if (p.floor !== this.floor || !p.moving || this.game.inArena?.(p)) continue;
      if (this.t - (this.movedSensedAt.get(p.id) ?? -Infinity) < AI.MOVE_SENSE_COOLDOWN) continue;
      if (!oneRoomAway(this.rooms, this.game.map, this.floor, this.x, this.z, p.x, p.z, AI.ADJACENT_RANGE)) continue;
      this.movedSensedAt.set(p.id, this.t);
      if (this.investigate({ x: p.x, z: p.z, floor: p.floor, kind: 'movement', priority: 2, by: p.id })) return;
    }
  }

  /**
   * A wizard crossed a doorway into another room: a faint disturbance there.
   * If it is patrolling this floor, it turns its patrol toward that room.
   */
  crossed(p, roomId, door) {
    this.disturbance = { roomId, floor: p.floor, x: door.x, z: door.z, at: this.t, by: p.id };
    if (this.state !== 'stalking' || this.hidden || !this.canAct() || p.floor !== this.floor) return false;
    this.goal = { x: door.x, z: door.z, floor: p.floor, peek: true, disturbance: true };
    this.goalUntil = this.t + 10;
    this.peekUntil = 0;
    return true;
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
      ...(this.ping ? { ip: this.ping.stage } : {}),
      tg: this.targetId,
      x: r2(this.x),
      z: r2(this.z),
    };
  }
}
