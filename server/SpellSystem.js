// Server-authoritative spells: cooldowns, range/cone/line-of-sight targeting,
// projectiles, puddle zones, Earth barricades and Void shields. Every cast is
// broadcast as a `cast` event (clients render VFX from it); projectile hits
// as `impact`; barricade expiry as `barrier:end`.
//
// Targets are MonsterBody instances (game.monsters()), so the Training Husk
// and the Step 4 Monster share one code path.

import { WIZARD_BY_ID } from '../shared/wizards.js';
import { lineOfSight, overlapsSolid, addBarrier, removeBarrier } from '../shared/collision.js';
import { DIRS, TILE, TILE_WALL, PLAYER_RADIUS, worldToTile } from '../shared/constants.js';

const r2 = (v) => Math.round(v * 100) / 100;
const SUBSTEPS = 4;

export class SpellSystem {
  constructor(game) {
    this.game = game;
    this.nextId = 1;
    this.projectiles = [];
    this.zones = [];
    this.barriers = [];
  }

  get t() { return this.game.time; }

  cooldownLeft(p, abilityId) {
    return Math.max(0, (p.cooldowns?.[abilityId] ?? 0) - this.t);
  }

  isShielded(p) { return this.t < (p.shieldUntil ?? 0); }

  /**
   * Attempt a cast. `yaw` is the caster's aim; the origin is always the
   * server's copy of the caster's position.
   * @returns {{ok: true, event, cooldown} | {ok: false, reason, remaining?}}
   */
  cast(p, yaw, pitch = 0) {
    const ability = WIZARD_BY_ID[p.wizardId]?.ability;
    if (!ability) return { ok: false, reason: 'no-ability' };
    if (!Number.isFinite(yaw)) return { ok: false, reason: 'bad-aim' };
    const remaining = this.cooldownLeft(p, ability.id);
    if (remaining > 0) return { ok: false, reason: 'cooldown', remaining };

    const cooldown = ability.cooldown * (this.game.cooldownScale ?? 1);
    p.cooldowns ??= {};
    p.cooldowns[ability.id] = this.t + cooldown;

    const dir = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const event = {
      type: 'cast',
      id: this.nextId++,
      caster: p.id,
      ability: ability.id,
      floor: p.floor,
      x: r2(p.x),
      z: r2(p.z),
      yaw: Math.round(yaw * 1000) / 1000,
      pitch: Number.isFinite(pitch) ? Math.round(pitch * 1000) / 1000 : 0,
    };
    this.handlers[ability.id].call(this, p, ability, dir, event);
    this.game.emitAll(event);
    return { ok: true, event, cooldown };
  }

