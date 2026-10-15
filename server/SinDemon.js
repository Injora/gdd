// A Demon of the Seven Deadly Sins: the mini-boss that erupts from a Heart
// when it is broken open. It fights only inside its locked room (the arena),
// against the wizards trapped in there with it.
//
// Built on MonsterBody, so every spell status applies (capped at SIN_CC_CAP so
// nothing stun-locks it). Each Sin has its own kit, telegraphed with
// `sin:attack` windup events and resolved server-side:
//
//   Pride     Mirror Seraph     reflects spells cast at its face; light lance
//   Greed     Gilded Hoarder    lobs molten gold that burns and drains Ult charge
//   Lust      Siren Weaver      hypnotic ribbons drag you in; caress at close range
//   Envy      Hollow Mimic      throws every element that hits it back as a wave
//   Gluttony  Maw of Famine     spreading acid pools; inhales the room, then bites
//   Wrath     Blood Berserker   charges; faster and faster as it bleeds
//   Sloth     Somnolent Dread   a room-wide aura of slow, heavy sleep; yawning slam
//
// Step 7: HP scales with the number of wizards, damage and projectile counts
// by +20% per extra wizard; at 50% HP it ENRAGES (faster cadence, a dramatic
// eruption, and its signature attack upgraded). Every windup carries an `aoe`
// so clients can paint the red ground telegraph.

import { MonsterBody } from './MonsterBody.js';
import { SINS, SIN_ERUPT, SIN_CC_CAP, SIN_ENRAGE, sinScaling } from '../shared/sins.js';
import { lineOfSight, moveCircle, overlapsSolid } from '../shared/collision.js';
import { findPath, pathToWorld } from '../shared/pathfinding.js';
import { roomAt } from '../shared/mapgen.js';
import { worldToTile, tileCenter } from '../shared/constants.js';

const r2 = (v) => Math.round(v * 100) / 100;
const rand = (a, b) => a + Math.random() * (b - a);
/** Spell damage sources that count as an element Envy can copy. */
const ELEMENTS = new Set(['black', 'fire', 'water', 'earth', 'wind', 'white', 'void']);

/** Distance from point P to segment AB. */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1e-9;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + dx * k), pz - (az + dz * k));
}

/** A clear spot to erupt at: the Heart's front, else the nearest open tile of the room. */
function spawnPoint(game, prop, room, radius) {
  const tries = [];
  if (prop.front) tries.push({ x: prop.front.x, z: prop.front.z });
  tries.push({ x: tileCenter(prop.tx), z: tileCenter(prop.ty) });
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) tries.push({ x: tileCenter(x), z: tileCenter(y), d: Math.hypot(x - prop.tx, y - prop.ty) });
  }
  tries.sort((a, b) => (a.d ?? -1) - (b.d ?? -1));
  return tries.find((t) => !overlapsSolid(game.world, room.floor, t.x, t.z, radius)) ?? tries[0];
}

export class SinDemon extends MonsterBody {
  constructor(game, heart, room) {
    const S = SINS[heart.sin];
    const prop = game.props[heart.propId];
    const at = spawnPoint(game, prop, room, S.radius);
    const scale = sinScaling(game.players.size);
    super(game, { id: `sin_${heart.sin}`, kind: 'sin', x: at.x, z: at.z, floor: room.floor, maxHp: Math.round(S.hp * scale.hp), radius: S.radius, speed: S.speed });
    this.dmgScale = scale.damage;
    this.enraged = false;
    this.stripUntil = 0;
    this.sin = heart.sin;
    this.S = S;
    this.heart = heart;
    this.room = room;
    this.eruptUntil = this.t + SIN_ERUPT;
    this.action = 'erupt';
    this.yaw = Math.atan2(-(tileCenter(room.cx) - this.x), -(tileCenter(room.cy) - this.z));
    this.attack = null;
    this.hazards = []; // acid pools, envy waves, molten gold in flight
    this.pending = []; // delayed strikes
    this.timers = {};
    for (const k of ['lance', 'gold', 'ribbons', 'caress', 'claw', 'acid', 'vacuum', 'charge', 'cleave', 'yawn']) {
      this.timers[k] = this.eruptUntil + rand(0.6, 1.8);
    }
    this.waveReadyAt = 0;
    this.path = [];
    this.repathAt = 0;
    this.nextHazardId = 1;
  }

