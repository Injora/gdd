// Debug target for Step 3 (?debug=1, press P). A slow, harmless husk that
// patrols, shambles after the nearest wizard it can see, and telegraphs a claw
// swipe, so every spell (including Void shield blocks) can be tested before
// the real Monster exists. Crumbles at 0 HP and re-forms after 3 s.

import { MonsterBody } from './MonsterBody.js';
import { findPath, pathToWorld } from '../shared/pathfinding.js';
import { lineOfSight, overlapsSolid } from '../shared/collision.js';
import { worldToTile } from '../shared/constants.js';

const SIGHT = 10;
const ATTACK_RANGE = 1.7;
const ATTACK_REACH = 2.4;
const WINDUP = 0.7;
const ATTACK_COOLDOWN = 3;

export class TrainingHusk extends MonsterBody {
  constructor(game, x, z, floor) {
    super(game, { id: 'husk', kind: 'husk', x, z, floor, maxHp: 100, radius: 0.5, speed: 1.8 });
    this.home = { x, z };
    this.attackReadyAt = 0;
    this.windupUntil = 0;
    this.attackTarget = null;
    this.path = [];
    this.repathAt = 0;
    this.patrolGoal = null;
    this.patrolUntil = 0;
    this.reviveAt = 0;
  }

  onDeath() {
    this.reviveAt = this.t + 3;
    this.game.emitAll({ type: 'husk:crumble', id: this.id });
  }

  onBlinded() { this.path = []; }
  onChaseInterrupted() { this.path = []; }

  update(dt) {
    if (this.dead) {
      if (this.t >= this.reviveAt) this.revive();
      return;
    }
    this.updateStatus(dt);
    this.moving = false;
    if (!this.canAct()) { this.windupUntil = 0; return; }

    if (this.action === 'windup') {
      if (this.t >= this.windupUntil) this.resolveAttack();
      return;
    }

    if (this.isTormented()) {
      // Clutches its head and writhes in place.
      this.yaw += Math.sin(this.t * 37) * 0.25;
      return;
    }

    const target = this.findTarget();
    if (target) {
      const d = Math.hypot(target.x - this.x, target.z - this.z);
      if (d < ATTACK_RANGE && this.t >= this.attackReadyAt) {
        this.action = 'windup';
        this.windupUntil = this.t + WINDUP;
        this.attackTarget = target.id;
        this.yaw = Math.atan2(-(target.x - this.x), -(target.z - this.z));
        return;
      }
      if (d > 1.2) this.chase(target, dt);
      return;
    }
    this.patrol(dt);
  }

  revive() {
    this.dead = false;
    this.hp = this.maxHp;
    for (const k of Object.keys(this.st)) this.st[k] = 0;
    this.game.emitAll({ type: 'husk:revive', id: this.id });
  }

  findTarget() {
    let best = null;
    for (const p of this.game.players.values()) {
      if (p.floor !== this.floor) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d > SIGHT || (best && d >= best.d)) continue;
      if (!lineOfSight(this.game.map, this.floor, this.x, this.z, p.x, p.z)) continue;
      best = { p, d };
    }
    return best?.p ?? null;
  }

  chase(target, dt) {
    if (this.t >= this.repathAt) {
      const f = this.game.map.floors[this.floor];
      const tiles = findPath(f, worldToTile(this.x), worldToTile(this.z), worldToTile(target.x), worldToTile(target.z), 3000);
      this.path = tiles ? pathToWorld(tiles) : [];
      this.repathAt = this.t + 0.5;
    }
    while (this.path.length && Math.hypot(this.path[0].x - this.x, this.path[0].z - this.z) < 0.5) this.path.shift();
    const next = this.path.length > 1 ? this.path[0] : target;
    this.stepToward(next.x, next.z, this.baseSpeed, dt);
  }

  patrol(dt) {
    if (!this.patrolGoal || this.t >= this.patrolUntil || Math.hypot(this.patrolGoal.x - this.x, this.patrolGoal.z - this.z) < 0.4) {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 3;
        const g = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r };
        if (!overlapsSolid(this.game.world, this.floor, g.x, g.z, this.radius)) { this.patrolGoal = g; break; }
      }
      this.patrolUntil = this.t + 4;
    }
    if (this.patrolGoal) this.stepToward(this.patrolGoal.x, this.patrolGoal.z, this.baseSpeed * 0.5, dt);
  }

  resolveAttack() {
    this.action = null;
    this.attackReadyAt = this.t + ATTACK_COOLDOWN;
    const target = this.game.players.get(this.attackTarget);
    if (!target || target.floor !== this.floor) return;
    if (Math.hypot(target.x - this.x, target.z - this.z) > ATTACK_REACH) {
      this.game.emitAll({ type: 'husk:miss', id: this.id });
      return;
    }
    if (this.game.spells.isShielded(target)) {
      this.block();
      this.game.emitAll({ type: 'husk:blocked', id: this.id, targetId: target.id });
    } else {
      this.game.emitAll({ type: 'husk:hit', id: this.id, targetId: target.id });
    }
  }
}