  /** The monster inside the caster's aim cone, in range and in line of sight. */
  coneTarget(p, a, dir) {
    let best = null;
    for (const m of this.game.monsters()) {
      if (m.dead || m.floor !== p.floor) continue;
      const dx = m.x - p.x, dz = m.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > a.range + m.radius) continue;
      if (d > m.radius + 0.4) {
        const along = dx * dir.x + dz * dir.z;
        if (along <= 0) continue;
        const across = Math.abs(dx * dir.z - dz * dir.x);
        // Inside the cone, or the body overlaps the aim ray.
        if (along / d < Math.cos(a.cone) && across > m.radius + 0.3) continue;
      }
      if (!lineOfSight(this.game.map, p.floor, p.x, p.z, m.x, m.z)) continue;
      if (!best || d < best.d) best = { m, d };
    }
    return best?.m ?? null;
  }

  /** Walk forward from the caster until a wall; returns the farthest clear point. */
  reach(p, dir, maxDist) {
    let x = p.x, z = p.z;
    for (let d = 0.5; d <= maxDist; d += 0.5) {
      const nx = p.x + dir.x * d, nz = p.z + dir.z * d;
      if (overlapsSolid(this.game.world, p.floor, nx, nz, 0.2)) break;
      x = nx;
      z = nz;
    }
    return { x, z };
  }

  handlers = {
    psychic_torment(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      const end = m ?? this.reach(p, dir, a.range);
      ev.to = { x: r2(end.x), z: r2(end.z) };
      if (!m) return;
      m.torment(a.interrupt, a.reveal);
      ev.hit = m.id;
    },

    ignis_blast(p, a, dir, ev) {
      const proj = {
        id: ev.id,
        owner: p.id,
        floor: p.floor,
        x: p.x + dir.x * 0.6,
        z: p.z + dir.z * 0.6,
        vx: dir.x * a.projectileSpeed,
        vz: dir.z * a.projectileSpeed,
        traveled: 0,
        a,
      };
      this.projectiles.push(proj);
      ev.from = { x: r2(proj.x), z: r2(proj.z) };
      ev.speed = a.projectileSpeed;
      ev.range = a.range;
    },

    tidal_surge(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      if (m) {
        m.damage(a.damage, 'water');
        m.slow(a.slow, a.slowDuration);
        ev.hit = m.id;
      }
      const at = m ?? this.reach(p, dir, a.range * 0.6);
      const zone = { id: ev.id, kind: 'puddle', floor: p.floor, x: at.x, z: at.z, r: a.puddleRadius, until: this.t + a.puddleDuration, a };
      this.zones.push(zone);
      ev.puddle = { x: r2(zone.x), z: r2(zone.z), r: zone.r, duration: a.puddleDuration };
      ev.range = a.range;
    },

    terra_spike(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      if (m) {
        m.damage(a.damage, 'earth');
        ev.hit = m.id;
      }
      ev.range = a.range;
      const tiles = this.barricadeTiles(p, a, dir);
      if (tiles.length) {
        addBarrier(this.game.world, p.floor, ev.id, tiles);
        this.barriers.push({ id: ev.id, floor: p.floor, tiles, until: this.t + a.wallDuration });
        ev.wall = { tiles, duration: a.wallDuration };
      }
    },

    gale_force(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      ev.range = a.range;
      if (!m) return;
      m.knockback(p.x, p.z, a.knockback, a.knockbackTime, dir);
      ev.hit = m.id;
    },

    sacred_bind(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      const at = m ?? this.reach(p, dir, 4);
      ev.to = { x: r2(at.x), z: r2(at.z) };
      if (!m) return;
      m.stun(a.stun);
      ev.hit = m.id;
      ev.duration = a.stun;
    },

    aegis_void(p, a, dir, ev) {
      const shielded = [];
      for (const o of this.game.players.values()) {
        if (o.floor !== p.floor || Math.hypot(o.x - p.x, o.z - p.z) > a.shieldRadius) continue;
        o.shieldUntil = this.t + a.shieldDuration;
        shielded.push(o.id);
      }
      ev.shielded = shielded;
      ev.duration = a.shieldDuration;
      ev.radius = a.shieldRadius;
    },
  };

  /**
   * Tiles for Terra Spike's wall: `wallTiles` wide, perpendicular to the
   * cardinal direction nearest the aim, `wallDistance` tiles ahead. Skips
   * walls, furniture, existing barricades and anyone standing there.
   */
  barricadeTiles(p, a, dir) {
    const floor = this.game.map.floors[p.floor];
    let d = 0, bestDot = -Infinity;
    DIRS.forEach(([dx, dz], i) => {
      const dot = dx * dir.x + dz * dir.z;
      if (dot > bestDot) { bestDot = dot; d = i; }
    });
    const [fx, fz] = DIRS[d];
    const [px, pz] = DIRS[(d + 1) % 4];
    const tx0 = worldToTile(p.x), tz0 = worldToTile(p.z);
    const half = Math.floor(a.wallTiles / 2);
    const bodies = [...this.game.players.values()].map((o) => ({ floor: o.floor, x: o.x, z: o.z, r: PLAYER_RADIUS }))
      .concat(this.game.monsters().map((m) => ({ floor: m.floor, x: m.x, z: m.z, r: m.radius })));

    for (let dist = a.wallDistance; dist >= 1; dist--) {
      const cx = tx0 + fx * dist, cz = tz0 + fz * dist;
      const tiles = [];
      for (let k = -half; k <= half; k++) {
        const tx = cx + px * k, tz = cz + pz * k;
        if (tx < 0 || tz < 0 || tx >= floor.w || tz >= floor.h) continue;
        const i = tz * floor.w + tx;
        if (floor.tiles[i] === TILE_WALL || floor.blocked[i] || floor.dyn?.[i]) continue;
        const occupied = bodies.some((b) => b.floor === p.floor &&
          b.x + b.r > tx * TILE && b.x - b.r < (tx + 1) * TILE && b.z + b.r > tz * TILE && b.z - b.r < (tz + 1) * TILE);
        if (!occupied) tiles.push([tx, tz]);
      }
      if (tiles.length) return tiles;
    }
    return [];
  }

  update(dt) {
    // Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      let done = false;
      for (let s = 0; s < SUBSTEPS && !done; s++) {
        const sx = (pr.vx * dt) / SUBSTEPS, sz = (pr.vz * dt) / SUBSTEPS;
        pr.x += sx;
        pr.z += sz;
        pr.traveled += Math.hypot(sx, sz);
        const m = this.game.monsters().find((mm) => !mm.dead && mm.floor === pr.floor &&
          Math.hypot(mm.x - pr.x, mm.z - pr.z) < mm.radius + pr.a.projectileRadius);
        if (m) {
          m.damage(pr.a.damage, 'fire');
          m.burn(pr.a.burnDps, pr.a.burnDuration, pr.a.burnSlow);
          this.impact(pr, m.id);
          done = true;
        } else if (pr.traveled >= pr.a.range || overlapsSolid(this.game.world, pr.floor, pr.x, pr.z, pr.a.projectileRadius)) {
          pr.x -= sx;
          pr.z -= sz;
          this.impact(pr, null);
          done = true;
        }
      }
      if (done) this.projectiles.splice(i, 1);
    }

    // Puddles
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (this.t >= z.until) { this.zones.splice(i, 1); continue; }
      for (const m of this.game.monsters()) {
        if (m.dead || m.floor !== z.floor || Math.hypot(m.x - z.x, m.z - z.z) > z.r + m.radius * 0.5) continue;
        m.slow(z.a.slow, 0.25);
        m.wet(z.a.turnSlow, 0.25);
      }
    }

    // Barricades crumble
    for (let i = this.barriers.length - 1; i >= 0; i--) {
      const b = this.barriers[i];
      if (this.t < b.until) continue;
      removeBarrier(this.game.world, b.id);
      this.barriers.splice(i, 1);
      this.game.emitAll({ type: 'barrier:end', id: b.id });
    }
  }

  impact(pr, hitId) {
    this.game.emitAll({
      type: 'impact',
      id: pr.id,
      ability: 'ignis_blast',
      floor: pr.floor,
      x: r2(pr.x),
      z: r2(pr.z),
      hit: hitId,
      scorch: pr.a.scorchDuration,
    });
  }

  /** Live barricades, for clients joining mid-game. */
  activeBarriers() {
    return this.barriers.map((b) => ({ id: b.id, floor: b.floor, tiles: b.tiles, remaining: r2(b.until - this.t) }));
  }
}