  // ---- queries ----------------------------------------------------------------------

  /** Is wizard p locked in here with it? */
  inArena(p) {
    return !p.captured && !p.capturing && p.floor === this.floor && roomAt(this.game.map, this.floor, p.x, p.z)?.id === this.room.id;
  }

  targets() { return [...this.game.players.values()].filter((p) => this.inArena(p)); }

  dist(p) { return Math.hypot(p.x - this.x, p.z - this.z); }
  los(p) { return lineOfSight(this.game.map, this.floor, this.x, this.z, p.x, p.z); }

  nearest() {
    let best = null;
    for (const p of this.targets()) {
      const d = this.dist(p);
      if (!best || d < best.d) best = { p, d };
    }
    return best?.p ?? null;
  }

  ready(kind) { return this.t >= this.timers[kind]; }

  /** Enraged (below half HP), unless a Black Slash Wave has stripped it for now. */
  isEnraged() { return this.enraged && this.t >= this.stripUntil; }
  stripEnrage(seconds) {
    if (!this.enraged) return;
    this.stripUntil = Math.max(this.stripUntil, this.t + seconds);
    this.game.emitAll({ type: 'sin:enrage', id: this.id, sin: this.sin, floor: this.floor, x: r2(this.x), z: r2(this.z), stripped: seconds });
  }
  /** Projectile / bolt counts grow with the coven (and with rage). */
  count(base) { return Math.round(base * this.dmgScale) + (this.isEnraged() ? 2 : 0); }

