// Visuals for the expanded grimoire (Step 4.5): 21 new normal spells, all 7
// Ultimates, snapshot-driven projectiles (crescents, spears, boulders, wind
// blades, swords of light) and entities (fire/wind dragons, the Tree of Life),
// player buff auras, the Amalgam's attacks and crowd-control visuals, and its
// phantoms. Builds on SpellFX's particles, light pool and helpers.

import * as THREE from 'three';
import { FLOOR_Y, TILE } from '/shared/constants.js';
import { ABILITY_BY_ID } from '/shared/wizards.js';
import { jaggedSpike, hexMaterial } from './SpellFX.js';

const H = 1.35; // wand height
const ease = (k) => 1 - (1 - k) ** 3;
const rand = (a, b) => a + Math.random() * (b - a);
const C = (hex) => new THREE.Color(hex);

const COLORS = {
  void: C(0x8a3cff), crimson: C(0xc0102a), ember: C(0xff6a10), spark: C(0xffc060), whiteHot: C(0xfff1c8),
  water: C(0x5ac8ff), foam: C(0xd8f6ff), leaf: C(0x7fd36a), gold: C(0xffd76a), silver: C(0xd8e0ea),
  wind: C(0x9ef0e0), dust: C(0x6a5a48), stone: C(0x7a6e60), black: C(0x1a0a22),
};

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Circular rune decal: rings + glyphs. */
function runeTexture(color) {
  return canvasTexture(256, 256, (ctx) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 6;
    for (const r of [118, 96]) { ctx.beginPath(); ctx.arc(128, 128, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i * 2 / 6) * Math.PI * 2;
      const x = 128 + Math.cos(a) * 92, y = 128 + Math.sin(a) * 92;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.font = '20px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyphs = 'ᛇᛉᛏᛒᛗᛚᛞᛟᚠᚢᚱᚷ';
    for (let i = 0; i < glyphs.length; i++) {
      const a = (i / glyphs.length) * Math.PI * 2;
      ctx.save();
      ctx.translate(128 + Math.cos(a) * 107, 128 + Math.sin(a) * 107);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(glyphs[i], 0, 0);
      ctx.restore();
    }
  });
}

