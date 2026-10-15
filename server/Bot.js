// Server-side bot teammate. Priorities, highest first:
//   1. Held in the Cell → wait for rescue (and cast through the bars).
//   2. Someone is held  → run to the Cell (taking the stairs) and break the lock.
//   3. Monster threat   → cast our spell defensively (Wind push, White stun,
//                         Void shield, Earth wall, Fire/Water chip, Black torment).
//   4. Training Husk    → close into spell range and practise on it.
//   5. Otherwise        → follow the nearest free human, scanning the dark.

import { findPath, pathToWorld } from '../shared/pathfinding.js';
import { moveCircle, lineOfSight, overlapsSolid } from '../shared/collision.js';
import { MASTERIES } from '../shared/finale.js';
import { WIZARD_BY_ID } from '../shared/wizards.js';
import { PHASE, SPEED, PLAYER_RADIUS, worldToTile, yawFromDir } from '../shared/constants.js';

const FOLLOW_DISTANCE = 2.6;
const SPRINT_DISTANCE = 10;
const ENGAGE_RADIUS = 16; // notice the husk this close
const ENGAGE_READY = 1.5; // close in when the spell is ready within this many seconds
const THREAT_RADIUS = 8; // the Amalgam this close is a threat even if not hunting
const MASTERY_ELEMENT = { Black: 'black', Fire: 'fire', Water: 'water', Earth: 'earth', Wind: 'wind', White: 'white', 'Anti-magic': 'void' };
const BOT_MASTERY_GRACE = 2.5; // seconds a shared Mastery waits for the humans before a bot takes it

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
    this.pathKey = '';
    this.repathAt = 0;
    this.lookAt = 0;
    this.lookYaw = player.yaw;
    this.stuckCheckAt = 0;
    this.stuckFrom = { x: player.x, z: player.z };
    this.castAt = 0;
  }

  update(dt, t) {
    const g = this.game, p = this.p;
    p.moving = false;
    p.sprint = false;
    if (p.capturing || g.phase === PHASE.GAMEOVER || g.phase === PHASE.EPILOGUE) return;
    if (g.finale.active) return this.archonTurn(t);
    this.tryCast(t);
    if (p.channel) return; // holding E on the lock
    if (p.captured) return this.idle(dt, t);

    // Badly hurt: eat from a Tree of Life if one is growing on this floor.
    if (p.hp < 50) {
      const tree = g.spells.entities.find((e) => e.kind === 'tree' && e.fruits > 0 && e.floor === p.floor);
      if (tree) {
        if (this.moveTo({ x: tree.x, z: tree.z, floor: tree.floor }, 2.2, dt, t)) g.onInteract(p.id, null, tree.id);
        return;
      }
    }

    // Rescue
    const gateId = g.map.ids.gate;
    if (g.prisoners().length && !g.propState[gateId]?.open) {
      const gate = g.props[gateId];
      if (this.moveTo({ x: gate.front.x, z: gate.front.z, floor: gate.floor }, 0.8, dt, t)) {
        p.yaw = yawFromDir(gate.x - p.x, gate.z - p.z);
        g.onInteract(p.id, gateId);
      }
      return;
    }

    // The Forbidden Spell: take a place around the altar and chant.
    if (g.phase === PHASE.CONVERGENCE) {
      const altar = g.props[g.map.ids.altar];
      const spot = this.chantSpot(altar);
      if (this.moveTo(spot, 0.6, dt, t) && !g.finale.chanting(p)) {
        p.yaw = yawFromDir(altar.x - p.x, altar.z - p.z);
        g.onInteract(p.id, altar.id);
      }
      return;
    }

    // Practise on the husk
    const foe = this.engageTarget();
    if (foe) {
      if (this.moveTo({ x: foe.m.x, z: foe.m.z, floor: foe.m.floor }, foe.range, dt, t, true)) {
        p.yaw = turnToward(p.yaw, yawFromDir(foe.m.x - p.x, foe.m.z - p.z), dt * 8);
      }
      return;
    }

    const leader = this.leader();
    if (!leader) return this.idle(dt, t);
    if (this.moveTo({ x: leader.x, z: leader.z, floor: leader.floor }, FOLLOW_DISTANCE + this.index * 0.6, dt, t)) {
      this.idle(dt, t);
    }
  }

  /** A clear spot within reach of the altar, different for each bot. */
  chantSpot(altar) {
    if (this._chant) return this._chant;
    const g = this.game;
    for (let k = 0; k < 16; k++) {
      const ang = this.index * 1.9 + 0.8 + k * 0.4;
      const pt = { x: altar.x + Math.cos(ang) * 2.4, z: altar.z + Math.sin(ang) * 2.4, floor: altar.floor };
      if (!overlapsSolid(g.world, altar.floor, pt.x, pt.z, 0.45)) return (this._chant = pt);
    }
    return (this._chant = { x: altar.front?.x ?? altar.x, z: altar.front?.z ?? altar.z, floor: altar.floor });
  }

  /** Inside the Archon: no body of our own; cast spells and Masteries, grapple at the portal. */
  archonTurn(t) {
    const g = this.game, p = this.p, f = g.finale;
    if (!f.inFight()) return;
    const m = g.monster;
    p.yaw = yawFromDir(m.x - p.x, m.z - p.z);
    if (f.stage === 'portal') f.setGrapple(p, true);
    if (t < this.castAt) return;
    this.castAt = t + 0.8 + Math.random() * 0.9;
    // A bot channels its own element's Mastery (and the Wind Dragon at the portal, to shove it in),
    // and only once it has sat ready a moment: human wizards get first pick of the shared cooldowns.
    const ready = (M) => (f.masteryReady[M.id] ?? f.bossAt ?? 0) <= f.t - BOT_MASTERY_GRACE;
    const own = MASTERIES.find((M) => M.element === MASTERY_ELEMENT[WIZARD_BY_ID[p.wizardId]?.element]);
    const wind = MASTERIES.find((M) => M.id === 'm_wind_dragon');
    const pick = [f.stage === 'portal' && wind, own].find((M) => M && ready(M));
    if (pick && Math.random() < 0.6) {
      f.mastery(p, pick.key, p.yaw);
      return;
    }
    // …or one of our own spells at a quarter of the cooldown.
    this.tryCast(t, true);
  }

  // ---- spells ------------------------------------------------------------------

  /**
   * Pick and cast a spell (or the Ultimate) that fits the moment, using each
   * spell's `bot` hint: target / ally / self / escape / zone / heal.
   */
  tryCast(t, force = false) {
    const g = this.game, p = this.p;
    if (t < this.castAt && !force) return;
    const w = WIZARD_BY_ID[p.wizardId];
    if (!w) return;
    const m = g.monsters().find((mm) => mm.floor === p.floor) ?? null;
    const d = m ? Math.hypot(m.x - p.x, m.z - p.z) : Infinity;
    const isHusk = m?.kind === 'husk';
    const los = !!m && lineOfSight(g.map, p.floor, p.x, p.z, m.x, m.z);
    // The real Amalgam is only engaged when it threatens someone.
    const threat = !!m && (isHusk || m.state === 'hunting' || m.state === 'boss' || d < THREAT_RADIUS);
    const huntedClose = !!m && !isHusk && m.state === 'hunting' && m.targetId === p.id && d < 5;
    const hurt = [...g.players.values()].some((o) => !o.captured && o.floor === p.floor && o.hp < 55);

    const fits = (s) => {
      switch (s.bot) {
        case 'target': return threat && los && d <= (s.range ?? 10) * 0.9;
        case 'zone': return threat && los && d <= 12;
        case 'escape': return huntedClose;
        case 'heal': return hurt;
        case 'self': return threat && d < 10;
        case 'ally':
          if (s.id === 'aegis_void') {
            return !!m && [...g.players.values()].some((o) => o.floor === p.floor && !o.captured &&
              Math.hypot(o.x - p.x, o.z - p.z) <= s.shieldRadius && Math.hypot(o.x - m.x, o.z - m.z) < (isHusk ? 3 : 4.5));
          }
          return threat && d < (isHusk ? 4 : 8);
        default: return false;
      }
    };
    const aim = () => (m ? yawFromDir(m.x - p.x, m.z - p.z) : p.yaw);
    const fire = (slot) => {
      p.yaw = aim();
      p.pitch = 0;
      const res = g.spells.cast(p, p.yaw, 0, slot);
      if (res.ok) this.castAt = t + (isHusk ? 1.5 + Math.random() * 2 : 0.4 + Math.random() * 0.6);
      return res.ok;
    };

    // Ultimates are saved for the real Amalgam (or for healing), never the training husk.
    if ((p.ult ?? 0) >= 100 && (!isHusk || w.ultimate.bot === 'heal') && fits(w.ultimate) && fire('ult')) return;
    const slots = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    for (const slot of slots) {
      const s = w.spells[slot];
      if (g.spells.cooldownLeft(p, s.id) > 0 || !fits(s)) continue;
      if (fire(slot)) return;
    }
  }

  /** The training husk, when our spell is (nearly) ready. */
  engageTarget() {
    const g = this.game, p = this.p;
    const ability = WIZARD_BY_ID[p.wizardId]?.ability;
    if (!ability || ability.id === 'aegis_void' || g.spells.cooldownLeft(p, ability.id) > ENGAGE_READY) return null;
    const m = g.monsters().find((mm) => mm.kind === 'husk' && mm.floor === p.floor && Math.hypot(mm.x - p.x, mm.z - p.z) < ENGAGE_RADIUS);
    return m ? { m, range: Math.max(1.5, ability.range * 0.6) } : null;
  }

  // ---- movement --------------------------------------------------------------------

  leader() {
    let best = null;
    for (const h of this.game.players.values()) {
      if (h.isBot || h.captured || h.capturing) continue;
      const score = (h.floor === this.p.floor ? 0 : 1000) + Math.hypot(h.x - this.p.x, h.z - this.p.z);
      if (!best || score < best.score) best = { h, score };
    }
    return best?.h ?? null;
  }

  /**
   * Head for `goal` (any floor). Returns true once within `stop` units on the
   * goal's floor (and, if `needLos`, with line of sight to it).
   */
  moveTo(goal, stop, dt, t, needLos = false) {
    const g = this.game, p = this.p;
    if (goal.floor !== p.floor) {
      const stairs = g.props[p.floor === 0 ? g.map.ids.stairsDown : g.map.ids.stairsUp];
      if (Math.hypot(stairs.front.x - p.x, stairs.front.z - p.z) < 1.0) {
        g.useStairs(p, stairs);
        this.path = [];
      } else {
        this.walk(stairs.front, Infinity, dt, t);
      }
      return false;
    }
    const d = Math.hypot(goal.x - p.x, goal.z - p.z);
    if (d <= stop && (!needLos || lineOfSight(g.map, p.floor, p.x, p.z, goal.x, goal.z))) return true;
    this.walk(goal, d, dt, t);
    return false;
  }

  walk(goal, distToGoal, dt, t) {
    const g = this.game, p = this.p;
    const key = `${p.floor}:${worldToTile(goal.x)},${worldToTile(goal.z)}`;
    if (t >= this.repathAt || this.path.length === 0 || key !== this.pathKey) {
      const floor = g.map.floors[p.floor];
      const tiles = findPath(floor, worldToTile(p.x), worldToTile(p.z), worldToTile(goal.x), worldToTile(goal.z), 6000);
      this.path = tiles ? pathToWorld(tiles) : [];
      this.pathKey = key;
      this.repathAt = t + 0.6 + this.index * 0.1;
    }
    while (this.path.length && Math.hypot(this.path[0].x - p.x, this.path[0].z - p.z) < 0.45) this.path.shift();
    const target = this.path[0] ?? goal;
    const dx = target.x - p.x, dz = target.z - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return;

    const far = distToGoal > SPRINT_DISTANCE;
    const speed = far ? SPEED.sprint : SPEED.walk;
    const step = Math.min(len, speed * dt);
    const moved = moveCircle(g.world, p.floor, p.x, p.z, (dx / len) * step, (dz / len) * step, PLAYER_RADIUS);
    p.x = moved.x;
    p.z = moved.z;
    p.moving = true;
    p.sprint = far;
    p.yaw = turnToward(p.yaw, yawFromDir(dx, dz), dt * 7);
    p.pitch *= 0.9;
    if (far && t >= p.noiseAt) {
      p.noiseAt = t + 0.5;
      g.noise(p, 10, 'sprint');
    }

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