  /** Is the point (x, z) in front of it, inside Pride's mirror? */
  frontal(x, z) {
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz);
    if (d < 1e-3) return true;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    return Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) <= this.S.reflectCone;
  }

  canReflect() {
    return this.sin === 'pride' && this.t >= this.eruptUntil && !this.isStunned() && !this.isFrozen() &&
      !this.isConfused() && !this.isKnocked() && !this.isLifted();
  }

  // ---- crowd control: capped, so nothing holds a Sin for long ---------------------------

  freeze(d) { super.freeze(Math.min(d, SIN_CC_CAP)); }
  stun(d) { super.stun(Math.min(d, SIN_CC_CAP)); }
  root(d) { super.root(Math.min(d, SIN_CC_CAP)); }
  pin(d) { super.pin(Math.min(d, SIN_CC_CAP)); }
  lift(d) { super.lift(Math.min(d, SIN_CC_CAP)); }
  confuse(d, dps) { super.confuse(Math.min(d, SIN_CC_CAP), dps); }
  torment(i, r) { super.torment(Math.min(i, SIN_CC_CAP), r); }
  /** The wind dragon can't carry a Sin out of its arena: it slams it instead. */
  sweep() {
    const p = this.nearest();
    this.knockback(p?.x ?? this.x + 1, p?.z ?? this.z, 4, 0.4);
  }

  /** Pride: a projectile arriving at its face is turned back on its caster. */
  reflects(pr) {
    if (!this.canReflect()) return false;
    const from = this.game.spells.casterFrom ?? pr;
    if (!this.frontal(from.x, from.z)) return false;
    this.reflect(pr.owner);
    return true;
  }

  reflect(caster) {
    this.game.emitAll({
      type: 'sin:reflect', id: this.id, floor: this.floor, x: r2(this.x), z: r2(this.z),
      tx: r2(caster?.x ?? this.x), tz: r2(caster?.z ?? this.z),
    });
    if (caster && this.inArena(caster)) this.game.damagePlayer(caster, this.S.reflectDamage, this, 'sin');
  }

  damage(amount, source) {
    if (this.dead || this.t < this.eruptUntil) return;
    const sp = this.game.spells;
    // A spell cast straight at Pride's face (not a projectile, which reflects() handled).
    if (this.canReflect() && sp.caster && !sp.casterFrom && this.frontal(sp.caster.x, sp.caster.z)) {
      this.reflect(sp.caster);
      return;
    }
    if (this.sin === 'envy' && ELEMENTS.has(source) && this.t >= this.waveReadyAt) {
      const c = this.S.counter;
      this.waveReadyAt = this.t + c.cooldown * (this.isEnraged() ? 0.5 : 1);
      this.hazards.push({ id: this.nextHazardId++, k: 'wave', x: this.x, z: this.z, r: 0, el: source, startAt: this.t + c.delay, hit: new Set() });
      // Enraged: a second ring right behind the first.
      if (this.isEnraged()) this.hazards.push({ id: this.nextHazardId++, k: 'wave', x: this.x, z: this.z, r: 0, el: source, startAt: this.t + c.delay + 0.45, hit: new Set() });
      this.game.emitAll({ type: 'sin:attack', id: this.id, sin: this.sin, kind: 'mimic', stage: 'windup', el: source, floor: this.floor, x: r2(this.x), z: r2(this.z), windup: c.delay });
    }
    super.damage(amount, source);
    this.hitFrom = sp.caster ? { x: sp.caster.x, z: sp.caster.z } : null;
    if (!this.enraged && !this.dead && this.hp <= this.maxHp * SIN_ENRAGE.at) this.enrage();
  }

  /** Half its blood gone: it erupts in fury. */
  enrage() {
    this.enraged = true;
    for (const k of Object.keys(this.timers)) this.timers[k] = Math.min(this.timers[k], this.t + 0.8);
    this.st.staggerUntil = Math.max(this.st.staggerUntil, this.t + 1.0); // the eruption
    this.game.emitAll({ type: 'sin:enrage', id: this.id, sin: this.sin, floor: this.floor, x: r2(this.x), z: r2(this.z) });
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.action = null;
    this.attack = null;
    this.hazards = [];
    this.game.onDemonSlain?.(this);
  }

  // ---- per tick ---------------------------------------------------------------------

  update(dt) {
    this.updateStatus(dt);
    this.moving = false;
    if (this.dead) return;
    this.updateHazards(dt);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.t >= this.pending[i].at) this.pending.splice(i, 1)[0].fn();
    }
    if (this.sin === 'sloth') {
      const deep = this.isEnraged();
      for (const p of this.targets()) this.game.spells.addBuff(p, 'sloth', 0.4, { slow: this.S.aura.slow * (deep ? 1.35 : 1), drain: this.S.aura.drain * (deep ? 1.5 : 1) });
    }
    if (this.t < this.eruptUntil) {
      this.action = 'erupt';
      return;
    }
    if (this.action === 'erupt') this.action = null;
    const p = this.nearest();
    if (!p) return;
    if (!this.canAct()) {
      if (this.attack?.kind !== 'dash') this.attack = null;
      this.action = this.isConfused() ? 'confused' : null;
      return;
    }
    if (this.attack) return this.updateAttack(p, dt);
    this.decide(p, dt);
  }

  /** Movement speed (Wrath grows faster as it bleeds). */
  pace() {
    if (this.sin !== 'wrath') return this.S.speed;
    return this.S.speed * (1 + this.S.enrage * (1 - this.hp / this.maxHp));
  }

  decide(p, dt) {
    const S = this.S, d = this.dist(p), sees = this.los(p);
    const go = (kind, extra) => this.startAttack(kind, p, extra);
    switch (this.sin) {
      case 'pride':
        if (this.ready('lance') && sees && d <= S.lance.range) return go('lance');
        return this.approach(p, dt, 5.5, 2.2);
      case 'greed':
        if (this.ready('gold') && sees && d <= S.gold.range) return go('gold');
        return this.approach(p, dt, 7);
      case 'lust':
        if (this.ready('caress') && d <= S.caress.range) return go('caress');
        if (this.ready('ribbons') && sees && d > 3.5 && d <= S.ribbons.range) return go('ribbons');
        return this.approach(p, dt, 1.6);
      case 'envy':
        if (this.ready('claw') && d <= S.claw.range) return go('claw');
        return this.approach(p, dt, 1.6);
      case 'gluttony': {
        const near = this.targets().filter((o) => this.dist(o) <= S.vacuum.radius).length;
        if (this.ready('vacuum') && near) return go('vacuum');
        // (enraged, the vacuum reaches further: see strike())
        if (this.ready('acid') && sees && d <= S.acid.range) return go('acid');
        return this.approach(p, dt, 2.4);
      }
      case 'wrath':
        if (this.ready('cleave') && d <= S.cleave.range) return go('cleave');
        if (this.ready('charge') && sees && d >= 3.5 && d <= S.charge.range) return go('charge');
        return this.approach(p, dt, 1.5);
      case 'sloth':
        if (this.ready('yawn') && d <= S.yawn.radius - 0.5) return go('yawn');
        return this.approach(p, dt, 2);
    }
  }

  /** Walk toward p until within `keep` units, turning at `turn` rad/s (Pride turns slowly). */
  approach(p, dt, keep, turn = 0) {
    const d = this.dist(p);
    if (turn) {
      const want = Math.atan2(-(p.x - this.x), -(p.z - this.z));
      const diff = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
      this.yaw += Math.max(-turn * dt, Math.min(turn * dt, diff));
    }
    if (d <= keep) {
      if (!turn) this.stepToward(p.x, p.z, 0, dt); // face it without moving
      return;
    }
    let target = p;
    if (!this.los(p)) {
      if (this.t >= this.repathAt) {
        const f = this.game.map.floors[this.floor];
        const tiles = findPath(f, worldToTile(this.x), worldToTile(this.z), worldToTile(p.x), worldToTile(p.z), 3000);
        this.path = tiles ? pathToWorld(tiles) : [];
        this.repathAt = this.t + 0.4;
      }
      while (this.path.length && Math.hypot(this.path[0].x - this.x, this.path[0].z - this.z) < 0.5) this.path.shift();
      if (this.path.length) target = this.path[0];
    }
    if (turn) {
      // Pride glides along its facing, so it can't snap round to meet a flanker.
      const step = this.pace() * this.speedMultiplier() * dt;
      const r = moveCircle(this.game.world, this.floor, this.x, this.z, -Math.sin(this.yaw) * step, -Math.cos(this.yaw) * step, this.radius);
      this.moving = Math.hypot(r.x - this.x, r.z - this.z) > 1e-3;
      this.x = r.x;
      this.z = r.z;
    } else {
      this.stepToward(target.x, target.z, this.pace(), dt);
    }
  }

  startAttack(kind, p, extra = {}) {
    const S = this.S;
    const spec = { lance: S.lance, gold: S.gold, ribbons: S.ribbons, caress: S.caress, claw: S.claw, acid: S.acid,
      vacuum: S.vacuum, charge: S.charge, cleave: S.cleave, yawn: S.yawn }[kind];
    const rage = this.isEnraged();
    this.timers[kind] = this.t + spec.every * (rage ? SIN_ENRAGE.cadence : 1);
    const windup = spec.windup * (rage ? 0.8 : 1);
    this.attack = { kind, strikeAt: this.t + windup, targetId: p.id, tx: p.x, tz: p.z, aimUntil: this.t + windup * 0.7, ...extra };
    if (kind === 'gold') {
      // Where the gold will land is decided now, so the floor can glow red there first.
      const g = this.S.gold;
      this.attack.landing = [];
      for (let i = 0; i < this.count(g.count); i++) {
        const ang = Math.random() * Math.PI * 2, spread = i === 0 ? 0 : rand(1, 2.6);
        this.attack.landing.push({ x: p.x + Math.cos(ang) * spread, z: p.z + Math.sin(ang) * spread });
      }
    }
    this.action = kind;
    this.game.emitAll({
      type: 'sin:attack', id: this.id, sin: this.sin, kind, stage: 'windup', targetId: p.id, enraged: rage,
      floor: this.floor, x: r2(this.x), z: r2(this.z), tx: r2(p.x), tz: r2(p.z), windup,
      r: spec.radius ?? spec.range, aoe: this.telegraph(kind, p),
    });
  }

  /** The red ground telegraph of an attack (circles and lines in world units). */
  telegraph(kind, p) {
    const S = this.S, rage = this.isEnraged();
    const circle = (x, z, r) => ({ shape: 'circle', x: r2(x), z: r2(z), r: r2(r) });
    const line = (yaw, len, w) => ({ shape: 'line', x: r2(this.x), z: r2(this.z), x2: r2(this.x + Math.cos(yaw) * len), z2: r2(this.z + Math.sin(yaw) * len), w });
    const aim = Math.atan2(p.z - this.z, p.x - this.x);
    switch (kind) {
      case 'lance': return rage ? [line(aim - 0.32, S.lance.range, 1.6), line(aim, S.lance.range, 1.6), line(aim + 0.32, S.lance.range, 1.6)] : [line(aim, S.lance.range, 1.6)];
      case 'gold': return this.attack.landing.map((l) => circle(l.x, l.z, S.gold.radius * (rage ? 1.3 : 1)));
      case 'charge': return [line(aim, S.charge.speed * S.charge.time + 1, 1.8)];
      case 'acid': return [circle(p.x, p.z, S.acid.max * (rage ? 1.4 : 1))];
      case 'vacuum': return [circle(this.x, this.z, S.vacuum.radius * (rage ? 1.25 : 1))];
      case 'yawn': return [circle(this.x, this.z, S.yawn.radius * (rage ? 1.4 : 1))];
      case 'ribbons': return [circle(p.x, p.z, 1.2)];
      default: return [circle(this.x, this.z, (S[kind]?.range ?? 2.4) + 0.4)];
    }
  }

  /** Every hit grows with the coven (+20% per extra wizard). */
  hurt(p, amount) { return this.game.damagePlayer(p, amount * this.dmgScale, this, 'sin'); }

  updateAttack(p, dt) {
    const a = this.attack, S = this.S, t = this.t;
    if (a.kind === 'dash') {
      const step = S.charge.speed * dt;
      const r = moveCircle(this.game.world, this.floor, this.x, this.z, a.dir.x * step, a.dir.z * step, this.radius);
      const blocked = Math.hypot(r.x - this.x, r.z - this.z) < step * 0.3;
      this.x = r.x;
      this.z = r.z;
      this.moving = true;
      for (const o of this.targets()) {
        if (a.hit.has(o.id) || this.dist(o) > this.radius + 0.9) continue;
        a.hit.add(o.id);
        this.hurt(o, S.charge.damage);
        this.game.impulse(o, a.dir.x * 7, a.dir.z * 7, 0.3);
      }
      if (t >= a.until || blocked) {
        this.attack = null;
        this.action = null;
        if (blocked) this.st.staggerUntil = Math.max(this.st.staggerUntil, t + 0.8); // slammed into a wall
        else if (this.isEnraged() && !a.chained && this.inArena(p)) {
          // Enraged: it wheels round and charges again at once.
          const d = Math.max(1e-3, Math.hypot(p.x - this.x, p.z - this.z));
          this.attack = { kind: 'dash', dir: { x: (p.x - this.x) / d, z: (p.z - this.z) / d }, until: t + S.charge.time, hit: new Set(), chained: true };
          this.action = 'charge';
          this.game.emitAll({ type: 'sin:attack', id: this.id, sin: this.sin, kind: 'charge', stage: 'strike', floor: this.floor, x: r2(this.x), z: r2(this.z), tx: r2(p.x), tz: r2(p.z), hits: [] });
        }
      }
      return;
    }
    // Track the target during most of the windup, then commit (so you can dodge).
    const tgt = this.game.players.get(a.targetId) ?? p;
    if (t < a.aimUntil && this.inArena(tgt)) {
      a.tx = tgt.x;
      a.tz = tgt.z;
    }
    const want = Math.atan2(-(a.tx - this.x), -(a.tz - this.z));
    const diff = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
    const rate = this.sin === 'pride' ? 3 : 10;
    this.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
    if (t < a.strikeAt) return;
    this.attack = null;
    this.action = null;
    this.strike(a, tgt);
  }

  strike(a, tgt) {
    const S = this.S, t = this.t;
    const ev = { type: 'sin:attack', id: this.id, sin: this.sin, kind: a.kind, stage: 'strike', floor: this.floor, x: r2(this.x), z: r2(this.z), tx: r2(a.tx), tz: r2(a.tz), hits: [] };
    const melee = (spec) => {
      for (const o of this.targets()) {
        if (this.dist(o) > spec.range + 0.4 + this.radius * 0.5) continue;
        ev.hits.push(o.id);
        this.hurt(o, spec.damage);
      }
    };
    switch (a.kind) {
      case 'lance': {
        // Enraged: a fan of three lances.
        const aim = Math.atan2(a.tz - this.z, a.tx - this.x);
        const fan = this.isEnraged() ? [-0.32, 0, 0.32] : [0];
        ev.lances = [];
        for (const off of fan) {
          const ex = this.x + Math.cos(aim + off) * S.lance.range, ez = this.z + Math.sin(aim + off) * S.lance.range;
          ev.lances.push({ x: r2(ex), z: r2(ez) });
          for (const o of this.targets()) {
            if (ev.hits.includes(o.id) || segDist(o.x, o.z, this.x, this.z, ex, ez) > 0.8 || !this.los(o)) continue;
            ev.hits.push(o.id);
            this.hurt(o, S.lance.damage);
          }
        }
        ev.tx = ev.lances[Math.floor(fan.length / 2)].x;
        ev.tz = ev.lances[Math.floor(fan.length / 2)].z;
        break;
      }
      case 'gold': {
        const g = S.gold;
        ev.bolts = [];
        for (const l of a.landing ?? [{ x: a.tx, z: a.tz }]) {
          const lx = l.x, lz = l.z;
          const flight = Math.hypot(lx - this.x, lz - this.z) / g.speed;
          this.hazards.push({ id: this.nextHazardId++, k: 'gold', fx: this.x, fz: this.z, x: lx, z: lz, t0: t, land: t + flight });
          ev.bolts.push({ x: r2(lx), z: r2(lz), flight: r2(flight) });
        }
        break;
      }
      case 'ribbons':
        for (const o of this.targets()) {
          const d = this.dist(o);
          if (d > S.ribbons.range || !this.los(o)) continue;
          ev.hits.push(o.id);
          this.hurt(o, S.ribbons.damage);
          const pull = Math.min(S.ribbons.pull * (this.isEnraged() ? 1.5 : 1), Math.max(0, d - 1.5));
          this.game.impulse(o, ((this.x - o.x) / d) * (pull / 0.45), ((this.z - o.z) / d) * (pull / 0.45), 0.45);
        }
        break;
      case 'caress': melee(S.caress); break;
      case 'claw': melee(S.claw); break;
      case 'cleave': melee(S.cleave); break;
      case 'acid':
        this.hazards.push({ id: this.nextHazardId++, k: 'acid', x: a.tx, z: a.tz, r: S.acid.grow, max: S.acid.max * (this.isEnraged() ? 1.4 : 1), until: t + S.acid.life, acc: new Map() });
        break;
      case 'vacuum':
        for (const o of this.targets()) {
          const d = this.dist(o);
          if (d > S.vacuum.radius * (this.isEnraged() ? 1.25 : 1) || d < 1e-3) continue;
          ev.hits.push(o.id);
          const pull = Math.min(S.vacuum.pull, Math.max(0, d - 1.4));
          this.game.impulse(o, ((this.x - o.x) / d) * (pull / 0.5), ((this.z - o.z) / d) * (pull / 0.5), 0.5);
        }
        this.pending.push({
          at: t + 0.6,
          fn: () => {
            const bitten = [];
            for (const o of this.targets()) {
              if (this.dist(o) > S.vacuum.bite + this.radius) continue;
              bitten.push(o.id);
              this.hurt(o, S.vacuum.damage);
            }
            this.game.emitAll({ type: 'sin:attack', id: this.id, sin: this.sin, kind: 'bite', stage: 'strike', floor: this.floor, x: r2(this.x), z: r2(this.z), hits: bitten });
          },
        });
        break;
      case 'yawn': {
        const r = S.yawn.radius * (this.isEnraged() ? 1.4 : 1);
        for (const o of this.targets()) {
          if (this.dist(o) > r) continue;
          ev.hits.push(o.id);
          this.hurt(o, S.yawn.damage);
        }
        ev.r = r;
        break;
      }
      case 'charge': {
        const d = Math.max(1e-3, Math.hypot(a.tx - this.x, a.tz - this.z));
        this.attack = { kind: 'dash', dir: { x: (a.tx - this.x) / d, z: (a.tz - this.z) / d }, until: t + S.charge.time, hit: new Set() };
        this.action = 'charge';
        break;
      }
    }
    this.game.emitAll(ev);
  }

  updateHazards(dt) {
    const t = this.t;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (h.k === 'acid') {
        if (t >= h.until) { this.hazards.splice(i, 1); continue; }
        h.r = Math.min(h.max ?? this.S.acid.max, h.r + this.S.acid.grow * dt);
        for (const o of this.targets()) {
          if (Math.hypot(o.x - h.x, o.z - h.z) > h.r) continue;
          const acc = (h.acc.get(o.id) ?? 0) + this.S.acid.dps * dt;
          if (acc >= 3) {
            this.hurt(o, Math.floor(acc));
            h.acc.set(o.id, acc - Math.floor(acc));
          } else {
            h.acc.set(o.id, acc);
          }
        }
      } else if (h.k === 'wave') {
        if (t < h.startAt) continue;
        const c = this.S.counter;
        h.r += c.speed * dt;
        if (h.r > c.range) { this.hazards.splice(i, 1); continue; }
        for (const o of this.targets()) {
          if (h.hit.has(o.id)) continue;
          if (Math.abs(Math.hypot(o.x - h.x, o.z - h.z) - h.r) > c.width) continue;
          h.hit.add(o.id);
          this.hurt(o, c.damage);
        }
      } else if (h.k === 'gold') {
        if (t < h.land) continue;
        this.hazards.splice(i, 1);
        const g = this.S.gold;
        const hits = [];
        for (const o of this.targets()) {
          if (Math.hypot(o.x - h.x, o.z - h.z) > g.radius) continue;
          hits.push(o.id);
          o.ult = Math.max(0, (o.ult ?? 0) - g.drain);
          this.hurt(o, g.damage);
        }
        this.game.emitAll({ type: 'sin:impact', id: this.id, sin: this.sin, kind: 'gold', floor: this.floor, x: r2(h.x), z: r2(h.z), r: g.radius, hits });
      }
    }
  }

  snapshot() {
    return {
      ...super.snapshot(),
      sin: this.sin,
      er: this.t < this.eruptUntil,
      rage: this.isEnraged(),
      hz: this.hazards
        .filter((h) => h.k !== 'wave' || this.t >= h.startAt)
        .map((h) => (h.k === 'gold'
          ? { id: h.id, k: 'gold', x: r2(h.x), z: r2(h.z), fx: r2(h.fx), fz: r2(h.fz), p: r2(Math.min(1, (this.t - h.t0) / Math.max(0.01, h.land - h.t0))) }
          : { id: h.id, k: h.k, x: r2(h.x), z: r2(h.z), r: r2(h.r), el: h.el })),
    };
  }
}
