// Physical body + status effects shared by every hostile creature: the debug
// Training Husk now, the Keeper (Step 4) later. Spells talk to this interface
// only, so every effect verified against the Husk works on the real Monster.

import { moveCircle } from '../shared/collision.js';

const r2 = (v) => Math.round(v * 100) / 100;
const TURN_RATE = 7; // rad/s at full health of the legs

/** Status codes sent to clients, in display order. */
export const STATUS = ['stun', 'torment', 'slow', 'burn', 'knock', 'block', 'reveal'];

export class MonsterBody {
  constructor(game, { id, kind, x, z, floor, maxHp, radius, speed }) {
    this.game = game;
    this.id = id;
    this.kind = kind;
    this.x = x;
    this.z = z;
    this.floor = floor;
    this.yaw = 0;
    this.radius = radius;
    this.baseSpeed = speed;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.dead = false;
    this.hidden = false; // not in the world at all (dormant, retreated)
    this.moving = false;
    this.action = null;
    this.st = {
      stunUntil: 0,
      tormentUntil: 0,
      revealUntil: 0,
      slowUntil: 0,
      slowFactor: 0,
      wetUntil: 0,
      turnSlow: 0,
      burnUntil: 0,
      burnDps: 0,
      burnSlow: 0,
      knockLeft: 0, // units of knockback still to travel
      staggerUntil: 0,
      kvx: 0,
      kvz: 0,
      blockedUntil: 0,
    };
  }

  get t() { return this.game.time; }

  /** Can spells and projectiles hit it right now? */
  get targetable() { return !this.dead && !this.hidden; }

  isStunned() { return this.t < this.st.stunUntil; }
  isTormented() { return this.t < this.st.tormentUntil; }
  isRevealed() { return this.t < this.st.revealUntil; }
  isSlowed() { return this.t < this.st.slowUntil || this.t < this.st.wetUntil; }
  isBurning() { return this.t < this.st.burnUntil; }
  isKnocked() { return this.t < this.st.staggerUntil; }
  isBlocked() { return this.t < this.st.blockedUntil; }
  /** Can it move/attack of its own will right now? */
  canAct() { return !this.dead && !this.isStunned() && !this.isKnocked(); }

  speedMultiplier() {
    let m = 1;
    if (this.t < this.st.slowUntil) m *= 1 - this.st.slowFactor;
    if (this.isBurning()) m *= 1 - this.st.burnSlow;
    return m;
  }

  turnMultiplier() { return this.t < this.st.wetUntil ? 1 - this.st.turnSlow : 1; }

  // ---- effects (called by SpellSystem) ---------------------------------------