/** Soft gradient strip (for burning lines, slashes, beams). */
function stripTexture(stops) {
  return canvasTexture(64, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    for (const [k, col] of stops) g.addColorStop(k, col);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export class GrimoireFX {
  /**
   * @param fx      SpellFX (particles, light pool, helpers)
   * @param hooks   { screen, shake, localId, avatarOf(id) }
   */
  constructor(fx, hooks) {
    this.fx = fx;
    this.scene = fx.scene;
    this.hooks = hooks;
    this.projectiles = new Map();
    this.entities = new Map();
    this.auras = new Map();
    this.statusFx = new Map();
    this.riptides = new Map();
    this.time = 0;
    this.runeCyan = runeTexture('rgba(120,220,255,1)');
    this.runeGray = runeTexture('rgba(210,215,225,1)');
    this.runeCrimson = runeTexture('rgba(230,30,50,1)');
    this.runeGold = runeTexture('rgba(255,215,110,1)');
    this.fireStrip = stripTexture([[0, 'rgba(255,80,0,0)'], [0.5, 'rgba(255,200,90,1)'], [1, 'rgba(255,80,0,0)']]);
    this.slashStrip = stripTexture([[0, 'rgba(255,0,20,0)'], [0.5, 'rgba(255,60,60,1)'], [1, 'rgba(255,0,20,0)']]);
    this.vineMat = new THREE.MeshStandardMaterial({ color: 0x1f3a14, roughness: 0.8, emissive: 0x0a1a04 });
    this.thornMat = new THREE.MeshStandardMaterial({ color: 0x2e2410, roughness: 0.7 });
    this.chainMat = new THREE.MeshStandardMaterial({ color: 0x14121a, metalness: 0.8, roughness: 0.35, emissive: 0x30000a });
    this.goldChainMat = new THREE.MeshStandardMaterial({ color: 0xffcf5a, metalness: 1, roughness: 0.25, emissive: 0x6a4a00, emissiveIntensity: 1.2 });
    this.linkGeo = new THREE.TorusGeometry(0.07, 0.018, 5, 10);
    this.floods = [];
  }

  get localId() { return this.hooks.localId; }

  y(floor, h = H) { return FLOOR_Y[floor] + h; }
  dirOf(ev) { return new THREE.Vector3(-Math.sin(ev.yaw), 0, -Math.cos(ev.yaw)); }
  near(ev, localPos, r) { return localPos && localPos.floor === ev.floor && Math.hypot(localPos.x - ev.x, localPos.z - ev.z) <= r; }

  // ======================================================================== casts

  onCast(ev, localPos) {
    const fn = this[`cast_${ev.ability}`];
    if (fn) fn.call(this, ev, ABILITY_BY_ID[ev.ability], localPos);
    if (ev.ult) this.ultFlourish(ev, localPos);
  }

  /** Every Ultimate: a column of the caster's element and a screen pulse. */
  ultFlourish(ev, localPos) {
    const col = { black: COLORS.void, fire: COLORS.ember, water: COLORS.water, earth: COLORS.leaf, wind: COLORS.wind, white: COLORS.gold, void: COLORS.crimson }[ABILITY_BY_ID[ev.ability].source];
    const y0 = FLOOR_Y[ev.floor];
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 8, 24, 1, true), this.fx.additive(col, 0.7));
    pillar.position.set(ev.x, y0 + 4, ev.z);
    this.scene.add(pillar);
    this.fx.timed(1.2, (k) => {
      pillar.scale.set(1 + k * 2, 1, 1 + k * 2);
      pillar.material.opacity = 0.7 * (1 - k);
      pillar.rotation.y += 0.1;
    }, () => this.fx.disposeObject(pillar));
    this.fx.glow.burst(160, ev.x, y0 + 1.2, ev.z, { speed: 7, up: 2, life: 1.4, color: col, colorVar: 0.06, drag: 1.8 });
    if (this.near(ev, localPos, 30)) this.hooks.shake(0.5);
  }

  // ---------------------------------------------------------------- Black
  cast_dimension_slash(ev) {
    this.flare(ev, COLORS.void, 0.6);
  }

  cast_black_hole(ev, a) {
    const z = ev.zone;
    const y0 = this.y(ev.floor, 1.4);
    const g = new THREE.Group();
    g.position.set(z.x, y0, z.z);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    const halo = this.fx.glowSprite(0x6a1cff, 0.9);
    halo.scale.setScalar(3);
    this.scene.remove(halo);
    g.add(core, halo);
    const disks = [0, 1].map((i) => {
      const d = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.9 + i * 0.6, 48, 1), this.fx.additive(i ? COLORS.crimson : COLORS.void, 0.55));
      d.rotation.x = -Math.PI / 2 + (i ? 0.35 : -0.2);
      g.add(d);
      return d;
    });
    this.scene.add(g);
    const light = this.fx.takeLight(`bh${ev.id}`, 0x7a2cff);
    if (light) { light.position.set(z.x, y0, z.z); light.distance = 10; }
    this.fx.timed(a.duration + 0.4, (k, dt, age) => {
      const life = Math.min(1, age / 0.25) * Math.min(1, (a.duration + 0.4 - age) / 0.4);
      g.scale.setScalar(0.2 + life * 0.8 + Math.sin(age * 20) * 0.03);
      disks.forEach((d, i) => { d.rotation.z += dt * (i ? -4 : 6); d.material.opacity = 0.55 * life; });
      if (light) light.intensity = 12 * life;
      for (let n = 0; n < 8; n++) {
        const ang = Math.random() * Math.PI * 2, r = rand(2, z.r);
        const px = z.x + Math.cos(ang) * r, pz = z.z + Math.sin(ang) * r;
        this.fx.glow.emit(px, y0 + rand(-1, 1), pz, (z.x - px) * 1.4, 0, (z.z - pz) * 1.4, 0.7, Math.random() < 0.5 ? COLORS.void : COLORS.crimson, 0, 0);
      }
    }, () => { this.fx.releaseLight(light); this.fx.disposeObject(g); });
  }

  cast_shadow_step(ev) {
    const y0 = FLOOR_Y[ev.floor];
    this.fx.dust.burst(60, ev.x, y0 + 1, ev.z, { speed: 2.5, up: 0.6, life: 1.6, color: C(0x0a0610), drag: 1.5 });
    this.fx.glow.burst(30, ev.x, y0 + 1, ev.z, { speed: 2, life: 0.8, color: COLORS.void, drag: 2 });
  }

  cast_abyssal_mind_fracture(ev) {
    this.flare(ev, COLORS.crimson, 1);
    // The chains + sigils live on the monster as a status effect (see monsterStatus).
  }

  // ---------------------------------------------------------------- Fire
  cast_calidus_brachium(ev, a) {
    const dir = this.dirOf(ev);
    const y0 = this.y(ev.floor, 1.25);
    for (let i = 0; i < a.hits; i++) {
      setTimeout(() => {
        const side = (i - 1) * 0.45;
        const fist = new THREE.Group();
        const knuckles = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd090 }));
        knuckles.scale.set(1, 0.8, 1.3);
        const flame = this.fx.glowSprite(0xff6a10, 1);
        this.scene.remove(flame);
        flame.scale.setScalar(1.6);
        fist.add(knuckles, flame);
        const from = new THREE.Vector3(ev.x + dir.x * 0.8 - dir.z * side, y0, ev.z + dir.z * 0.8 + dir.x * side);
        fist.position.copy(from);
        this.scene.add(fist);
        this.fx.timed(0.22, (k) => {
          fist.position.copy(from).addScaledVector(dir, ease(k) * a.range);
          for (let n = 0; n < 4; n++) this.fx.glow.emit(fist.position.x, fist.position.y, fist.position.z, rand(-1, 1), rand(0, 1.5), rand(-1, 1), 0.4, COLORS.ember, -1, 1);
        }, () => {
          this.explosion(ev.floor, fist.position.x, fist.position.z, 0.9, COLORS.ember);
          this.fx.disposeObject(fist);
        });
      }, i * a.interval * 1000);
    }
  }

  cast_sol_linea(ev, a) {
    const y0 = this.y(ev.floor, 1.3);
    const from = new THREE.Vector3(ev.x, y0, ev.z);
    const to = new THREE.Vector3(ev.to.x, y0, ev.to.z);
    const len = from.distanceTo(to);
    const mid = from.clone().lerp(to, 0.5);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len, 8, 1, true).rotateX(Math.PI / 2), this.fx.additive(0xfff8e0, 1));
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, len, 12, 1, true).rotateX(Math.PI / 2), this.fx.additive(0xff8a20, 0.6));
    for (const m of [core, outer]) { m.position.copy(mid); m.lookAt(to); this.scene.add(m); }
    const light = this.fx.takeLight(`sol${ev.id}`, 0xffb050);
    if (light) { light.position.copy(mid); light.distance = Math.max(10, len); }
    this.fx.timed(0.45, (k) => {
      core.material.opacity = 1 - k;
      outer.material.opacity = 0.6 * (1 - k);
      outer.scale.set(1 + k * 2, 1 + k * 2, 1);
      if (light) light.intensity = 90 * (1 - k);
    }, () => { this.fx.releaseLight(light); this.fx.disposeObject(core); this.fx.disposeObject(outer); });
    // Burning floor line.
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.9, len).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.fireStrip, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3 }));
    line.position.set(mid.x, FLOOR_Y[ev.floor] + 0.04, mid.z);
    line.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    this.scene.add(line);
    const dur = ev.duration ?? a.lineDuration;
    this.fx.timed(dur, (k, dt, age) => {
      line.material.opacity = (1 - k) * (0.7 + Math.sin(age * 17) * 0.15 + Math.random() * 0.15);
      if (Math.random() < 0.9) {
        const u = Math.random();
        this.fx.glow.emit(from.x + (to.x - from.x) * u + rand(-0.3, 0.3), FLOOR_Y[ev.floor] + 0.05, from.z + (to.z - from.z) * u + rand(-0.3, 0.3),
          0, rand(0.8, 2), 0, 0.7, Math.random() < 0.4 ? COLORS.spark : COLORS.ember, -0.5, 0.5);
      }
    }, () => this.fx.disposeObject(line));
  }

  cast_phoenix_aura(ev) {
    this.fx.glow.burst(120, ev.x, this.y(ev.floor, 1), ev.z, { speed: 4, up: 2, life: 1, color: COLORS.ember, colorVar: 0.06, drag: 2 });
  }

  // ---------------------------------------------------------------- Water
  cast_water_spear(ev) { this.flare(ev, COLORS.water, 0.6); }

  cast_sea_cradle(ev) {
    this.fx.glow.burst(80, ev.x, this.y(ev.floor, 1), ev.z, { speed: 3, life: 1, color: COLORS.water, drag: 2.5 });
  }

  cast_riptide_vortex(ev, a) {
    const z = ev.zone;
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(z.r * 2.4, z.r * 2.4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.runeCyan, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3 }));
    rune.position.set(z.x, FLOOR_Y[ev.floor] + 0.04, z.z);
    this.scene.add(rune);
    const state = { done: false, rune };
    this.riptides.set(ev.id, state);
    this.fx.timed(z.duration, (k, dt, age) => {
      rune.rotation.y += dt * 0.6;
      rune.material.opacity = state.done ? Math.max(0, rune.material.opacity - dt * 2) : 0.45 + Math.sin(age * 3) * 0.2;
      return !state.done;
    }, () => { this.riptides.delete(ev.id); this.fx.disposeObject(rune); });
  }

  /** Riptide sprung: a spinning geyser. */
  onZoneTrigger(ev) {
    const st = this.riptides.get(ev.castId);
    if (st) st.done = true;
    const y0 = FLOOR_Y[ev.floor];
    const g = new THREE.Group();
    g.position.set(ev.x, y0, ev.z);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a9ad8, emissive: 0x0a3a5a, transparent: true, opacity: 0.6, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.1, 4.2, 24, 6, true).translate(0, 2.1, 0), mat);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.6, 4.4, 16, 1, true).translate(0, 2.2, 0), this.fx.additive(COLORS.foam, 0.5));
    g.add(col, inner);
    this.scene.add(g);
    this.fx.timed(ev.duration, (k, dt, age) => {
      const grow = Math.min(1, age / 0.25) * Math.min(1, (ev.duration - age) / 0.35);
      g.scale.set(1, grow, 1);
      g.rotation.y += dt * 9;
      mat.opacity = 0.6 * grow;
      for (let n = 0; n < 6; n++) {
        const ang = Math.random() * Math.PI * 2;
        this.fx.glow.emit(ev.x + Math.cos(ang) * 0.8, y0 + 4 * grow, ev.z + Math.sin(ang) * 0.8, Math.cos(ang) * 3, rand(1, 3), Math.sin(ang) * 3, 0.9, COLORS.foam, 8, 0.3);
      }
    }, () => this.fx.disposeObject(g));
  }

  cast_abyssal_deluge() { /* the flood itself is environment state (snapshot `fl`) */ }

  // ---------------------------------------------------------------- Earth
  cast_devils_snare(ev, a) {
    const z = ev.zone;
    const y0 = FLOOR_Y[ev.floor];
    const g = new THREE.Group();
    g.position.set(z.x, y0, z.z);
    const vines = [];
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + rand(-0.2, 0.2);
      const r0 = rand(0.4, z.r);
      const pts = [];
      for (let s = 0; s <= 10; s++) {
        const u = s / 10;
        const a2 = ang + u * rand(2, 4);
        const rr = r0 * (1 - u * 0.6);
        pts.push(new THREE.Vector3(Math.cos(a2) * rr, u * rand(1.4, 2.4), Math.sin(a2) * rr));
      }
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, rand(0.035, 0.06), 5, false);
      const vine = new THREE.Mesh(geo, this.vineMat);
      vine.castShadow = true;
      for (let th = 0; th < 5; th++) {
        const p = pts[1 + Math.floor(Math.random() * 8)];
        const thorn = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 4), this.thornMat);
        thorn.position.copy(p);
        thorn.rotation.set(rand(-1.5, 1.5), 0, rand(-1.5, 1.5));
        vine.add(thorn);
      }
      g.add(vine);
      vines.push(vine);
    }
    this.scene.add(g);
    this.fx.dust.burst(40, z.x, y0 + 0.2, z.z, { speed: 2.5, up: 1, life: 1.2, color: COLORS.dust, drag: 2 });
    const dur = z.duration ?? a.zoneDuration;
    this.fx.timed(dur, (k, dt, age) => {
      const grow = Math.min(1, age / 0.4);
      const sink = Math.max(0, (age - (dur - 0.5)) / 0.5);
      vines.forEach((v, i) => {
        const count = v.geometry.index.count;
        v.geometry.setDrawRange(0, Math.floor((count * grow) / 3) * 3);
        v.rotation.y = Math.sin(age * 2 + i) * 0.08;
      });
      g.position.y = y0 - sink * 2.4;
    }, () => this.fx.disposeObject(g));
  }

  cast_granite_skin(ev) {
    this.fx.dust.burst(70, ev.x, this.y(ev.floor, 1), ev.z, { speed: 3, up: 1, life: 1.2, color: COLORS.stone, drag: 2 });
  }

  cast_golem_boulder(ev) { this.flare(ev, COLORS.stone, 0.4); }

  cast_yggdrasil() { /* grows as an entity (see Tree) */ }

  // ---------------------------------------------------------------- Wind
  cast_kamaitachi(ev) { this.flare(ev, COLORS.wind, 0.5); }

  cast_zephyr_tailwind(ev) {
    const y0 = FLOOR_Y[ev.floor];
    for (let n = 0; n < 90; n++) {
      const ang = Math.random() * Math.PI * 2, r = rand(0.5, 5);
      this.fx.glow.emit(ev.x + Math.cos(ang) * r, y0 + rand(0.3, 2.2), ev.z + Math.sin(ang) * r, -Math.sin(ang) * 6, 0.3, Math.cos(ang) * 6, 0.7, COLORS.wind, 0, 1);
    }
  }

  cast_vacuum_tempest(ev, a) {
    const z = ev.zone;
    const y0 = FLOOR_Y[ev.floor];
    const g = new THREE.Group();
    g.position.set(z.x, y0, z.z);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(z.r * 1.2, 0.2, 3.6, 28, 4, true).translate(0, 1.8, 0), this.fx.additive(COLORS.wind, 0.35));
    g.add(funnel);
    const rings = [0, 1, 2].map(() => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(z.r, 0.03, 4, 40), this.fx.additive(0xe8fffa, 0.8));
      r.rotation.x = Math.PI / 2;
      g.add(r);
      return r;
    });
    this.scene.add(g);
    const dur = z.duration ?? a.lift;
    this.fx.timed(dur, (k, dt, age) => {
      funnel.rotation.y += dt * 12;
      funnel.material.opacity = 0.35 * (1 - k);
      rings.forEach((r, i) => {
        const rk = ((age * 1.6 + i / 3) % 1);
        r.scale.setScalar(1 - rk * 0.9);
        r.position.y = 0.4 + rk * 2.4;
        r.material.opacity = 0.8 * (1 - rk) * (1 - k);
      });
      for (let n = 0; n < 6; n++) {
        const ang = Math.random() * Math.PI * 2, r = z.r * 1.4;
        const px = z.x + Math.cos(ang) * r, pz = z.z + Math.sin(ang) * r;
        this.fx.glow.emit(px, y0 + rand(0.2, 2.5), pz, (z.x - px) * 2.5, rand(0.5, 2), (z.z - pz) * 2.5, 0.45, COLORS.wind, 0, 0);
      }
    }, () => this.fx.disposeObject(g));
  }

  // ---------------------------------------------------------------- White
  cast_arrows_of_judgment(ev, a) {
    // Swords materialise above the caster; the projectiles take over as they fire.
    const dir = this.dirOf(ev);
    const y0 = this.y(ev.floor, 2.4);
    for (let i = 0; i < a.count; i++) {
      const side = (i - (a.count - 1) / 2) * 0.45;
      const sword = this.makeSword();
      sword.position.set(ev.x + dir.z * side, y0 + Math.abs(side) * -0.2, ev.z - dir.x * side);
      sword.rotation.y = ev.yaw;
      sword.scale.setScalar(0.01);
      this.scene.add(sword);
      this.fx.timed(0.35 + i * a.interval, (k, dt, age) => {
        sword.scale.setScalar(Math.min(1, age / 0.3));
        sword.position.y = y0 + Math.sin(age * 6 + i) * 0.05;
      }, () => this.fx.disposeObject(sword));
    }
    this.fx.glow.burst(40, ev.x, y0, ev.z, { speed: 2, life: 0.8, color: COLORS.gold, drag: 2 });
  }

  cast_patronus_beacon(ev, a) {
    const z = ev.zone;
    const y0 = FLOOR_Y[ev.floor];
    const g = new THREE.Group();
    g.position.set(z.x, y0, z.z);
    const spirit = this.makeStag();
    spirit.position.y = 0.2;
    g.add(spirit);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(z.r * 2, z.r * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.runeGold, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.4, polygonOffset: true, polygonOffsetFactor: -3 }));
    ring.position.y = 0.05;
    g.add(ring);
    this.scene.add(g);
    const light = this.fx.takeLight(`pat${ev.id}`, 0xfff0d0);
    if (light) { light.position.set(z.x, y0 + 2.2, z.z); light.distance = 14; }
    const dur = z.duration ?? a.duration;
    this.fx.timed(dur, (k, dt, age) => {
      const fade = Math.min(1, age / 0.5) * Math.min(1, (dur - age) / 0.8);
      spirit.position.y = 0.2 + Math.sin(age * 1.6) * 0.15;
      spirit.rotation.y += dt * 0.4;
      spirit.traverse((o) => { if (o.material?.opacity !== undefined && o.material.transparent) o.material.opacity = (o.userData.base ?? 0.5) * fade; });
      ring.rotation.y -= dt * 0.3;
      ring.material.opacity = 0.4 * fade;
      if (light) light.intensity = 30 * fade;
      if (Math.random() < 0.8) {
        const ang = Math.random() * Math.PI * 2, r = Math.random() * z.r;
        this.fx.glow.emit(z.x + Math.cos(ang) * r, y0 + 0.1, z.z + Math.sin(ang) * r, 0, rand(0.6, 1.4), 0, 1.4, Math.random() < 0.5 ? COLORS.gold : COLORS.silver, -0.2, 0.3);
      }
    }, () => { this.fx.releaseLight(light); this.fx.disposeObject(g); });
  }

  cast_flash_step(ev) {
    const y0 = FLOOR_Y[ev.floor];
    for (const pt of [ev.from, ev.to]) this.fx.glow.burst(70, pt.x, y0 + 1, pt.z, { speed: 3.5, up: 0.5, life: 0.9, color: COLORS.gold, colorVar: 0.04, drag: 2.5 });
    const ghost = this.fx.glowSprite(0xfff4c0, 1);
    ghost.position.set(ev.from.x, y0 + 1, ev.from.z);
    ghost.scale.set(1.4, 2.6, 1);
    const streak = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, Math.hypot(ev.to.x - ev.from.x, ev.to.z - ev.from.z), 6, 1, true).rotateX(Math.PI / 2), this.fx.additive(0xffe6a0, 0.9));
    streak.position.set((ev.from.x + ev.to.x) / 2, y0 + 1, (ev.from.z + ev.to.z) / 2);
    streak.lookAt(ev.to.x, y0 + 1, ev.to.z);
    this.scene.add(streak);
    this.fx.timed(0.8, (k) => {
      ghost.material.opacity = 1 - k;
      streak.material.opacity = 0.9 * (1 - k) ** 2;
    }, () => { this.fx.disposeObject(ghost); this.fx.disposeObject(streak); });
    if (ev.caster === this.localId) this.hooks.screen('white', 0.35);
  }

  cast_dawn_sacred_order() { /* environment (snapshot `dw`) + golden chains on the monster */ }

  // ---------------------------------------------------------------- Anti-magic
  cast_black_slash(ev, a) {
    const dir = this.dirOf(ev);
    const y0 = this.y(ev.floor, 1.1);
    const g = new THREE.Group();
    g.position.set(ev.x, y0, ev.z);
    g.rotation.y = ev.yaw;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 6, 40, Math.PI * 0.9).rotateZ(Math.PI * 0.05), new THREE.MeshBasicMaterial({ color: 0x050002, transparent: true }));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.22, 6, 40, Math.PI * 0.9).rotateZ(Math.PI * 0.05), this.fx.additive(COLORS.crimson, 0.8));
    for (const m of [arc, rim]) { m.rotation.x = Math.PI / 2; g.add(m); }
    this.scene.add(g);
    this.fx.timed(0.4, (k) => {
      const r = 0.5 + ease(k) * a.range * 0.6;
      g.scale.set(r, r, 1);
      g.position.set(ev.x + dir.x * ease(k) * 2, y0, ev.z + dir.z * ease(k) * 2);
      arc.material.opacity = 1 - k;
      rim.material.opacity = 0.8 * (1 - k);
    }, () => this.fx.disposeObject(g));
    for (let n = 0; n < 50; n++) {
      const s = Math.random() * a.range;
      this.fx.glow.emit(ev.x + dir.x * s + rand(-1, 1), y0 + rand(-0.5, 0.5), ev.z + dir.z * s + rand(-1, 1), dir.x * 4, 0, dir.z * 4, 0.5, COLORS.crimson, 0, 2);
    }
  }

  cast_null_zone(ev, a) {
    const z = ev.zone;
    const y0 = FLOOR_Y[ev.floor];
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(z.r * 2, z.r * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.runeGray, transparent: true, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -3 }));
    decal.position.set(z.x, y0 + 0.05, z.z);
    const dome = new THREE.Mesh(this.fx.domeGeo, hexMaterial());
    dome.position.set(z.x, y0, z.z);
    dome.scale.setScalar(z.r);
    dome.renderOrder = 5;
    this.scene.add(decal, dome);
    const dur = z.duration ?? a.duration;
    this.fx.timed(dur, (k, dt, age) => {
      const fade = Math.min(1, age / 0.4) * Math.min(1, (dur - age) / 0.5);
      decal.rotation.y += dt * 0.2;
      decal.material.opacity = 0.5 * fade;
      dome.material.uniforms.uAlpha.value = 0.35 * fade;
      dome.material.uniforms.uTime.value = age;
      if (Math.random() < 0.6) {
        const ang = Math.random() * Math.PI * 2, r = Math.random() * z.r;
        this.fx.dust.emit(z.x + Math.cos(ang) * r, y0 + 0.1, z.z + Math.sin(ang) * r, 0, rand(0.4, 1), 0, 2, C(0xb0b6c0), -0.2, 0);
      }
    }, () => { this.fx.disposeObject(decal); this.scene.remove(dome); dome.material.dispose(); });
    this.activeNullZones = (this.activeNullZones ?? []).concat([{ x: z.x, z: z.z, r: z.r, floor: ev.floor, until: performance.now() + dur * 1000 }]);
  }

  /** Is (x, z) inside an active Null Zone? (no flicker, no terror) */
  inNullZone(floor, x, z) {
    const now = performance.now();
    this.activeNullZones = (this.activeNullZones ?? []).filter((n) => n.until > now);
    return this.activeNullZones.some((n) => n.floor === floor && Math.hypot(n.x - x, n.z - z) <= n.r);
  }

  cast_bull_thrust(ev) {
    const y0 = FLOOR_Y[ev.floor];
    const len = Math.hypot(ev.to.x - ev.from.x, ev.to.z - ev.from.z);
    const trail = new THREE.Mesh(new THREE.PlaneGeometry(1.4, Math.max(0.1, len)).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.slashStrip, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    trail.position.set((ev.from.x + ev.to.x) / 2, y0 + 1, (ev.from.z + ev.to.z) / 2);
    trail.rotation.y = Math.atan2(ev.to.x - ev.from.x, ev.to.z - ev.from.z);
    this.scene.add(trail);
    this.fx.timed(0.5, (k) => { trail.material.opacity = 1 - k; }, () => this.fx.disposeObject(trail));
    this.fx.dust.burst(30, ev.to.x, y0 + 0.3, ev.to.z, { speed: 3, life: 1, color: C(0x1a0a0a), drag: 2 });
    if (ev.hit) this.explosion(ev.floor, ev.to.x, ev.to.z, 1.2, COLORS.crimson);
    if (ev.caster === this.localId) this.hooks.shake(0.4);
  }

  cast_devil_union() { /* wings come from the `union` buff on every wizard */ }

  // ======================================================================== shared bits

  /** A quick flash at the wand for projectile spells. */
  flare(ev, color, strength) {
    const dir = this.dirOf(ev);
    const y0 = this.y(ev.floor);
    this.fx.glow.burst(Math.round(30 * strength), ev.x + dir.x * 0.6, y0, ev.z + dir.z * 0.6, { speed: 2.5, life: 0.5, color, drag: 3 });
  }

  explosion(floor, x, z, scale, color) {
    const y0 = this.y(floor, 1.2);
    const s = this.fx.glowSprite(color, 1);
    s.position.set(x, y0, z);
    this.fx.timed(0.4, (k) => {
      s.scale.setScalar((0.6 + ease(k) * 2.4) * scale);
      s.material.opacity = (1 - k) ** 2;
    }, () => this.fx.disposeObject(s));
    this.fx.glow.burst(Math.round(60 * scale), x, y0, z, { speed: 5 * scale, up: 1, life: 0.8, color, colorVar: 0.06, gravity: 5, drag: 1.5 });
  }

  makeSword() {
    const g = new THREE.Group();
    const gold = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.9), gold);
    blade.position.z = -0.35;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4).rotateX(-Math.PI / 2), gold);
    tip.position.z = -0.88;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.05), new THREE.MeshBasicMaterial({ color: 0xffc040 }));
    guard.position.z = 0.1;
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xc89030 }));
    hilt.position.z = 0.23;
    const glow = this.fx.glowSprite(0xffd76a, 0.8);
    this.scene.remove(glow);
    glow.scale.set(0.8, 0.8, 1);
    glow.position.z = -0.3;
    g.add(blade, tip, guard, hilt, glow);
    return g;
  }

  /** An ethereal silver-gold stag (the Patronus). */
  makeStag() {
    const g = new THREE.Group();
    const mat = (o = 0.55) => {
      const m = new THREE.MeshBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
      return m;
    };
    const add = (geo, x, y, z, rx = 0, rz = 0, o) => {
      const m = new THREE.Mesh(geo, mat(o));
      m.position.set(x, y, z);
      m.rotation.set(rx, 0, rz);
      m.userData.base = m.material.opacity;
      g.add(m);
      return m;
    };
    const body = add(new THREE.SphereGeometry(0.42, 16, 12), 0, 1.25, 0);
    body.scale.set(0.75, 0.7, 1.5);
    add(new THREE.CylinderGeometry(0.12, 0.17, 0.7, 8), 0, 1.7, -0.55, -0.6);
    const head = add(new THREE.SphereGeometry(0.17, 12, 10), 0, 2.05, -0.82);
    head.scale.set(0.8, 0.9, 1.4);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.015, 0.025, 0.45 - i * 0.07, 5), s * (0.1 + i * 0.07), 2.35 + i * 0.12, -0.78 + i * 0.04, 0, s * (0.4 + i * 0.25), 0.7);
      for (const z of [-0.45, 0.45]) add(new THREE.CylinderGeometry(0.04, 0.05, 0.95, 6), s * 0.18, 0.55, z);
    }
    const glow = this.fx.glowSprite(0xfff2d0, 0.7);
    this.scene.remove(glow);
    glow.scale.setScalar(4);
    glow.position.y = 1.4;
    glow.userData.base = 0.7;
    g.add(glow);
    return g;
  }

  // ======================================================================== projectiles

  makeProjectile(p) {
    const g = new THREE.Group();
    let spin = null;
    switch (p.k) {
      case 'crescent': {
        const core = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 6, 40, Math.PI), new THREE.MeshBasicMaterial({ color: 0x050008 }));
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.15, 6, 40, Math.PI), this.fx.additive(COLORS.void, 0.7));
        for (const m of [core, rim]) { m.rotation.z = Math.PI / 2; g.add(m); }
        break;
      }
      case 'spear': {
        const shaft = new THREE.Mesh(new THREE.ConeGeometry(0.09, 1.6, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe8fbff }));
        g.add(shaft);
        const pts = [];
        for (let s = 0; s <= 30; s++) { const u = s / 30; pts.push(new THREE.Vector3(Math.cos(u * 18) * 0.16, Math.sin(u * 18) * 0.16, u * 1.8 - 0.4)); }
        const helix = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.025, 4), this.fx.additive(COLORS.water, 0.8));
        g.add(helix);
        spin = helix;
        break;
      }
      case 'boulder': {
        const geo = new THREE.IcosahedronGeometry(0.55, 1);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const k = 0.8 + Math.random() * 0.35;
          pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
        }
        geo.computeVertexNormals();
        const rock = new THREE.Mesh(geo, this.fx.stoneMat);
        rock.castShadow = true;
        g.add(rock);
        spin = rock;
        break;
      }
      case 'blade': {
        const arc = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 4, 30, Math.PI * 0.8), this.fx.additive(0xe8fffa, 0.95));
        arc.rotation.x = Math.PI / 2;
        g.add(arc);
        spin = arc;
        break;
      }
      case 'sword':
        g.add(this.makeSword());
        break;
      default:
        g.add(this.fx.glowSprite(0xffffff, 1));
    }
    this.scene.add(g);
    return { g, kind: p.k, spin, floor: p.f, pos: new THREE.Vector3(p.x, this.y(p.f, p.k === 'boulder' ? 1.1 : H), p.z), target: new THREE.Vector3(), vel: new THREE.Vector3(), seen: performance.now() };
  }

  syncProjectiles(list) {
    const now = performance.now();
    for (const p of list) {
      if (p.k === 'fireball') continue; // SpellFX simulates its own
      let v = this.projectiles.get(p.id);
      if (!v) {
        v = this.makeProjectile(p);
        this.projectiles.set(p.id, v);
      }
      v.target.set(p.x, v.pos.y, p.z);
      v.vel.set(p.vx, 0, p.vz);
      v.seen = now;
    }
  }

  onImpact(ev) {
    const v = this.projectiles.get(ev.id);
    if (v) {
      this.fx.disposeObject(v.g);
      this.projectiles.delete(ev.id);
    }
    const color = { crescent: COLORS.void, spear: COLORS.water, boulder: COLORS.stone, blade: COLORS.wind, sword: COLORS.gold }[ev.kind];
    if (ev.kind === 'dragon') return this.dragonImpact(ev);
    if (!color) return;
    this.explosion(ev.floor, ev.x, ev.z, ev.kind === 'boulder' ? 1.3 : 0.8, color);
    if (ev.kind === 'boulder') this.debris(ev);
  }

  debris(ev) {
    const y0 = FLOOR_Y[ev.floor];
    const chunks = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(jaggedSpike(rand(0.1, 0.22), rand(0.15, 0.35)), this.fx.stoneMat);
      const ang = Math.random() * Math.PI * 2, r = Math.random() * (ev.zone?.r ?? 3);
      m.position.set(ev.x + Math.cos(ang) * r, y0, ev.z + Math.sin(ang) * r);
      m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      this.scene.add(m);
      chunks.push(m);
    }
    this.fx.dust.burst(60, ev.x, y0 + 0.5, ev.z, { speed: 4, up: 1.5, life: 1.6, color: COLORS.dust, drag: 2, gravity: 1 });
    this.fx.timed(ev.zone?.duration ?? 5, (k) => {
      if (k > 0.85) for (const c of chunks) c.position.y -= 0.01;
    }, () => chunks.forEach((c) => this.fx.disposeObject(c)));
  }

  // ======================================================================== entities

  syncEntities(list) {
    const seen = new Set();
    for (const e of list) {
      seen.add(e.id);
      let v = this.entities.get(e.id);
      if (!v) {
        v = e.k === 'tree' ? new Tree(this, e) : new Dragon(this, e);
        this.entities.set(e.id, v);
      }
      v.sync(e);
    }
    for (const [id, v] of this.entities) {
      if (!seen.has(id) && !v.ending) v.end(false);
    }
  }

  onEntityEnd(ev) {
    this.entities.get(ev.id)?.end(ev.exploded);
  }

  onTreeEat(ev) {
    this.entities.get(ev.id)?.eat(ev.fruits);
  }

  dragonImpact(ev) {
    const y0 = this.y(ev.floor, 1.5);
    if (ev.ability === 'fiendfyre_dragon') {
      const s = this.fx.glowSprite(0xff7a20, 1);
      s.position.set(ev.x, y0, ev.z);
      const light = this.fx.takeLight(`boom${ev.id}`, 0xff6a20);
      if (light) { light.position.set(ev.x, y0, ev.z); light.distance = 18; }
      this.fx.timed(0.9, (k) => {
        s.scale.setScalar(1 + ease(k) * (ev.blast ?? 4) * 2.5);
        s.material.opacity = (1 - k) ** 1.5;
        if (light) light.intensity = 200 * (1 - k);
      }, () => { this.fx.releaseLight(light); this.fx.disposeObject(s); });
      this.fx.glow.burst(260, ev.x, y0, ev.z, { speed: 10, up: 2, life: 1.4, color: COLORS.ember, colorVar: 0.08, gravity: 5, drag: 1.2 });
      this.fx.dust.burst(60, ev.x, y0, ev.z, { speed: 3, up: 1, life: 2, color: C(0x1a1410), drag: 1.5 });
      this.fx.fireExplosion({ floor: ev.floor, x: ev.x, z: ev.z, id: `d${ev.id}`, scorch: 6 });
      this.hooks.shake(0.9);
    } else {
      this.fx.glow.burst(180, ev.x, y0, ev.z, { speed: 8, up: 3, life: 1.2, color: COLORS.wind, colorVar: 0.05, drag: 1.5 });
      this.hooks.shake(0.6);
    }
  }

  // ======================================================================== buffs on wizards

  /**
   * Called every frame for every wizard. `codes` are active buff names.
   * Auras: Shadow smoke, Phoenix embers (+ light), Cradle water sphere,
   * Granite plates, Tailwind streaks, Devil Union wings.
   */
  aura(id, codes, x, y, z, isSelf, dt) {
    let a = this.auras.get(id);
    const want = codes.length > 0;
    if (!a && !want) return;
    if (!a) {
      a = { group: new THREE.Group(), parts: {} };
      this.scene.add(a.group);
      this.auras.set(id, a);
    }
    a.group.position.set(x, y, z);
    const has = (c) => codes.includes(c);
    const t = this.time;

    // Water sphere
    if (has('cradle') && !a.parts.cradle) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.05, 28, 18), new THREE.MeshStandardMaterial({
        color: 0x3aa8e8, emissive: 0x0a3a5a, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.3, side: THREE.DoubleSide, depthWrite: false,
      }));
      m.position.y = 1;
      a.group.add(m);
      a.parts.cradle = m;
    }
    if (a.parts.cradle) {
      a.parts.cradle.visible = has('cradle');
      a.parts.cradle.scale.set(1 + Math.sin(t * 3) * 0.03, 1 + Math.sin(t * 2.3) * 0.04, 1 + Math.cos(t * 3.1) * 0.03);
      a.parts.cradle.material.opacity = isSelf ? 0.1 : 0.28;
    }
    // Granite plates
    if (has('granite') && !a.parts.granite) {
      const plates = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const ang = (i / 9) * Math.PI * 2;
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.06), this.fx.stoneMat);
        plate.position.set(Math.cos(ang) * 0.48, 0.5 + (i % 3) * 0.45, Math.sin(ang) * 0.48);
        plate.lookAt(0, plate.position.y, 0);
        plates.add(plate);
      }
      a.group.add(plates);
      a.parts.granite = plates;
    }
    if (a.parts.granite) a.parts.granite.visible = has('granite') && !isSelf;
    // Devil Union wings
    if (has('union') && !a.parts.wings) {
      a.parts.wings = this.makeWings();
      a.group.add(a.parts.wings);
    }
    if (a.parts.wings) {
      a.parts.wings.visible = has('union') && !isSelf;
      const flap = Math.sin(t * 3) * 0.25;
      a.parts.wings.children.forEach((w, i) => { w.rotation.y = (i ? -1 : 1) * (0.5 + flap); });
      const av = this.hooks.avatarOf(id);
      if (av) a.parts.wings.rotation.y = av.yaw;
    }
    // Phoenix light
    if (has('phoenix')) {
      a.light ??= this.fx.takeLight(`phx${id}`, 0xff8a30);
      if (a.light) {
        a.light.position.set(x, y + 1.2, z);
        a.light.distance = 12;
        a.light.intensity = 28 + Math.sin(t * 23) * 5;
      }
    } else if (a.light) {
      this.fx.releaseLight(a.light);
      a.light = null;
    }

    // Particles
    if (has('phoenix')) {
      for (let n = 0; n < 4; n++) {
        const ang = t * 6 + n * 1.6;
        this.fx.glow.emit(x + Math.cos(ang) * 0.6, y + rand(0.1, 1.8), z + Math.sin(ang) * 0.6, -Math.sin(ang) * 1.5, rand(0.5, 1.5), Math.cos(ang) * 1.5, 0.6, Math.random() < 0.3 ? COLORS.spark : COLORS.ember, -1, 1);
      }
    }
    if (has('shadow') && !isSelf) {
      for (let n = 0; n < 3; n++) this.fx.dust.emit(x + rand(-0.4, 0.4), y + rand(0.2, 1.8), z + rand(-0.4, 0.4), rand(-0.3, 0.3), 0.4, rand(-0.3, 0.3), 1, C(0x050208), 0, 0.5);
    }
    if (has('tailwind') && Math.random() < 0.6) {
      const ang = Math.random() * Math.PI * 2;
      this.fx.glow.emit(x + Math.cos(ang) * 0.7, y + rand(0.2, 1.6), z + Math.sin(ang) * 0.7, -Math.sin(ang) * 4, 0, Math.cos(ang) * 4, 0.35, COLORS.wind, 0, 1);
    }
    if (has('union') && Math.random() < 0.8) {
      this.fx.glow.emit(x + rand(-0.5, 0.5), y + rand(0.5, 2.2), z + rand(-0.5, 0.5), 0, rand(0.3, 0.9), 0, 0.8, Math.random() < 0.6 ? COLORS.crimson : C(0x200008), 0, 1);
    }

    if (!want) {
      this.scene.remove(a.group);
      a.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      if (a.light) this.fx.releaseLight(a.light);
      this.auras.delete(id);
    }
  }

  makeWings() {
    const wings = new THREE.Group();
    wings.position.set(0, 1.5, 0.25);
    const black = new THREE.MeshBasicMaterial({ color: 0x050204, side: THREE.DoubleSide });
    const edge = new THREE.MeshBasicMaterial({ color: 0xa0081c, side: THREE.DoubleSide, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    for (const s of [-1, 1]) {
      const wing = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const len = 1.4 - Math.abs(i - 2) * 0.12;
        const feather = new THREE.Mesh(new THREE.PlaneGeometry(0.18, len).translate(0, len / 2, 0), black);
        feather.position.set(s * (0.15 + i * 0.16), -i * 0.05, 0);
        feather.rotation.z = s * (-0.9 + i * 0.28);
        const rim = new THREE.Mesh(new THREE.PlaneGeometry(0.05, len).translate(0, len / 2, 0.01), edge);
        rim.position.copy(feather.position);
        rim.rotation.copy(feather.rotation);
        rim.position.x += s * 0.08;
        wing.add(feather, rim);
      }
      wings.add(wing);
    }
    return wings;
  }

  // ======================================================================== the Amalgam

  /** Visuals for its attacks (windups and strikes). */
  monsterAttack(ev, avatar, targetPos) {
    const y0 = FLOOR_Y[ev.floor];
    if (ev.stage === 'windup') {
      if (ev.kind === 'shockwave' || ev.kind === 'lunge') {
        this.fx.glow.burst(30, ev.x, y0 + 2, ev.z, { speed: 1.5, life: ev.windup ?? 0.6, color: COLORS.crimson, drag: 3 });
      }
      return;
    }
    switch (ev.kind) {
      case 'claw': {
        if (!ev.hit || !targetPos) return;
        for (let i = 0; i < 3; i++) {
          const slash = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.5),
            new THREE.MeshBasicMaterial({ map: this.slashStrip, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
          slash.position.set(targetPos.x + (i - 1) * 0.18, y0 + 1.4, targetPos.z);
          slash.rotation.set(0, Math.atan2(targetPos.x - ev.x, targetPos.z - ev.z), 0.7);
          this.scene.add(slash);
          this.fx.timed(0.35, (k) => { slash.material.opacity = 1 - k; slash.scale.y = 0.3 + k; }, () => this.fx.disposeObject(slash));
        }
        break;
      }
      case 'shockwave': {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), this.fx.additive(COLORS.crimson, 0.9));
        const dark = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }));
        for (const m of [ring, dark]) { m.position.set(ev.x, y0 + 0.06, ev.z); this.scene.add(m); }
        this.fx.timed(0.5, (k) => {
          const r = 0.5 + ease(k) * (ev.r ?? 3.5);
          ring.scale.setScalar(r);
          dark.scale.setScalar(r * 0.95);
          ring.material.opacity = 0.9 * (1 - k);
          dark.material.opacity = 0.6 * (1 - k);
        }, () => { this.fx.disposeObject(ring); this.fx.disposeObject(dark); });
        this.fx.dust.burst(70, ev.x, y0 + 0.2, ev.z, { speed: 6, up: 0.5, life: 1.2, color: C(0x140808), drag: 2 });
        this.hooks.shake(0.5);
        break;
      }
      case 'tendril': {
        const from = new THREE.Vector3(ev.x, y0 + 2.2, ev.z);
        const to = new THREE.Vector3(ev.tx, y0 + 1.2, ev.tz);
        const pts = [];
        for (let s = 0; s <= 12; s++) {
          const u = s / 12;
          const p = from.clone().lerp(to, u);
          p.y += Math.sin(u * Math.PI) * 0.8;
          p.x += Math.sin(u * 9) * 0.15 * (1 - u);
          pts.push(p);
        }
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.07, 6), new THREE.MeshStandardMaterial({ color: 0x060306, emissive: 0x3a0008, roughness: 0.4 }));
        this.scene.add(tube);
        const count = tube.geometry.index.count;
        this.fx.timed(0.5, (k) => {
          const reach = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
          tube.geometry.setDrawRange(0, Math.floor((count * reach) / 3) * 3);
        }, () => this.fx.disposeObject(tube));
        if (ev.hit) this.fx.glow.burst(30, to.x, to.y, to.z, { speed: 3, life: 0.6, color: COLORS.crimson, drag: 2 });
        break;
      }
      case 'smash':
        this.fx.dust.burst(50, ev.x, y0 + 0.5, ev.z, { speed: 4, up: 2, life: 1.4, color: COLORS.dust, drag: 2, gravity: 2 });
        this.hooks.shake(0.35);
        break;
    }
  }

  /**
   * Crowd-control visuals attached to a monster avatar: black chains + crimson
   * sigils (mind fracture), golden chains (Dawn), briars (root), a water spear
   * (pinned).
   */
  monsterStatus(av, codes) {
    let s = this.statusFx.get(av.id);
    if (!s) {
      s = { parts: {} };
      this.statusFx.set(av.id, s);
    }
    const want = {
      confused: codes.includes('confused'),
      frozen: codes.includes('frozen'),
      root: codes.includes('root'),
      pinned: codes.includes('pinned'),
    };
    const make = {
      confused: () => this.makeChains(this.chainMat, 4, 3.6, this.runeCrimson),
      frozen: () => this.makeChainCoil(),
      root: () => this.makeRootVines(),
      pinned: () => {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 2.2, 8), this.fx.additive(COLORS.water, 0.8));
        sp.position.set(0.15, 1.3, 0);
        sp.rotation.z = 0.5;
        return sp;
      },
    };
    for (const [k, on] of Object.entries(want)) {
      if (on && !s.parts[k]) {
        s.parts[k] = make[k]();
        av.group.add(s.parts[k]);
      }
      if (s.parts[k]) s.parts[k].visible = on;
    }
    const t = this.time;
    if (s.parts.confused?.visible) {
      s.parts.confused.userData.sigil.rotation.z += 0.05;
      s.parts.confused.userData.sigil.material.opacity = 0.6 + Math.sin(t * 8) * 0.3;
    }
    if (s.parts.frozen?.visible) s.parts.frozen.rotation.y += 0.01;
  }

  /** Chains from the floor around it, converging on its head, plus a sigil halo. */
  makeChains(mat, count, headY, sigilTex) {
    const g = new THREE.Group();
    for (let c = 0; c < count; c++) {
      const ang = (c / count) * Math.PI * 2 + 0.4;
      const from = new THREE.Vector3(Math.cos(ang) * 3, 0, Math.sin(ang) * 3);
      const to = new THREE.Vector3(Math.cos(ang) * 0.2, headY - 0.3, Math.sin(ang) * 0.2);
      const n = 22;
      const links = new THREE.InstancedMesh(this.linkGeo, mat, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      const dir = to.clone().sub(from).normalize();
      const baseQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      for (let i = 0; i < n; i++) {
        const p = from.clone().lerp(to, i / (n - 1));
        p.y -= Math.sin((i / (n - 1)) * Math.PI) * 0.4;
        q.copy(baseQ).multiply(new THREE.Quaternion().setFromEuler(e.set(0, 0, i % 2 ? Math.PI / 2 : 0)));
        m4.compose(p, q, new THREE.Vector3(1, 1, 1));
        links.setMatrixAt(i, m4);
      }
      g.add(links);
    }
    const sigil = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: sigilTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    sigil.position.y = headY;
    sigil.rotation.x = -Math.PI / 2;
    g.add(sigil);
    g.userData.sigil = sigil;
    return g;
  }

  /** Golden chains spiralling around its body. */
  makeChainCoil() {
    const g = new THREE.Group();
    const n = 90;
    const links = new THREE.InstancedMesh(this.linkGeo, this.goldChainMat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < n; i++) {
      const u = i / n, ang = u * Math.PI * 10;
      const r = 0.45 - Math.abs(u - 0.5) * 0.2;
      m4.compose(new THREE.Vector3(Math.cos(ang) * r, 0.3 + u * 2.9, Math.sin(ang) * r),
        q.setFromEuler(e.set(0, -ang, i % 2 ? Math.PI / 2 : 0)), new THREE.Vector3(1.4, 1.4, 1.4));
      links.setMatrixAt(i, m4);
    }
    g.add(links);
    const glow = this.fx.glowSprite(0xffd76a, 0.6);
    this.scene.remove(glow);
    glow.scale.set(2.5, 4, 1);
    glow.position.y = 1.8;
    g.add(glow);
    return g;
  }

  makeRootVines() {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const pts = [];
      const a0 = (i / 6) * Math.PI * 2;
      for (let s = 0; s <= 16; s++) {
        const u = s / 16, ang = a0 + u * 8;
        pts.push(new THREE.Vector3(Math.cos(ang) * (0.3 + (1 - u) * 0.5), u * 1.4, Math.sin(ang) * (0.3 + (1 - u) * 0.5)));
      }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.045, 5), this.vineMat));
    }
    return g;
  }

  /** Phantom Amalgams at the edge of sight (4+ Hearts). */
  phantoms(ev, makeGhost) {
    for (const spot of ev.spots) {
      const ghost = makeGhost(spot, ev.floor);
      this.fx.timed(ev.life, (k, dt, age) => {
        const fade = Math.min(1, age / 0.6) * Math.min(1, (ev.life - age) / 0.8);
        ghost.setOpacity(fade * 0.75);
        ghost.update(dt, this.time);
      }, () => ghost.dispose());
    }
  }

  // ======================================================================== flood

  /** Show/hide the Abyssal Deluge water planes. */
  setFlood(active, map) {
    if (active && !this.floods.length) {
      for (const f of map.floors) {
        const w = f.w * TILE, h = f.h * TILE;
        const geo = new THREE.PlaneGeometry(w, h, 90, 90).rotateX(-Math.PI / 2);
        const mat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: { uTime: { value: 0 }, uLevel: { value: 0 } },
          vertexShader: /* glsl */`
            uniform float uTime; uniform float uLevel;
            varying vec3 vWorld; varying float vWave;
            void main() {
              vec3 p = position;
              float w = sin(p.x * 0.6 + uTime * 1.7) * 0.06 + sin(p.z * 0.45 - uTime * 1.3) * 0.07 + sin((p.x + p.z) * 1.3 + uTime * 2.4) * 0.025;
              p.y += w * uLevel;
              vWave = w;
              vec4 wp = modelMatrix * vec4(p, 1.0);
              vWorld = wp.xyz;
              gl_Position = projectionMatrix * viewMatrix * wp;
            }`,
          fragmentShader: /* glsl */`
            uniform float uTime; uniform float uLevel;
            varying vec3 vWorld; varying float vWave;
            void main() {
              float ripple = sin(vWorld.x * 3.0 + uTime * 2.0) * sin(vWorld.z * 3.3 - uTime * 1.6);
              vec3 deep = vec3(0.01, 0.07, 0.11);
              vec3 crest = vec3(0.35, 0.7, 0.85);
              vec3 col = mix(deep, crest, clamp(vWave * 5.0 + ripple * 0.12 + 0.15, 0.0, 1.0));
              float foam = smoothstep(0.09, 0.13, vWave + ripple * 0.02);
              col = mix(col, vec3(0.9, 0.97, 1.0), foam * 0.6);
              gl_FragColor = vec4(col, 0.62 * uLevel);
            }`,
        });
        const plane = new THREE.Mesh(geo, mat);
        plane.position.set(w / 2, f.y + 0.45, h / 2);
        plane.renderOrder = 3;
        this.scene.add(plane);
        this.floods.push(plane);
      }
    }
    this.floodTarget = active ? 1 : 0;
  }

  // ======================================================================== per frame

  update(dt, t, activeFloor, localPos) {
    this.time = t;
    const now = performance.now();
    for (const [id, v] of this.projectiles) {
      v.target.addScaledVector(v.vel, dt);
      v.pos.addScaledVector(v.vel, dt).lerp(v.target, 1 - Math.exp(-dt * 12));
      v.g.position.copy(v.pos);
      v.g.visible = v.floor === activeFloor;
      if (v.vel.lengthSq() > 0.01) v.g.rotation.y = Math.atan2(-v.vel.x, -v.vel.z);
      if (v.spin) {
        if (v.kind === 'boulder') v.spin.rotation.x -= dt * 8;
        else if (v.kind === 'blade') v.spin.rotation.z += dt * 25;
        else v.spin.rotation.z += dt * 12;
      }
      const col = { crescent: COLORS.void, spear: COLORS.water, boulder: COLORS.dust, blade: COLORS.wind, sword: COLORS.gold }[v.kind];
      if (col) this.fx.glow.emit(v.pos.x + rand(-0.1, 0.1), v.pos.y + rand(-0.1, 0.1), v.pos.z + rand(-0.1, 0.1), 0, 0, 0, 0.35, col, 0, 0);
      if (now - v.seen > 400) { // never got an impact event
        this.fx.disposeObject(v.g);
        this.projectiles.delete(id);
      }
    }
    for (const [id, v] of this.entities) {
      if (v.update(dt, t, activeFloor) === false) this.entities.delete(id);
    }
    // Flood level eases in/out.
    if (this.floods.length) {
      for (const p of this.floods) {
        const u = p.material.uniforms;
        u.uLevel.value += ((this.floodTarget ?? 0) - u.uLevel.value) * Math.min(1, dt * 1.5);
        u.uTime.value = t;
      }
      if ((this.floodTarget ?? 0) === 0 && this.floods[0].material.uniforms.uLevel.value < 0.01) {
        for (const p of this.floods) { this.scene.remove(p); p.geometry.dispose(); p.material.dispose(); }
        this.floods = [];
      } else if (localPos && this.floodTarget && Math.random() < 0.4) {
        // foam around your legs
        const ang = Math.random() * Math.PI * 2;
        this.fx.glow.emit(localPos.x + Math.cos(ang) * 1.2, FLOOR_Y[localPos.floor] + 0.5, localPos.z + Math.sin(ang) * 1.2, 0, 0.2, 0, 0.8, COLORS.foam, 0, 1);
      }
    }
  }
}

