// Server-authoritative grimoire: 7 wizards × (4 spells + 1 Ultimate).
//
// Cast flow: validate (cooldown / ult charge) → handler (targeting, effects,
// spawn projectiles / zones / entities / buffs) → broadcast `cast` event →
// commit cooldown or spend charge. Handlers return `false` to refuse a cast
// with no valid target (nothing is spent).
//
// Live state:
//   projectiles  moving shots (optionally homing/piercing), in snapshots as `prj`
//   zones        placed areas with a per-tick effect (puddles, burning lines,
//                gravity wells, rune traps, briars, beacons, null fields…)
//   entities     dragons and the Tree of Life, in snapshots as `ents`
//   barriers     Terra Spike walls (collision + pathfinding; can be smashed)
//   buffs        per-player timed effects (p.buffs), in snapshots as `bf`
//
// Targets are MonsterBody instances (game.monsters()).

import { WIZARD_BY_ID, ULT } from '../shared/wizards.js';
import { lineOfSight, overlapsSolid, addBarrier, removeBarrier, moveCircle } from '../shared/collision.js';
import { findPath, pathToWorld } from '../shared/pathfinding.js';
import { DIRS, TILE, TILE_WALL, PLAYER_RADIUS, HP, worldToTile, tileCenter } from '../shared/constants.js';

const r2 = (v) => Math.round(v * 100) / 100;
const SUBSTEPS = 4;

/** Distance from point P to segment AB. */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1e-9;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + dx * k), pz - (az + dz * k));
}

export class SpellSystem {
  constructor(game) {
    this.game = game;
    this.nextId = 1;
    this.projectiles = [];
    this.zones = [];
    this.barriers = [];
    this.entities = [];
    this.scheduled = [];
  }

  get t() { return this.game.time; }

  // ---- queries --------------------------------------------------------------------

  cooldownLeft(p, abilityId) { return Math.max(0, (p.cooldowns?.[abilityId] ?? 0) - this.t); }
  isShielded(p) { return this.t < (p.shieldUntil ?? 0); }
  hasBuff(p, name) { const b = p.buffs?.[name]; return !!b && this.t < b.until; }
  buffCodes(p) { return Object.keys(p.buffs ?? {}).filter((k) => this.hasBuff(p, k)); }
  addBuff(p, name, duration, extra = {}) {
    p.buffs ??= {};
    p.buffs[name] = { until: this.t + duration, ...extra };
  }

  /** Free wizards on p's floor within `radius` of p (including p). */
  allies(p, radius) {
    return [...this.game.players.values()].filter((o) => o.floor === p.floor && !o.captured && !o.capturing &&
      Math.hypot(o.x - p.x, o.z - p.z) <= radius);
  }

  spellFor(p, slot) {
    const w = WIZARD_BY_ID[p.wizardId];
    if (!w) return null;
    return slot === 'ult' ? w.ultimate : w.spells[slot] ?? null;
  }

  // ---- casting -----------------------------------------------------------------------

  /**
   * @param slot 0–3 for the hotbar, 'ult' for the Ultimate
   * @returns {{ok: true, event, cooldown} | {ok: false, reason, remaining?}}
   */
  cast(p, yaw, pitch = 0, slot = 0) {
    const spell = this.spellFor(p, slot);
    if (!spell) return { ok: false, reason: WIZARD_BY_ID[p.wizardId] ? 'bad-slot' : 'no-ability' };
    if (!Number.isFinite(yaw)) return { ok: false, reason: 'bad-aim' };
    const ult = slot === 'ult';
    if (ult && (p.ult ?? 0) < ULT.MAX) return { ok: false, reason: 'charge', charge: p.ult ?? 0 };
    const remaining = ult ? 0 : this.cooldownLeft(p, spell.id);
    if (remaining > 0) return { ok: false, reason: 'cooldown', remaining };

    const dir = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const event = {
      type: 'cast',
      id: this.nextId++,
      caster: p.id,
      ability: spell.id,
      slot,
      ult,
      floor: p.floor,
      x: r2(p.x),
      z: r2(p.z),
      yaw: Math.round(yaw * 1000) / 1000,
      pitch: Number.isFinite(pitch) ? Math.round(pitch * 1000) / 1000 : 0,
    };
    if (this.handlers[spell.id].call(this, p, spell, dir, event) === false) {
      return { ok: false, reason: 'no-target' };
    }
    const cooldown = ult ? 0 : spell.cooldown * (this.game.cooldownScale ?? 1);
    if (ult) p.ult = 0;
    else {
      p.cooldowns ??= {};
      p.cooldowns[spell.id] = this.t + cooldown;
    }
    this.game.emitAll(event);
    this.game.noise?.(p, 14, 'spell'); // magic is loud
    return { ok: true, event, cooldown };
  }