  damage(amount, source) {
    if (this.dead || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.game.emitAll({ type: 'monster:damage', id: this.id, amount, source, hp: r2(this.hp) });
    if (this.hp <= 0) this.die();
  }

  stun(duration) {
    this.st.stunUntil = Math.max(this.st.stunUntil, this.t + duration);
    this.action = null;
    this.onBlinded?.();
  }

  torment(interrupt, reveal) {
    this.st.tormentUntil = Math.max(this.st.tormentUntil, this.t + interrupt);
    this.st.revealUntil = Math.max(this.st.revealUntil, this.t + reveal);
    this.action = null;
    this.onChaseInterrupted?.();
    this.game.emitAll({ type: 'monster:scream', id: this.id, floor: this.floor, x: r2(this.x), z: r2(this.z) });
  }

  slow(factor, duration) {
    const active = this.t < this.st.slowUntil;
    this.st.slowFactor = active ? Math.max(this.st.slowFactor, factor) : factor;
    this.st.slowUntil = Math.max(this.st.slowUntil, this.t + duration);
  }

  /** Standing in a slick puddle: slowed turning (movement slow comes via slow()). */
  wet(turnSlow, duration) {
    this.st.turnSlow = turnSlow;
    this.st.wetUntil = Math.max(this.st.wetUntil, this.t + duration);
  }

  burn(dps, duration, slow) {
    this.st.burnDps = dps;
    this.st.burnSlow = slow;
    this.st.burnUntil = Math.max(this.st.burnUntil, this.t + duration);
  }

  /**
   * Shove the body `distance` units directly away from (fromX, fromZ) over
   * `time` seconds. Movement goes through moveCircle every tick, so walls,
   * props and barricades stop it: it can never be pushed out of the map.
   */
  knockback(fromX, fromZ, distance, time, fallbackDir) {
    let dx = this.x - fromX, dz = this.z - fromZ;
    let len = Math.hypot(dx, dz);
    if (len < 1e-3 && fallbackDir) { dx = fallbackDir.x; dz = fallbackDir.z; len = 1; }
    if (len < 1e-3) return;
    this.st.kvx = (dx / len) * (distance / time);
    this.st.kvz = (dz / len) * (distance / time);
    this.st.knockLeft = distance;
    this.st.staggerUntil = this.t + time + 0.4;
    this.action = null;
  }

  /** An attack bounced off a Void shield. */
  block() {
    this.st.blockedUntil = this.t + 1.2;
    this.st.staggerUntil = Math.max(this.st.staggerUntil, this.t + 0.6);
    this.action = null;
  }

  die() {
    this.dead = true;
    this.action = null;
    this.onDeath?.();
  }

  // ---- simulation -------------------------------------------------------------

  updateStatus(dt) {
    if (this.dead) return;
    if (this.isBurning()) {
      this.hp = Math.max(0, this.hp - this.st.burnDps * dt);
      if (this.hp <= 0) return this.die();
    }
    if (this.st.knockLeft > 0) {
      const speed = Math.hypot(this.st.kvx, this.st.kvz);
      const k = Math.min(1, this.st.knockLeft / (speed * dt));
      this.st.knockLeft = Math.max(0, this.st.knockLeft - speed * dt);
      const r = moveCircle(this.game.world, this.floor, this.x, this.z, this.st.kvx * dt * k, this.st.kvz * dt * k, this.radius);
      this.x = r.x;
      this.z = r.z;
    }
  }

  /** Turn toward a world point (rate-limited, slowed when wet) and walk forward. */
  stepToward(tx, tz, speed, dt) {
    const want = Math.atan2(-(tx - this.x), -(tz - this.z));
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const maxTurn = TURN_RATE * this.turnMultiplier() * dt;
    this.yaw += Math.max(-maxTurn, Math.min(maxTurn, d));
    // Walk mostly along the facing direction so slowed turning really matters.
    const align = Math.max(0, Math.cos(d));
    const step = speed * this.speedMultiplier() * dt * align;
    if (step <= 1e-4) return;
    const r = moveCircle(this.game.world, this.floor, this.x, this.z, -Math.sin(this.yaw) * step, -Math.cos(this.yaw) * step, this.radius);
    this.moving = Math.hypot(r.x - this.x, r.z - this.z) > 1e-3;
    this.x = r.x;
    this.z = r.z;
  }

  statusCodes() {
    const out = [];
    if (this.isStunned()) out.push('stun');
    if (this.isTormented()) out.push('torment');
    if (this.isSlowed()) out.push('slow');
    if (this.isBurning()) out.push('burn');
    if (this.isKnocked()) out.push('knock');
    if (this.isBlocked()) out.push('block');
    if (this.isRevealed()) out.push('reveal');
    return out;
  }

  snapshot() {
    return {
      id: this.id,
      kind: this.kind,
      x: r2(this.x),
      z: r2(this.z),
      f: this.floor,
      yaw: Math.round(this.yaw * 1000) / 1000,
      hp: Math.ceil(this.hp),
      maxHp: this.maxHp,
      st: this.statusCodes(),
      mv: this.moving,
      act: this.action,
      dead: this.dead,
    };
  }
}