// ==========================================================================
// Entities

class Dragon {
  constructor(gfx, e) {
    this.gfx = gfx;
    this.fx = gfx.fx;
    this.kind = e.k;
    this.fire = e.k === 'fire_dragon';
    this.floor = e.f;
    this.pos = new THREE.Vector3(e.x, FLOOR_Y[e.f] + 1.8, e.z);
    this.target = this.pos.clone();
    this.trail = [];
    this.ending = false;
    this.endAge = 0;
    this.age = 0;
    const scene = gfx.scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    // Head
    this.head = new THREE.Group();
    const skin = this.fire
      ? new THREE.MeshBasicMaterial({ color: 0xffb060 })
      : new THREE.MeshBasicMaterial({ color: 0xd8fff4, transparent: true, opacity: 0.8 });
    const upper = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.5, 8).rotateX(-Math.PI / 2), skin);
    upper.position.set(0, 0.12, -0.5);
    upper.scale.y = 0.6;
    this.jaw = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.2, 8).rotateX(-Math.PI / 2), skin);
    this.jaw.position.set(0, -0.15, -0.4);
    this.jaw.scale.y = 0.5;
    this.head.add(upper, this.jaw);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.8, 6), skin);
      horn.position.set(s * 0.25, 0.45, 0.1);
      horn.rotation.set(0.9, 0, s * 0.3);
      const eye = this.fx.glowSprite(this.fire ? 0xfff2a0 : 0x7affc8, 1);
      scene.remove(eye);
      eye.scale.setScalar(0.35);
      eye.position.set(s * 0.22, 0.25, -0.55);
      this.head.add(horn, eye);
    }
    const headGlow = this.fx.glowSprite(this.fire ? 0xff6a10 : 0x9ef0e0, 0.9);
    scene.remove(headGlow);
    headGlow.scale.setScalar(3.4);
    this.head.add(headGlow);
    this.group.add(this.head);

    // Body segments
    this.segments = [];
    const N = this.fire ? 30 : 34;
    for (let i = 0; i < N; i++) {
      const k = 1 - i / N;
      let seg;
      if (this.fire) {
        seg = this.fx.glowSprite(i % 3 ? 0xff5a10 : 0xffa040, 0.95);
        scene.remove(seg);
        seg.scale.setScalar(1.6 * k + 0.3);
      } else {
        seg = new THREE.Mesh(new THREE.TorusGeometry(0.55 * k + 0.15, 0.05, 4, 24), this.fx.additive(i % 2 ? 0xe8fffa : 0x50e0a8, 0.55));
      }
      this.group.add(seg);
      this.segments.push(seg);
    }
    // Wings (fire)
    this.wings = [];
    if (this.fire) {
      for (const s of [-1, 1]) {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.quadraticCurveTo(s * 1.2, 1.1, s * 2.8, 0.6);
        shape.quadraticCurveTo(s * 1.8, 0.1, s * 2.4, -0.4);
        shape.quadraticCurveTo(s * 1.2, -0.1, 0, 0);
        const wing = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
        wing.rotation.x = -Math.PI / 2;
        this.group.add(wing);
        this.wings.push({ mesh: wing, s });
      }
    }
    this.light = this.fx.takeLight(`dragon${e.id}`, this.fire ? 0xff7020 : 0x9ef0e0);
  }

  sync(e) {
    this.target.set(e.x, FLOOR_Y[e.f] + 1.8, e.z);
    this.floor = e.f;
    this.yaw = e.yaw;
    this.carry = e.m === 'carry';
  }

  end(exploded) {
    this.ending = true;
    this.exploded = exploded;
  }

  update(dt, t, activeFloor) {
    this.age += dt;
    const k = 1 - Math.exp(-dt * 10);
    this.pos.lerp(this.target, k);
    const bob = Math.sin(t * 3) * 0.35 + (this.carry ? 1.2 : 0);
    const headPos = this.pos.clone();
    headPos.y += bob;
    this.head.position.copy(headPos);
    this.head.rotation.y = this.yaw ?? 0;
    this.jaw.rotation.x = 0.15 + Math.abs(Math.sin(t * 6)) * 0.35;
    if (!this.trail.length || this.trail[0].distanceTo(headPos) > 0.18) {
      this.trail.unshift(headPos.clone());
      if (this.trail.length > 400) this.trail.length = 400;
    }
    const spacing = this.fire ? 2 : 2;
    this.segments.forEach((seg, i) => {
      const p = this.trail[Math.min(this.trail.length - 1, (i + 1) * spacing)] ?? headPos;
      seg.position.copy(p);
      seg.position.y += Math.sin(t * 5 - i * 0.4) * 0.12;
      if (!this.fire) {
        const next = this.trail[Math.min(this.trail.length - 1, (i + 1) * spacing + 1)] ?? p;
        seg.lookAt(next);
        seg.rotation.z += t * 8 + i;
      }
    });
    for (const w of this.wings) {
      const anchor = this.segments[4]?.position ?? headPos;
      w.mesh.position.copy(anchor);
      w.mesh.rotation.set(-Math.PI / 2 + Math.sin(t * 7) * 0.5 * w.s, 0, (this.yaw ?? 0));
    }
    // Particles along the body
    for (let n = 0; n < 6; n++) {
      const seg = this.segments[Math.floor(Math.random() * this.segments.length)];
      if (this.fire) this.fx.glow.emit(seg.position.x + rand(-0.3, 0.3), seg.position.y + rand(-0.3, 0.3), seg.position.z + rand(-0.3, 0.3), rand(-0.5, 0.5), rand(0.2, 1.4), rand(-0.5, 0.5), 0.7, Math.random() < 0.3 ? COLORS.spark : COLORS.ember, -1, 1);
      else this.fx.glow.emit(seg.position.x, seg.position.y, seg.position.z, rand(-3, 3), rand(-1, 1), rand(-3, 3), 0.5, Math.random() < 0.5 ? COLORS.wind : COLORS.silver, 0, 2);
    }
    if (this.light) {
      this.light.position.copy(headPos);
      this.light.distance = 16;
      this.light.intensity = this.ending ? 0 : (this.fire ? 60 : 25) + Math.sin(t * 21) * 8;
    }
    this.group.visible = this.floor === activeFloor;
    if (this.ending) {
      this.endAge += dt;
      const fade = 1 - this.endAge / 0.6;
      this.segments.forEach((s) => { s.material.opacity = Math.max(0, fade) * 0.9; });
      if (this.endAge > 0.6) {
        this.dispose();
        return false;
      }
    }
    return true;
  }

  dispose() {
    this.fx.releaseLight(this.light);
    this.fx.disposeObject(this.group);
  }
}

