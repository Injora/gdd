// Server-side bot teammate for solo testing. Bots follow the nearest human
// (taking the stairs when the human changes floor), path around furniture with
// A*, and nervously scan the dark when idle.

import { findPath, pathToWorld } from '../shared/pathfinding.js';
import { moveCircle } from '../shared/collision.js';
import { SPEED, PLAYER_RADIUS, worldToTile, yawFromDir } from '../shared/constants.js';

const FOLLOW_DISTANCE = 2.6;
const SPRINT_DISTANCE = 10;

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
      goal = leader;
      if (Math.hypot(goal.x - p.x, goal.z - p.z) <= FOLLOW_DISTANCE + this.index * 0.6) {
        this.idle(dt, t);
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
