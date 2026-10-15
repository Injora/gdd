// Server-side bot teammate for solo testing. Bots follow the nearest human
// (taking the stairs when the human changes floor), path around furniture with
// A*, and nervously scan the dark when idle.

import { findPath, pathToWorld } from '../shared/pathfinding.js';
import { moveCircle, lineOfSight } from '../shared/collision.js';
import { WIZARD_BY_ID } from '../shared/wizards.js';
import { SPEED, PLAYER_RADIUS, worldToTile, yawFromDir } from '../shared/constants.js';

const FOLLOW_DISTANCE = 2.6;
const SPRINT_DISTANCE = 10;
const ENGAGE_RADIUS = 16; // notice monsters this close
const ENGAGE_READY = 1.5; // close in when the spell is ready within this many seconds

function turnToward(current, target, maxStep) {
  let d = target - current;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return current + Math.max(-maxStep, Math.min(maxStep, d));
}

export class Bot {
  constructor(game, player, index) {
    this.game = game;
    this.p = player;
    this.index = index;
    this.path = [];
    this.repathAt = 0;
    this.lookAt = 0;
    this.lookYaw = player.yaw;
    this.stuckCheckAt = 0;
    this.stuckFrom = { x: player.x, z: player.z };
    this.castAt = 0;
  }

  /** Fire this bot's spell at a nearby monster when it makes sense. */
  tryCast(t) {
    const g = this.game, p = this.p;
    if (t < this.castAt) return;
    const ability = WIZARD_BY_ID[p.wizardId]?.ability;
    if (!ability || g.spells.cooldownLeft(p, ability.id) > 0) return;
    const m = g.monsters().find((mm) => !mm.dead && mm.floor === p.floor);
    if (!m) return;
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    let want;
    if (ability.id === 'aegis_void') {
      // Shield when the monster is close to anyone in shield range.
      want = [...g.players.values()].some((o) => o.floor === p.floor &&
        Math.hypot(o.x - p.x, o.z - p.z) <= ability.shieldRadius && Math.hypot(o.x - m.x, o.z - m.z) < 3);
    } else {
      want = d <= ability.range * 0.9;
    }
    if (!want || !lineOfSight(g.map, p.floor, p.x, p.z, m.x, m.z)) return;
    p.yaw = yawFromDir(m.x - p.x, m.z - p.z);
    p.pitch = 0;
    g.spells.cast(p, p.yaw, 0);
    this.castAt = t + 1.5 + Math.random() * 2;
  }

  /** A monster worth walking toward: same floor, near, and our spell is almost ready. */
  engageTarget() {
    const g = this.game, p = this.p;
    const ability = WIZARD_BY_ID[p.wizardId]?.ability;
    if (!ability || ability.id === 'aegis_void' || g.spells.cooldownLeft(p, ability.id) > ENGAGE_READY) return null;
    const m = g.monsters().find((mm) => !mm.dead && mm.floor === p.floor && Math.hypot(mm.x - p.x, mm.z - p.z) < ENGAGE_RADIUS);
    return m ? { m, range: Math.max(1.5, ability.range * 0.6) } : null;
  }

  leader() {
    let best = null;
    for (const h of this.game.players.values()) {
      if (h.isBot) continue;
      const score = (h.floor === this.p.floor ? 0 : 1000) + Math.hypot(h.x - this.p.x, h.z - this.p.z);
      if (!best || score < best.score) best = { h, score };
    }
    return best?.h ?? null;
  }

  update(dt, t) {
    const g = this.game;
    const p = this.p;
    const leader = this.leader();
    p.moving = false;
    p.sprint = false;
    this.tryCast(t);
    if (!leader) return;

    let goal;
    let stairs = null;
    if (leader.floor !== p.floor) {
      stairs = g.props[p.floor === 0 ? g.map.ids.stairsDown : g.map.ids.stairsUp];
      goal = stairs.front;
      if (Math.hypot(goal.x - p.x, goal.z - p.z) < 1.0) {
        g.useStairs(p, stairs);
        this.path = [];
        return;
      }
    } else {
      // Engage a nearby monster when our spell is (nearly) ready; otherwise follow.
      const foe = this.engageTarget();
      goal = foe?.m ?? leader;
      const stop = foe ? foe.range : FOLLOW_DISTANCE + this.index * 0.6;
      const d = Math.hypot(goal.x - p.x, goal.z - p.z);
      if (d <= stop && (!foe || lineOfSight(g.map, p.floor, p.x, p.z, goal.x, goal.z))) {
        if (foe) p.yaw = turnToward(p.yaw, yawFromDir(goal.x - p.x, goal.z - p.z), dt * 8);
        else this.idle(dt, t);
        return;
      }
    }

    if (t >= this.repathAt || this.path.length === 0) {
      const floor = g.map.floors[p.floor];
      const tiles = findPath(floor, worldToTile(p.x), worldToTile(p.z), worldToTile(goal.x), worldToTile(goal.z), 5000);
      this.path = tiles ? pathToWorld(tiles) : [];
      this.repathAt = t + 0.6 + this.index * 0.1;
    }

    while (this.path.length && Math.hypot(this.path[0].x - p.x, this.path[0].z - p.z) < 0.45) this.path.shift();
    const target = this.path[0] ?? goal;
    const dx = target.x - p.x, dz = target.z - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return;

    const far = Math.hypot(goal.x - p.x, goal.z - p.z) > SPRINT_DISTANCE;
    const speed = far ? SPEED.sprint : SPEED.walk;
    const step = Math.min(len, speed * dt);
    const moved = moveCircle(g.world, p.floor, p.x, p.z, (dx / len) * step, (dz / len) * step, PLAYER_RADIUS);
    p.x = moved.x;
    p.z = moved.z;
    p.moving = true;
    p.sprint = far;
    p.yaw = turnToward(p.yaw, yawFromDir(dx, dz), dt * 7);
    p.pitch *= 0.9;

    // Unstick: if we've barely moved in a second, throw the path away.
    if (t >= this.stuckCheckAt) {
      if (Math.hypot(p.x - this.stuckFrom.x, p.z - this.stuckFrom.z) < 0.3) {
        this.path = [];
        this.repathAt = 0;
      }
      this.stuckFrom = { x: p.x, z: p.z };
      this.stuckCheckAt = t + 1;
    }
  }

  idle(dt, t) {
    const p = this.p;
    if (t >= this.lookAt) {
      this.lookYaw = p.yaw + (Math.random() - 0.5) * 2.6;
      this.lookAt = t + 1.5 + Math.random() * 2.5;
    }
    p.yaw = turnToward(p.yaw, this.lookYaw, dt * 1.6);
    p.pitch += (Math.sin(t * 0.7 + this.index) * 0.15 - p.pitch) * Math.min(1, dt * 2);
  }
}