class Tree {
  constructor(gfx, e) {
    this.gfx = gfx;
    this.fx = gfx.fx;
    this.floor = e.f;
    this.age = 0;
    this.ending = false;
    this.endAge = 0;
    const scene = gfx.scene;
    this.group = new THREE.Group();
    this.group.position.set(e.x, FLOOR_Y[e.f], e.z);
    scene.add(this.group);

    const bark = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.9, emissive: 0x0e3a18, emissiveIntensity: 0.6 });
    const profile = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      profile.push(new THREE.Vector2(0.55 * (1 - u * 0.7) + Math.sin(u * 9) * 0.04 + (i === 0 ? 0.25 : 0), u * 3.2));
    }
    this.trunk = new THREE.Mesh(new THREE.LatheGeometry(profile, 14), bark);
    this.trunk.castShadow = true;
    this.group.add(this.trunk);
    const branchPts = [];
    for (let b = 0; b < 7; b++) {
      const ang = (b / 7) * Math.PI * 2 + rand(-0.2, 0.2);
      const y = rand(1.9, 3);
      const pts = [new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.cos(ang) * 0.8, y + 0.5, Math.sin(ang) * 0.8), new THREE.Vector3(Math.cos(ang) * 1.6, y + rand(0.6, 1.1), Math.sin(ang) * 1.6)];
      const branch = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.08, 6), bark);
      this.group.add(branch);
      branchPts.push(pts[2]);
    }
    // Roots across the floorboards
    for (let r = 0; r < 8; r++) {
      const ang = (r / 8) * Math.PI * 2;
      const pts = [];
      for (let s = 0; s <= 6; s++) {
        const u = s / 6;
        pts.push(new THREE.Vector3(Math.cos(ang + u * 0.4) * (0.4 + u * 2.4), 0.06 + Math.sin(u * Math.PI) * 0.12, Math.sin(ang + u * 0.4) * (0.4 + u * 2.4)));
      }
      this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.07 * (1 - r * 0.03), 5), bark));
    }
    // Bioluminescent canopy (it grows through the ceiling's shadow).
    this.canopy = [];
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2a8a50, emissive: 0x3aff9a, emissiveIntensity: 0.55, roughness: 0.6, transparent: true, opacity: 0.92, flatShading: true });
    for (let c = 0; c < 7; c++) {
      const ang = (c / 7) * Math.PI * 2;
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.6, 0.9), 1), leafMat);
      blob.position.set(Math.cos(ang) * 1.1, 3.2 + rand(-0.2, 0.3), Math.sin(ang) * 1.1);
      this.group.add(blob);
      this.canopy.push(blob);
    }
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 1), leafMat);
    crown.position.y = 3.5;
    this.group.add(crown);
    this.canopy.push(crown);
    // Golden fruit
    this.fruits = [];
    const total = Math.max(1, e.n ?? 1);
    for (let i = 0; i < total; i++) {
      const anchor = branchPts[i % branchPts.length];
      const fruit = new THREE.Group();
      fruit.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffd860 })));
      const glow = this.fx.glowSprite(0xffcf40, 0.9);
      scene.remove(glow);
      glow.scale.setScalar(0.9);
      fruit.add(glow);
      fruit.position.set(anchor.x, anchor.y - 0.35, anchor.z);
      this.group.add(fruit);
      this.fruits.push(fruit);
    }
    this.light = this.fx.takeLight(`tree${e.id}`, 0x9affc0);
    this.fx.dust.burst(80, e.x, FLOOR_Y[e.f] + 0.3, e.z, { speed: 4, up: 2, life: 1.6, color: C(0x5a4a30), drag: 2 });
    this.group.scale.setScalar(0.01);
  }

  sync(e) { this.floor = e.f; }

  eat(left) {
    while (this.fruits.length > left) {
      const f = this.fruits.pop();
      const wp = f.getWorldPosition(new THREE.Vector3());
      this.fx.glow.burst(40, wp.x, wp.y, wp.z, { speed: 2, life: 1, color: COLORS.gold, drag: 2 });
      this.group.remove(f);
    }
  }

  end() { this.ending = true; }

  update(dt, t, activeFloor) {
    this.age += dt;
    const grow = ease(Math.min(1, this.age / 2.5));
    const fade = this.ending ? Math.max(0, 1 - (this.endAge += dt) / 1.2) : 1;
    this.group.scale.set(grow * fade, grow * (0.3 + 0.7 * fade), grow * fade);
    this.group.visible = this.floor === activeFloor;
    this.canopy.forEach((c, i) => { c.scale.setScalar(1 + Math.sin(t * 1.5 + i) * 0.04); });
    this.fruits.forEach((f, i) => { f.position.y += Math.sin(t * 2 + i) * 0.002; });
    if (this.light) {
      const wp = this.group.position;
      this.light.position.set(wp.x, wp.y + 3, wp.z);
      this.light.distance = 14;
      this.light.intensity = 26 * grow * fade;
    }
    if (Math.random() < 0.5 * grow) {
      const wp = this.group.position, ang = Math.random() * Math.PI * 2, r = rand(0.5, 2.5);
      this.fx.glow.emit(wp.x + Math.cos(ang) * r, wp.y + rand(0.5, 4), wp.z + Math.sin(ang) * r, rand(-0.2, 0.2), rand(-0.1, 0.3), rand(-0.2, 0.2), 2, Math.random() < 0.5 ? COLORS.leaf : COLORS.gold, 0, 0.5);
    }
    if (this.ending && fade <= 0) {
      this.fx.releaseLight(this.light);
      this.fx.disposeObject(this.group);
      return false;
    }
    return true;
  }
}