  /** Ultimate charge for landing a normal spell (once per cast). */
  credit(p, ev) {
    if (!p || ev.ult || ev.credited) return;
    Object.defineProperty(ev, 'credited', { value: true, enumerable: false });
    this.game.addUlt?.(p, ULT.HIT);
  }

  /** The monster inside the caster's aim cone, in range and in line of sight. */
  coneTarget(p, a, dir) {
    let best = null;
    for (const m of this.game.monsters()) {
      if (!m.targetable || m.floor !== p.floor) continue;
      const dx = m.x - p.x, dz = m.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > a.range + m.radius) continue;
      if (d > m.radius + 0.4) {
        const along = dx * dir.x + dz * dir.z;
        if (along <= 0) continue;
        const across = Math.abs(dx * dir.z - dz * dir.x);
        if (along / d < Math.cos(a.cone ?? 0.4) && across > m.radius + 0.3) continue;
      }
      if (!lineOfSight(this.game.map, p.floor, p.x, p.z, m.x, m.z)) continue;
      if (!best || d < best.d) best = { m, d };
    }
    return best?.m ?? null;
  }

  /** Nearest targetable monster on p's floor, optionally within range + sight. */
  nearestMonster(p, range = Infinity, needLos = false) {
    let best = null;
    for (const m of this.game.monsters()) {
      if (m.floor !== p.floor) continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d > range || (needLos && !lineOfSight(this.game.map, p.floor, p.x, p.z, m.x, m.z))) continue;
      if (!best || d < best.d) best = { m, d };
    }
    return best?.m ?? null;
  }

  /** Walk forward from the caster until a wall; returns the farthest clear point. */
  reach(p, dir, maxDist) {
    let x = p.x, z = p.z;
    for (let d = 0.5; d <= maxDist; d += 0.5) {
      const nx = p.x + dir.x * d, nz = p.z + dir.z * d;
      if (overlapsSolid(this.game.world, p.floor, nx, nz, 0.2, { ignoreDynamic: true })) break;
      x = nx;
      z = nz;
    }
    return { x, z };
  }

  schedule(delay, fn) { this.scheduled.push({ at: this.t + delay, fn }); }

  // ---- spawners ----------------------------------------------------------------------

  spawnProjectile(p, ev, a, { id = ev.id, kind, dir, speed, radius, range, homing = false, pierce = false, from, onHit, onEnd, impact = {} }) {
    const start = from ?? { x: p.x + dir.x * 0.6, z: p.z + dir.z * 0.6 };
    this.projectiles.push({
      id, castId: ev.id, ev, a, owner: p, kind, floor: p.floor,
      x: start.x, z: start.z, vx: dir.x * speed, vz: dir.z * speed, speed,
      radius, range, homing, pierce, traveled: 0, hitIds: new Set(), onHit, onEnd, impact,
      path: null, repathAt: 0,
    });
  }

  addZone(zone) {
    this.zones.push({ id: this.nextId++, ...zone });
    return this.zones.at(-1);
  }

  // ---- the grimoire ------------------------------------------------------------------

  handlers = {
    // ======================= Injorath Blackthorn (Black) =======================
    psychic_torment(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      const end = m ?? this.reach(p, dir, a.range);
      ev.to = { x: r2(end.x), z: r2(end.z) };
      if (!m) return;
      m.torment(a.interrupt, a.reveal);
      ev.hit = m.id;
      this.credit(p, ev);
    },
    dimension_slash(p, a, dir, ev) {
      this.spawnProjectile(p, ev, a, {
        kind: 'crescent', dir, speed: a.speed, radius: a.radius, range: a.range,
        onHit: (m) => {
          m.damage(a.damage, 'black');
          m.knockback(p.x, p.z, a.knock, 0.25, dir);
          m.st.staggerUntil = Math.max(m.st.staggerUntil, this.t + a.stagger);
          m.shortenReach(a.shortReach, a.reachScale);
          this.credit(p, ev);
        },
      });
    },
    black_hole(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      const at = m ? { x: m.x, z: m.z } : this.reach(p, dir, a.range);
      const zone = this.addZone({ kind: 'gravity', floor: p.floor, x: at.x, z: at.z, r: a.radius, until: this.t + a.duration, a, ev, owner: p, acc: 0 });
      ev.zone = { x: r2(zone.x), z: r2(zone.z), r: a.radius, duration: a.duration };
    },
    shadow_step(p, a, dir, ev) {
      this.addBuff(p, 'shadow', a.duration);
      for (const m of this.game.bodies()) m.loseTarget?.(p);
      ev.duration = a.duration;
    },
    abyssal_mind_fracture(p, a, dir, ev) {
      const m = this.nearestMonster(p, a.range, true);
      if (!m) return false;
      m.confuse(a.duration, a.selfDps);
      m.st.revealUntil = Math.max(m.st.revealUntil, this.t + a.duration);
      ev.hit = m.id;
      ev.to = { x: r2(m.x), z: r2(m.z) };
      ev.duration = a.duration;
      this.game.emitAll({ type: 'monster:scream', id: m.id, floor: m.floor, x: r2(m.x), z: r2(m.z), long: true });
    },

    // ======================= Parthius Pyreborne (Fire) =======================
    ignis_blast(p, a, dir, ev) {
      this.spawnProjectile(p, ev, a, {
        kind: 'fireball', dir, speed: a.projectileSpeed, radius: a.projectileRadius, range: a.range,
        impact: { scorch: a.scorchDuration },
        onHit: (m) => {
          m.damage(a.damage, 'fire');
          m.burn(a.burnDps, a.burnDuration, a.burnSlow);
          this.credit(p, ev);
        },
      });
      const pr = this.projectiles.at(-1);
      ev.from = { x: r2(pr.x), z: r2(pr.z) };
      ev.speed = a.projectileSpeed;
      ev.range = a.range;
    },
    calidus_brachium(p, a, dir, ev) {
      ev.hits = a.hits;
      for (let i = 0; i < a.hits; i++) {
        this.schedule(i * a.interval, () => {
          const m = this.coneTarget(p, a, dir);
          if (!m) return;
          m.damage(a.damage, 'fire');
          m.knockback(p.x, p.z, a.knock, 0.15, dir);
          this.credit(p, ev);
          this.game.emitAll({ type: 'spell:hit', castId: ev.id, ability: a.id, id: m.id, floor: m.floor, x: r2(m.x), z: r2(m.z) });
        });
      }
    },
    sol_linea(p, a, dir, ev) {
      const end = this.reach(p, dir, a.range);
      ev.to = { x: r2(end.x), z: r2(end.z) };
      for (const m of this.game.monsters()) {
        if (m.floor !== p.floor || segDist(m.x, m.z, p.x, p.z, end.x, end.z) > a.width / 2 + m.radius) continue;
        if (((m.x - p.x) * dir.x + (m.z - p.z) * dir.z) < 0) continue;
        m.damage(a.damage, 'fire');
        m.burn(a.burnDps, a.burnDuration, 0.1);
        ev.hit = m.id;
        this.credit(p, ev);
      }
      this.addZone({ kind: 'burnline', floor: p.floor, x: p.x, z: p.z, x2: end.x, z2: end.z, r: a.width / 2, until: this.t + a.lineDuration, a });
      ev.duration = a.lineDuration;
    },
    phoenix_aura(p, a, dir, ev) {
      this.addBuff(p, 'phoenix', a.duration);
      ev.duration = a.duration;
    },
    fiendfyre_dragon(p, a, dir, ev) {
      const m = this.nearestMonster(p);
      if (!m) return false;
      this.spawnDragon(p, a, dir, ev, 'fire_dragon', m);
    },

    // ======================= Himandriel Tidecrest (Water) =======================
    tidal_surge(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      if (m) {
        m.damage(a.damage, 'water');
        m.slow(a.slow, a.slowDuration);
        ev.hit = m.id;
        this.credit(p, ev);
      }
      const at = m ?? this.reach(p, dir, a.range * 0.6);
      const zone = this.addZone({ kind: 'puddle', floor: p.floor, x: at.x, z: at.z, r: a.puddleRadius, until: this.t + a.puddleDuration, a });
      ev.puddle = { x: r2(zone.x), z: r2(zone.z), r: zone.r, duration: a.puddleDuration };
      ev.range = a.range;
    },
    water_spear(p, a, dir, ev) {
      this.spawnProjectile(p, ev, a, {
        kind: 'spear', dir, speed: a.speed, radius: a.radius, range: a.range, pierce: true,
        onHit: (m) => {
          m.damage(a.damage, 'water');
          m.pin(a.pin);
          this.credit(p, ev);
        },
      });
    },
    sea_cradle(p, a, dir, ev) {
      const ids = [];
      for (const o of this.allies(p, a.radius)) {
        this.addBuff(o, 'cradle', a.duration, { hp: a.absorb });
        ids.push(o.id);
      }
      ev.shielded = ids;
      ev.duration = a.duration;
    },
    riptide_vortex(p, a, dir, ev) {
      const at = this.reach(p, dir, a.range);
      const zone = this.addZone({ kind: 'riptide', floor: p.floor, x: at.x, z: at.z, r: a.trigger, until: this.t + a.life, a, ev, owner: p, armed: true });
      ev.zone = { id: zone.id, x: r2(zone.x), z: r2(zone.z), r: a.trigger, duration: a.life };
    },
    abyssal_deluge(p, a, dir, ev) {
      this.game.flood = { until: this.t + a.duration, slow: a.slow };
      ev.duration = a.duration;
    },

    // ======================= Sushantus Thornwick (Earth) =======================
    terra_spike(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      if (m) {
        m.damage(a.damage, 'earth');
        ev.hit = m.id;
        this.credit(p, ev);
      }
      ev.range = a.range;
      const tiles = this.barricadeTiles(p, a, dir);
      if (tiles.length) {
        addBarrier(this.game.world, p.floor, ev.id, tiles);
        this.barriers.push({ id: ev.id, floor: p.floor, tiles, until: this.t + a.wallDuration, hp: a.wallHits });
        ev.wall = { tiles, duration: a.wallDuration };
      }
    },
    devils_snare(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      const at = m ? { x: m.x, z: m.z } : this.reach(p, dir, 6);
      const zone = this.addZone({ kind: 'briars', floor: p.floor, x: at.x, z: at.z, r: a.radius, until: this.t + a.zoneDuration, a, ev, owner: p, rooted: new Set() });
      ev.zone = { x: r2(zone.x), z: r2(zone.z), r: a.radius, duration: a.zoneDuration };
    },
    golem_boulder(p, a, dir, ev) {
      this.spawnProjectile(p, ev, a, {
        kind: 'boulder', dir, speed: a.speed, radius: a.radius, range: a.range,
        onHit: (m) => {
          m.damage(a.damage, 'earth');
          this.credit(p, ev);
        },
        onEnd: (x, z, impact) => {
          this.addZone({ kind: 'debris', floor: p.floor, x, z, r: a.debrisRadius, until: this.t + a.debrisDuration, a });
          impact.zone = { r: a.debrisRadius, duration: a.debrisDuration };
        },
      });
    },
    granite_skin(p, a, dir, ev) {
      const ids = [];
      for (const o of this.allies(p, a.radius)) {
        this.addBuff(o, 'granite', a.duration);
        ids.push(o.id);
      }
      ev.shielded = ids;
      ev.duration = a.duration;
    },
    yggdrasil(p, a, dir, ev) {
      const spot = this.reach(p, dir, 2.2); // the adjacent tile, within reach of its fruit
      const tx = worldToTile(spot.x), tz = worldToTile(spot.z);
      const f = this.game.map.floors[p.floor];
      const i = tz * f.w + tx;
      const occupied = [...this.game.players.values()].some((o) => o.floor === p.floor && worldToTile(o.x) === tx && worldToTile(o.z) === tz);
      const solid = f.tiles[i] === TILE_WALL || f.blocked[i] || f.dyn?.[i] || occupied;
      const fruits = this.game.players.size;
      const tree = {
        id: ev.id, kind: 'tree', floor: p.floor, x: tileCenter(tx), z: tileCenter(tz), yaw: 0,
        fruits, until: this.t + a.life, a, owner: p.id, barrier: !solid,
      };
      if (!solid) addBarrier(this.game.world, p.floor, `tree${ev.id}`, [[tx, tz]]);
      this.entities.push(tree);
      ev.tree = { x: tree.x, z: tree.z, fruits, duration: a.life };
    },

    // ======================= Kartavian Windermere (Wind) =======================
    gale_force(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      ev.range = a.range;
      if (!m) return;
      m.knockback(p.x, p.z, a.knockback, a.knockbackTime, dir);
      ev.hit = m.id;
      this.credit(p, ev);
    },
    kamaitachi(p, a, dir, ev) {
      ev.blades = a.blades;
      for (let i = 0; i < a.blades; i++) {
        this.schedule(i * a.interval, () => {
          const spread = (i - (a.blades - 1) / 2) * 0.35;
          const yaw = Math.atan2(-dir.x, -dir.z) + spread;
          this.spawnProjectile(p, ev, a, {
            id: `${ev.id}.${i}`, kind: 'blade', dir: { x: -Math.sin(yaw), z: -Math.cos(yaw) },
            speed: a.speed, radius: a.radius, range: a.range, homing: true,
            onHit: (m) => {
              m.damage(a.damage, 'wind');
              m.knockback(p.x, p.z, a.knock, 0.12);
              this.credit(p, ev);
            },
          });
        });
      }
    },
    zephyr_tailwind(p, a, dir, ev) {
      const ids = [];
      for (const o of this.allies(p, a.radius)) {
        this.addBuff(o, 'tailwind', a.duration);
        ids.push(o.id);
      }
      ev.shielded = ids;
      ev.duration = a.duration;
    },
    vacuum_tempest(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      const at = m ? { x: m.x, z: m.z } : this.reach(p, dir, a.range * 0.6);
      ev.zone = { x: r2(at.x), z: r2(at.z), r: a.radius, duration: a.lift };
      for (const mm of this.game.monsters()) {
        if (mm.floor !== p.floor || Math.hypot(mm.x - at.x, mm.z - at.z) > a.radius + mm.radius) continue;
        mm.lift(a.lift);
        mm.pull(at.x, at.z, a.lift, 3);
        ev.hit = mm.id;
        this.credit(p, ev);
      }
    },
    sylph_dragon(p, a, dir, ev) {
      const m = this.nearestMonster(p);
      if (!m) return false;
      this.spawnDragon(p, a, dir, ev, 'wind_dragon', m);
    },

    // ======================= Soham Everlight (White) =======================
    sacred_bind(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      const at = m ?? this.reach(p, dir, 4);
      ev.to = { x: r2(at.x), z: r2(at.z) };
      if (!m) return;
      m.stun(a.stun);
      ev.hit = m.id;
      ev.duration = a.stun;
      this.credit(p, ev);
    },
    arrows_of_judgment(p, a, dir, ev) {
      ev.count = a.count;
      for (let i = 0; i < a.count; i++) {
        this.schedule(0.35 + i * a.interval, () => {
          const side = (i - (a.count - 1) / 2) * 0.45;
          this.spawnProjectile(p, ev, a, {
            id: `${ev.id}.${i}`, kind: 'sword', dir, speed: a.speed, radius: a.radius, range: a.range, homing: true,
            from: { x: p.x + dir.z * side, z: p.z - dir.x * side },
            onHit: (m) => {
              m.damage(a.damage, 'white');
              m.knockback(p.x, p.z, a.knock, 0.1);
              this.credit(p, ev);
            },
          });
        });
      }
    },
    patronus_beacon(p, a, dir, ev) {
      const zone = this.addZone({ kind: 'patronus', floor: p.floor, x: p.x, z: p.z, r: a.radius, until: this.t + a.duration, a });
      ev.zone = { x: r2(zone.x), z: r2(zone.z), r: a.radius, duration: a.duration };
    },
    flash_step(p, a, dir, ev) {
      const from = { x: p.x, z: p.z };
      const to = moveCircle(this.game.world, p.floor, p.x, p.z, dir.x * a.distance, dir.z * a.distance, PLAYER_RADIUS);
      ev.from = { x: r2(from.x), z: r2(from.z) };
      ev.to = { x: r2(to.x), z: r2(to.z) };
      this.game.teleport(p, to.x, to.z, p.floor, p.yaw);
      for (const m of this.game.monsters()) {
        if (m.floor !== p.floor || Math.hypot(m.x - from.x, m.z - from.z) > a.blindRadius) continue;
        if (!lineOfSight(this.game.map, p.floor, from.x, from.z, m.x, m.z)) continue;
        m.stun(a.blind);
        ev.hit = m.id;
        this.credit(p, ev);
      }
    },
    dawn_sacred_order(p, a, dir, ev) {
      this.game.dawn = { until: this.t + a.duration };
      for (const m of this.game.bodies()) m.freeze(a.duration);
      ev.duration = a.duration;
    },

    // ======================= Himanshu Nullgrave (Anti-magic) =======================
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
    black_slash(p, a, dir, ev) {
      const m = this.coneTarget(p, a, dir);
      ev.range = a.range;
      if (!m) return;
      m.damage(a.damage, 'void');
      m.action = null; // the windup is cut apart
      m.calm(a.calm);
      ev.hit = m.id;
      this.credit(p, ev);
    },
    null_zone(p, a, dir, ev) {
      const zone = this.addZone({ kind: 'null', floor: p.floor, x: p.x, z: p.z, r: a.radius, until: this.t + a.duration, a });
      ev.zone = { x: r2(zone.x), z: r2(zone.z), r: a.radius, duration: a.duration };
    },
    bull_thrust(p, a, dir, ev) {
      const from = { x: p.x, z: p.z };
      const to = moveCircle(this.game.world, p.floor, p.x, p.z, dir.x * a.distance, dir.z * a.distance, PLAYER_RADIUS);
      ev.from = { x: r2(from.x), z: r2(from.z) };
      ev.to = { x: r2(to.x), z: r2(to.z) };
      this.game.teleport(p, to.x, to.z, p.floor, p.yaw);
      for (const m of this.game.monsters()) {
        if (m.floor !== p.floor || segDist(m.x, m.z, from.x, from.z, to.x, to.z) > a.hitRadius) continue;
        m.knockback(from.x, from.z, a.knock, 0.25, dir);
        m.taunt?.(p, a.taunt);
        ev.hit = m.id;
        this.credit(p, ev);
      }
    },
    devil_union(p, a, dir, ev) {
      const ids = [];
      for (const o of this.game.players.values()) {
        this.addBuff(o, 'union', a.duration);
        ids.push(o.id);
      }
      ev.shielded = ids;
      ev.duration = a.duration;
    },
  };

  spawnDragon(p, a, dir, ev, kind, target) {
    this.entities.push({
      id: ev.id, kind, floor: p.floor, x: p.x + dir.x, z: p.z + dir.z, yaw: Math.atan2(-dir.x, -dir.z),
      targetId: target.id, until: this.t + a.life, a, owner: p, path: [], repathAt: 0, mode: 'hunt',
    });
    ev.dragon = { targetId: target.id };
  }

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
      .concat(this.game.bodies().map((m) => ({ floor: m.floor, x: m.x, z: m.z, r: m.radius })));

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

  /** The Amalgam smashes a barricade: returns true if it crumbled. */
  hitBarrier(id) {
    const b = this.barriers.find((x) => x.id === id);
    if (!b) return false;
    b.hp -= 1;
    this.game.emitAll({ type: 'barrier:hit', id, hp: b.hp });
    if (b.hp > 0) return false;
    b.until = this.t; // crumbles on the next update
    return true;
  }

  /** A barricade with a tile within `range` of (x, z) on `floor`, if any. */
  barrierNear(floor, x, z, range) {
    for (const b of this.barriers) {
      if (b.floor !== floor || b.hp <= 0) continue;
      for (const [tx, tz] of b.tiles) {
        if (Math.hypot(tileCenter(tx) - x, tileCenter(tz) - z) <= range) return b;
      }
    }
    return null;
  }

  /** E on an entity (the Tree of Life). */
  useEntity(p, entityId) {
    const e = this.entities.find((x) => x.id === entityId);
    if (!e || e.kind !== 'tree' || e.floor !== p.floor || p.captured) return false;
    if (Math.hypot(e.x - p.x, e.z - p.z) > 3.2) return false;
    if (e.fruits <= 0) {
      this.game.whisper(p, 'The branches are bare.');
      return false;
    }
    e.fruits--;
    p.hp = Math.min(HP.MAX, p.hp + e.a.heal);
    if (this.game.finale?.active) this.game.finale.healArchon(e.a.heal);
    this.game.emitAll({ type: 'tree:eat', id: e.id, by: p.id, name: p.name, fruits: e.fruits, hp: Math.round(p.hp) });
    return true;
  }

  // ---- simulation ------------------------------------------------------------------------

  update(dt) {
    const t = this.t;

    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      if (t >= this.scheduled[i].at) this.scheduled.splice(i, 1)[0].fn();
    }

    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.updateEntities(dt);

    // Phoenix aura burns whatever touches the caster.
    const phoenix = WIZARD_BY_ID.parthius.spells[3];
    for (const p of this.game.players.values()) {
      if (!this.hasBuff(p, 'phoenix')) continue;
      for (const m of this.game.monsters()) {
        if (m.floor === p.floor && Math.hypot(m.x - p.x, m.z - p.z) < phoenix.contactRadius + m.radius) m.burn(phoenix.burnDps, 1, 0.1);
      }
    }

    // Barricades crumble
    for (let i = this.barriers.length - 1; i >= 0; i--) {
      const b = this.barriers[i];
      if (t < b.until) continue;
      removeBarrier(this.game.world, b.id);
      this.barriers.splice(i, 1);
      this.game.emitAll({ type: 'barrier:end', id: b.id, smashed: b.hp <= 0 });
    }
  }

  steerHoming(pr, dt) {
    const m = this.game.monsters().find((mm) => mm.floor === pr.floor);
    if (!m) return;
    let tx = m.x, tz = m.z;
    if (!lineOfSight(this.game.map, pr.floor, pr.x, pr.z, m.x, m.z)) {
      // Slice around corners: follow the corridor toward it.
      if (this.t >= pr.repathAt) {
        const f = this.game.map.floors[pr.floor];
        const tiles = findPath(f, worldToTile(pr.x), worldToTile(pr.z), worldToTile(m.x), worldToTile(m.z), 3000);
        pr.path = tiles ? pathToWorld(tiles) : null;
        pr.repathAt = this.t + 0.3;
      }
      while (pr.path?.length && Math.hypot(pr.path[0].x - pr.x, pr.path[0].z - pr.z) < 0.8) pr.path.shift();
      if (pr.path?.length) { tx = pr.path[0].x; tz = pr.path[0].z; }
    }
    const want = Math.atan2(tz - pr.z, tx - pr.x);
    const cur = Math.atan2(pr.vz, pr.vx);
    const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
    const ang = cur + Math.max(-9 * dt, Math.min(9 * dt, d));
    pr.vx = Math.cos(ang) * pr.speed;
    pr.vz = Math.sin(ang) * pr.speed;
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (pr.homing) this.steerHoming(pr, dt);
      let done = false, hit = null;
      for (let s = 0; s < SUBSTEPS && !done; s++) {
        const sx = (pr.vx * dt) / SUBSTEPS, sz = (pr.vz * dt) / SUBSTEPS;
        pr.x += sx;
        pr.z += sz;
        pr.traveled += Math.hypot(sx, sz);
        const m = this.game.monsters().find((mm) => mm.floor === pr.floor && !pr.hitIds.has(mm.id) &&
          Math.hypot(mm.x - pr.x, mm.z - pr.z) < mm.radius + pr.radius);
        if (m) {
          pr.hitIds.add(m.id);
          pr.onHit?.(m);
          hit = m.id;
          if (!pr.pierce) done = true;
        }
        if (!done && (pr.traveled >= pr.range ||
          overlapsSolid(this.game.world, pr.floor, pr.x, pr.z, pr.radius, { ignoreDynamic: true }))) {
          pr.x -= sx;
          pr.z -= sz;
          done = true;
        }
      }
      if (done) {
        this.projectiles.splice(i, 1);
        const impact = { ...pr.impact };
        pr.onEnd?.(pr.x, pr.z, impact);
        this.game.emitAll({
          type: 'impact', id: pr.id, castId: pr.castId, ability: pr.a.id, kind: pr.kind,
          floor: pr.floor, x: r2(pr.x), z: r2(pr.z), hit: hit ?? [...pr.hitIds][0] ?? null, ...impact,
        });
      }
    }
  }

  updateZones(dt) {
    const t = this.t;
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (t >= z.until) { this.zones.splice(i, 1); continue; }
      const a = z.a;
      if (z.kind === 'patronus') {
        if (this.game.finale?.active) { this.game.finale.healArchon(a.heal * dt); continue; }
        for (const p of this.game.players.values()) {
          if (p.floor === z.floor && !p.captured && Math.hypot(p.x - z.x, p.z - z.z) <= z.r) p.hp = Math.min(HP.MAX, p.hp + a.heal * dt);
        }
        continue;
      }
      if (z.kind === 'null') continue; // a client-side calm; nothing to simulate
      for (const m of this.game.monsters()) {
        if (m.floor !== z.floor) continue;
        const inside = z.kind === 'burnline'
          ? segDist(m.x, m.z, z.x, z.z, z.x2, z.z2) <= z.r + m.radius
          : Math.hypot(m.x - z.x, m.z - z.z) <= z.r + m.radius * 0.5;
        if (!inside) continue;
        switch (z.kind) {
          case 'puddle':
            m.slow(a.slow, 0.25);
            m.wet(a.turnSlow, 0.25);
            break;
          case 'burnline':
            m.burn(a.burnDps, a.burnDuration, 0.1);
            break;
          case 'debris':
            m.slow(a.debrisSlow, 0.3);
            break;
          case 'gravity':
            m.pull(z.x, z.z, 0.15, a.pull);
            z.acc += a.dps * dt;
            if (z.acc >= 1) {
              m.damage(Math.floor(z.acc), 'black');
              z.acc -= Math.floor(z.acc);
            }
            this.credit(z.owner, z.ev);
            break;
          case 'briars':
            if (!z.rooted.has(m.id)) {
              z.rooted.add(m.id);
              m.root(a.root);
              this.credit(z.owner, z.ev);
              this.game.emitAll({ type: 'spell:hit', castId: z.ev.id, ability: a.id, id: m.id, floor: m.floor, x: r2(m.x), z: r2(m.z) });
            }
            break;
          case 'riptide':
            if (z.armed) {
              z.armed = false;
              z.until = t + a.geyser;
              m.lift(a.geyser);
              m.pull(z.x, z.z, a.geyser, 3);
              m.damage(a.damage, 'water');
              this.credit(z.owner, z.ev);
              this.game.emitAll({ type: 'zone:trigger', castId: z.ev.id, ability: a.id, floor: z.floor, x: r2(z.x), z: r2(z.z), duration: a.geyser });
            }
            break;
        }
      }
    }
  }

  /** Room centre on `floor` furthest from every wizard (where the wind dragon dumps the Monster). */
  farthestRoom(floor, from) {
    const map = this.game.map;
    const players = [...this.game.players.values()].filter((p) => p.floor === floor);
    let best = null;
    for (const r of map.rooms) {
      if (r.floor !== floor || r.type === 'cell') continue;
      const pt = { x: tileCenter(r.cx), z: tileCenter(r.cy) };
      if (overlapsSolid(this.game.world, floor, pt.x, pt.z, 0.6)) continue;
      const near = Math.min(Math.hypot(from.x - pt.x, from.z - pt.z), ...players.map((p) => Math.hypot(p.x - pt.x, p.z - pt.z)));
      if (!best || near > best.near) best = { pt, near };
    }
    return best?.pt ?? { x: from.x, z: from.z };
  }

  updateEntities(dt) {
    const t = this.t;
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.kind === 'tree') {
        if (t >= e.until) this.endEntity(i);
        continue;
      }
      // Dragons
      const m = this.game.monsters().find((mm) => mm.id === e.targetId);
      if (e.mode === 'carry') {
        if (!m || !m.isCarried()) { this.endEntity(i); continue; }
        e.x = m.x;
        e.z = m.z;
        continue;
      }
      if (t >= e.until || !m || m.floor !== e.floor) { this.endEntity(i); continue; }
      let tx = m.x, tz = m.z;
      if (!lineOfSight(this.game.map, e.floor, e.x, e.z, m.x, m.z)) {
        if (t >= e.repathAt) {
          const f = this.game.map.floors[e.floor];
          const tiles = findPath(f, worldToTile(e.x), worldToTile(e.z), worldToTile(m.x), worldToTile(m.z), 6000);
          e.path = tiles ? pathToWorld(tiles) : [];
          e.repathAt = t + 0.4;
        }
        while (e.path.length && Math.hypot(e.path[0].x - e.x, e.path[0].z - e.z) < 0.8) e.path.shift();
        if (e.path.length) { tx = e.path[0].x; tz = e.path[0].z; }
      }
      const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        const step = Math.min(d, e.a.speed * dt);
        e.x += (dx / d) * step;
        e.z += (dz / d) * step;
        e.yaw = Math.atan2(-dx, -dz);
      }
      if (Math.hypot(m.x - e.x, m.z - e.z) < m.radius + 1.0) {
        if (e.kind === 'fire_dragon') {
          m.damage(e.a.damage, e.a.mastery ? 'mastery' : 'fire');
          m.burn(e.a.burnDps, e.a.burnDuration, 0.2);
          this.game.emitAll({ type: 'impact', id: e.id, ability: e.a.id, kind: 'dragon', floor: e.floor, x: r2(m.x), z: r2(m.z), hit: m.id, blast: e.a.blast });
          this.endEntity(i, true);
        } else {
          const dest = this.farthestRoom(m.floor, m);
          const f = this.game.map.floors[m.floor];
          const tiles = findPath(f, worldToTile(m.x), worldToTile(m.z), worldToTile(dest.x), worldToTile(dest.z), 20000) ?? [];
          m.sweep(pathToWorld(tiles), e.a.carrySpeed, e.a.stagger);
          e.mode = 'carry';
          this.game.emitAll({ type: 'impact', id: e.id, ability: e.a.id, kind: 'dragon', floor: e.floor, x: r2(m.x), z: r2(m.z), hit: m.id, to: { x: r2(dest.x), z: r2(dest.z) } });
        }
      }
    }
  }

  endEntity(i, exploded = false) {
    const e = this.entities.splice(i, 1)[0];
    if (e.kind === 'tree' && e.barrier) removeBarrier(this.game.world, `tree${e.id}`);
    this.game.emitAll({ type: 'entity:end', id: e.id, kind: e.kind, exploded });
  }

  /** Live barricades, for clients joining mid-game. */
  activeBarriers() {
    return this.barriers.map((b) => ({ id: b.id, floor: b.floor, tiles: b.tiles, remaining: r2(b.until - this.t) }));
  }

  snapshotProjectiles() {
    return this.projectiles.map((p) => ({ id: p.id, k: p.kind, f: p.floor, x: r2(p.x), z: r2(p.z), vx: r2(p.vx), vz: r2(p.vz) }));
  }

  snapshotEntities() {
    return this.entities.map((e) => ({
      id: e.id, k: e.kind, f: e.floor, x: r2(e.x), z: r2(e.z), yaw: Math.round(e.yaw * 1000) / 1000,
      ...(e.kind === 'tree' ? { n: e.fruits } : { m: e.mode }),
    }));
  }
}
