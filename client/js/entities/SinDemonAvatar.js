// The Seven Deadly Sins, as seen in their locked arenas. Seven procedural
// models (each with its own idle, windup and strike animation), a floating
// name + health plate, their hazards (acid pools, Envy's counter-waves,
// Greed's molten gold in flight) and their attack VFX. Step 7: red ground
// telegraphs for every windup, a white hit-flash, the enraged aura below half
// health, and a burning dissolve when it dies. (Damage numbers: ui/DamageNumbers.)

import * as THREE from 'three';
import { FLOOR_Y } from '/shared/constants.js';
import { SINS } from '/shared/sins.js';
import { SIN_MODELS } from './sinModels.js';

const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const ELEMENT_COLORS = {
  black: 0x7a3cff, fire: 0xff5a1f, water: 0x2fa8ff, earth: 0x8bb33a, wind: 0x9ef0e0, white: 0xfff6d8, void: 0x9aa3ad,
};

function textSprite(width, height, scale) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scale, (scale * height) / width, 1);
  sprite.renderOrder = 1000;
  return { sprite, ctx: c.getContext('2d'), tex, canvas: c };
}

const WHITE = new THREE.Color(0xffffff);
const RAGE = new THREE.Color(0xff2a10);

/**
 * Patch a model material for the death dissolve: fragments vanish where a 3D
 * noise falls below uDissolve, with a burning rim in the Sin's colour. Patched
 * at spawn, so dying never compiles a new shader.
 */
function addDissolve(mat, dissolve, edge) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDissolve = dissolve;
    sh.uniforms.uEdge = edge;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uDissolve; uniform vec3 uEdge; varying vec3 vDPos;
float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float dn = dNoise(vDPos * 6.0) * 0.75 + dNoise(vDPos * 17.0) * 0.25;
if (dn < uDissolve) discard;
totalEmissiveRadiance += uEdge * smoothstep(uDissolve + 0.09, uDissolve, dn) * step(0.001, uDissolve) * 5.0;`);
  };
  mat.customProgramCacheKey = () => 'sin-dissolve';
}

// ---- the seven models: sinModels.js (Step 9) --------------------------------------

export class SinDemonAvatar {
  constructor(snap, { fx, getPos }) {
    this.id = snap.id;
    this.sin = snap.sin;
    this.S = SINS[snap.sin];
    this.fx = fx;
    this.getPos = getPos;
    this.x = snap.x;
    this.z = snap.z;
    this.yaw = snap.yaw;
    this.floor = snap.f;
    this.snap = snap;
    this.windup = 0;
    this.strike = 0;
    this.hurt = 0;
    this.deathK = 0;
    this.erupt = snap.er ? 0 : 1;
    this.effects = [];
    this.telegraphs = [];
    this.rageK = 0;
    this.hazards = new Map();

    this.group = new THREE.Group();
    this.model = SIN_MODELS[this.sin]();
    this.group.add(this.model.root);
    this.model.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.color = new THREE.Color(this.S.color);
    // A glowing sigil underfoot.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.y = 0.03;
    this.group.add(ring);
    this.sigil = ring;

    this.label = textSprite(512, 128, 2.6);
    this.label.sprite.position.y = this.model.height + 0.55;
    this.group.add(this.label.sprite);
    this.hazardGroup = new THREE.Group(); // in world space
    // Hit-flash and the death dissolve work on every lit material of the model.
    this.dissolve = { value: 0 };
    this.edge = { value: this.color.clone().multiplyScalar(1.5) };
    this.flashMats = [];
    this.unlit = [];
    this.model.root.traverse((o) => {
      if (o.isMesh && !o.material?.isMeshStandardMaterial) this.unlit.push(o);
      if (!o.isMesh || !o.material?.isMeshStandardMaterial || o.material.userData.sinPatched) return;
      const m = o.material;
      m.userData.sinPatched = true;
      m.userData.base = m.emissive.clone();
      m.userData.baseI = m.emissiveIntensity;
      addDissolve(m, this.dissolve, this.edge);
      this.flashMats.push(m);
    });
    // The enraged aura: a flickering shell of the Sin's fire.
    this.aura = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, this.model.height + 0.6, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.aura.position.y = (this.model.height + 0.6) / 2;
    this.group.add(this.aura);
    this.labelKey = '';
    this.setSnapshot(snap);
  }

  setSnapshot(s) {
    if (s.f !== this.floor) { this.x = s.x; this.z = s.z; }
    this.snap = s;
    this.floor = s.f;
    const key = `${s.hp}|${s.dead}|${s.rage}|${s.st.join(',')}`;
    if (key !== this.labelKey) {
      this.labelKey = key;
      this.drawLabel(s);
    }
    this.syncHazards(s.hz ?? []);
  }

  drawLabel(s) {
    const { ctx, tex, canvas } = this.label;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.font = 'bold 30px Cinzel, Georgia, serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    const title = `${this.S.name.toUpperCase()} · ${s.rage ? 'ENRAGED' : this.S.title}`;
    ctx.strokeText(title, 256, 38);
    ctx.fillStyle = this.S.color;
    ctx.fillText(title, 256, 38);
    const k = Math.max(0, s.hp / s.maxHp);
    ctx.fillStyle = 'rgba(20,0,4,0.85)';
    ctx.fillRect(56, 60, 400, 22);
    ctx.fillStyle = '#c0182a';
    ctx.fillRect(58, 62, 396 * k, 18);
    ctx.font = 'bold 16px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(s.dead ? 'SLAIN' : `${s.hp} / ${s.maxHp}${s.st.length ? '  ·  ' + s.st.slice(0, 3).join(' ').toUpperCase() : ''}`, 256, 77);
    tex.needsUpdate = true;
  }

  /** A hit: the white flash (the number itself floats up from ui/DamageNumbers). */
  showDamage(amount, source) {
    this.hurt = Math.min(1, 0.55 + amount / 30);
    if (this.sin === 'envy' && source) this.model.element = source;
  }

  /** Below half health (or the Black Slash Wave wore off): an eruption of its fire. */
  onEnrage(e) {
    if (e.stripped) { this.strippedUntil = performance.now() + e.stripped * 1000; return; }
    const y = FLOOR_Y[this.floor];
    this.ring(this.x, this.z, 7, 0xff2a10, 0.9);
    this.ring(this.x, this.z, 4, this.S.color, 0.6);
    this.fx?.glow.burst(160, this.x, y + 1.2, this.z, { speed: 7, up: 3, life: 1.2, color: new THREE.Color(0xff3010), colorVar: 0.08, drag: 1.6 });
    this.fx?.glow.burst(80, this.x, y + 1.5, this.z, { speed: 4, up: 4, life: 1.4, color: this.color, drag: 1.4 });
    this.hurt = 1;
  }

  /** Where the attack will land: red on the ground for the whole windup. */
  telegraph(aoe, windup) {
    const y = FLOOR_Y[this.floor] + 0.045;
    for (const a of aoe) {
      let mesh, fill;
      const mat = new THREE.MeshBasicMaterial({ color: 0xff1a10, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
      const fillMat = mat.clone();
      if (a.shape === 'circle') {
        mesh = new THREE.Mesh(new THREE.RingGeometry(a.r * 0.92, a.r, 48).rotateX(-Math.PI / 2), mat);
        fill = new THREE.Mesh(new THREE.CircleGeometry(a.r, 48).rotateX(-Math.PI / 2), fillMat);
        mesh.position.set(a.x, y, a.z);
        fill.position.set(a.x, y - 0.005, a.z);
      } else {
        const len = Math.hypot(a.x2 - a.x, a.z2 - a.z);
        const geo = () => new THREE.PlaneGeometry(a.w, len).rotateX(-Math.PI / 2);
        mesh = new THREE.Mesh(geo(), mat);
        fill = new THREE.Mesh(geo(), fillMat);
        for (const m of [mesh, fill]) {
          m.position.set((a.x + a.x2) / 2, y, (a.z + a.z2) / 2);
          m.rotation.y = Math.atan2(a.x2 - a.x, a.z2 - a.z);
        }
        fill.position.y -= 0.005;
      }
      this.hazardGroup.add(mesh, fill);
      this.telegraphs.push({ mesh, fill, age: 0, life: Math.max(0.2, windup), shape: a.shape });
    }
  }

  // ---- hazards from the snapshot ----------------------------------------------------

  syncHazards(list) {
    const seen = new Set();
    const y = FLOOR_Y[this.floor];
    for (const h of list) {
      seen.add(h.id);
      let o = this.hazards.get(h.id);
      if (!o) {
        if (h.k === 'acid') {
          o = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0x3a8a10, emissive: 0x4aff20, emissiveIntensity: 0.7, roughness: 0.15, transparent: true, opacity: 0.85, depthWrite: false }));
        } else if (h.k === 'wave') {
          const c = ELEMENT_COLORS[h.el] ?? 0x6dff9a;
          o = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 6, 64).rotateX(Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        } else {
          o = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc23a }));
        }
        this.hazardGroup.add(o);
        this.hazards.set(h.id, o);
      }
      o.userData.h = h;
      if (h.k === 'acid') {
        o.position.set(h.x, y + 0.025, h.z);
        o.scale.setScalar(h.r);
      } else if (h.k === 'wave') {
        o.position.set(h.x, y + 0.4, h.z);
        o.scale.set(h.r, 1, h.r);
      } else {
        const p = h.p;
        o.position.set(h.fx + (h.x - h.fx) * p, y + 1.4 + Math.sin(p * Math.PI) * 2.2 - p * 1.3, h.fz + (h.z - h.fz) * p);
      }
    }
    for (const [id, o] of this.hazards) {
      if (seen.has(id)) continue;
      this.hazardGroup.remove(o);
      o.geometry.dispose();
      o.material.dispose();
      this.hazards.delete(id);
    }
  }

  // ---- attacks ----------------------------------------------------------------------

  /** A `sin:attack` event (windup or strike) or `sin:impact` / `sin:reflect`. */
  onAttack(e) {
    const y = FLOOR_Y[this.floor];
    const glow = this.fx?.glow;
    const col = this.color;
    if (e.type === 'sin:reflect') {
      this.beam({ x: e.x, y: y + 1.6, z: e.z }, { x: e.tx, y: y + 1.3, z: e.tz }, 0xe8f0ff, 0.35, 0.09);
      glow?.burst(40, e.x, y + 2.1, e.z, { speed: 5, life: 0.5, color: new THREE.Color(0xffffff), drag: 3 });
      return;
    }
    if (e.type === 'sin:impact') {
      glow?.burst(50, e.x, y + 0.3, e.z, { speed: 4, life: 0.8, color: new THREE.Color(0xffb020), drag: 2 });
      this.ring(e.x, e.z, e.r, 0xffb020, 0.5);
      return;
    }
    if (e.stage === 'windup') {
      this.windupUntil = performance.now() + (e.windup ?? 0.6) * 1000;
      if (e.aoe?.length) this.telegraph(e.aoe, e.windup ?? 0.6);
      if (e.kind === 'vacuum') this.swirl(e.r ?? 9, e.windup);
      return;
    }
    this.strike = 1;
    this.windupUntil = 0;
    switch (e.kind) {
      case 'lance':
        this.beam({ x: e.x, y: y + 1.6, z: e.z }, { x: e.tx, y: y + 1.3, z: e.tz }, 0xfff4c0, 0.4, 0.12);
        break;
      case 'ribbons':
        for (const id of e.hits ?? []) {
          const p = this.getPos(id);
          if (p) this.beam({ x: e.x, y: y + 1.6, z: e.z }, { x: p.x, y: y + 1.2, z: p.z }, 0xff5fb4, 0.6, 0.05);
        }
        break;
      case 'yawn':
        this.ring(e.x, e.z, e.r ?? 5, 0x8f9bb8, 0.8);
        break;
      case 'vacuum':
      case 'bite':
        glow?.burst(40, e.x, y + 1.1, e.z, { speed: 3, life: 0.5, color: new THREE.Color(0xa6e22e), drag: 3 });
        break;
      case 'cleave':
      case 'caress':
      case 'claw':
        glow?.burst(30, e.x, y + 1.2, e.z, { speed: 4, life: 0.4, color: col, drag: 4 });
        break;
      case 'charge':
        break;
    }
  }

  beam(from, to, color, life, width) {
    const a = new THREE.Vector3(from.x, from.y, from.z), b = new THREE.Vector3(to.x, to.y, to.z);
    const len = a.distanceTo(b);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(width, width, len, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.hazardGroup.add(mesh);
    this.effects.push({ mesh, age: 0, life, kind: 'beam' });
  }

  ring(x, z, r, color, life) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    mesh.position.set(x, FLOOR_Y[this.floor] + 0.06, z);
    this.hazardGroup.add(mesh);
    this.effects.push({ mesh, age: 0, life, kind: 'ring', r });
  }

  swirl(r, windup) {
    if (!this.fx) return;
    const y = FLOOR_Y[this.floor];
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2, d = r * (0.4 + Math.random() * 0.6);
      const px = this.x + Math.cos(a) * d, pz = this.z + Math.sin(a) * d;
      this.fx.glow.emit(px, y + 0.3 + Math.random() * 1.5, pz, (this.x - px) / windup, 0.3, (this.z - pz) / windup, windup, new THREE.Color(0xa6e22e), 0, 0);
    }
  }

  // ---- per frame --------------------------------------------------------------------

  update(dt, t, visibleFloors) {
    const s = this.snap;
    const k = 1 - Math.exp(-dt * 10);
    this.x += (s.x - this.x) * k;
    this.z += (s.z - this.z) * k;
    this.yaw = angleLerp(this.yaw, s.yaw, k);
    const vis = visibleFloors.includes(s.f);
    this.group.visible = vis;
    this.hazardGroup.visible = vis;
    // Eruption: it climbs out of its Heart.
    this.erupt = s.er ? Math.min(0.999, this.erupt + dt / 2.2) : Math.min(1, this.erupt + dt * 2);
    const up = 1 - (1 - this.erupt) ** 3;
    // Death: it burns away from within (the dissolve shader), sinking a little.
    this.deathK = s.dead ? Math.min(1, this.deathK + dt / 2.2) : 0;
    this.group.position.set(this.x, FLOOR_Y[s.f] - (1 - up) * 1.2 - this.deathK * 0.3, this.z);
    this.group.rotation.y = this.yaw + Math.PI; // models face +z; yaw 0 looks -z
    this.model.root.scale.setScalar(Math.max(0.01, up));
    this.dissolve.value = this.deathK * 1.02;
    for (const o of this.unlit) o.visible = this.deathK < 0.4; // eyes and glows can't dissolve: they go out
    const now = performance.now();
    const winding = (this.windupUntil ?? 0) > now || ['lance', 'gold', 'ribbons', 'caress', 'claw', 'acid', 'vacuum', 'charge', 'cleave', 'yawn'].includes(s.act);
    this.windup += ((winding ? 1 : 0) - this.windup) * Math.min(1, dt * 6);
    this.strike = Math.max(0, this.strike - dt * 4);
    this.hurt = Math.max(0, this.hurt - dt * 3);
    for (const m of this.flashMats) { m.emissive.copy(m.userData.base); m.emissiveIntensity = m.userData.baseI; }
    this.model.animate(t, dt, { moving: s.mv, windup: this.windup, strike: this.strike, hurt: this.hurt, state: s.act, hpK: s.hp / s.maxHp });
    // Hit-flash: every lit surface blazes white for a moment.
    if (this.hurt > 0.01) {
      for (const m of this.flashMats) {
        m.emissive.lerp(WHITE, this.hurt * 0.85);
        m.emissiveIntensity = Math.max(m.emissiveIntensity, this.hurt * 2.2);
      }
    }
    // Enraged: a red-fire shell, a red sigil, embers pouring off it.
    const rage = !!s.rage && !s.dead;
    this.rageK += ((rage ? 1 : 0) - this.rageK) * Math.min(1, dt * 3);
    this.aura.visible = this.rageK > 0.01;
    this.aura.material.opacity = this.rageK * (0.16 + Math.sin(t * 14) * 0.05 + Math.random() * 0.04);
    this.aura.scale.set(1 + Math.sin(t * 9) * 0.04, 1, 1 + Math.cos(t * 7) * 0.04);
    this.aura.rotation.y = t * 1.5;
    this.sigil.material.color.copy(this.color).lerp(new THREE.Color(0xff1a08), this.rageK);
    this.sigil.scale.setScalar(1 + this.rageK * 0.4);
    this.sigil.material.opacity = (0.25 + Math.sin(t * 3) * 0.1 + this.windup * 0.4) * (1 - this.deathK);
    this.sigil.rotation.y = t * 0.4;
    this.label.sprite.material.opacity = 1 - this.deathK;

    if (vis && this.fx && !s.dead) {
      const y = FLOOR_Y[s.f];
      if (s.er && Math.random() < 0.9) {
        this.fx.glow.emit(this.x + (Math.random() - 0.5) * 1.5, y + 0.1, this.z + (Math.random() - 0.5) * 1.5, 0, 2 + Math.random() * 2, 0, 0.9, this.color, 0, 0.5);
      }
      if (Math.random() < 0.25) {
        this.fx.glow.emit(this.x + (Math.random() - 0.5) * 0.8, y + Math.random() * this.model.height, this.z + (Math.random() - 0.5) * 0.8,
          0, 0.4, 0, 0.8, this.color, -0.2, 0.5);
      }
      if (s.act === 'charge' && Math.random() < 0.9) this.fx.glow.emit(this.x, y + 0.8, this.z, 0, 0.5, 0, 0.5, new THREE.Color(0xff2010), 0, 1);
      if (rage) {
        for (let n = 0; n < 3; n++) {
          const a = Math.random() * Math.PI * 2;
          this.fx.glow.emit(this.x + Math.cos(a) * 0.9, y + Math.random() * this.model.height, this.z + Math.sin(a) * 0.9, 0, 2 + Math.random() * 2, 0, 0.6, Math.random() < 0.6 ? RAGE : this.color, -0.5, 1);
        }
      }
    }
    // Dying: embers stream up off the dissolving body.
    if (vis && this.fx && s.dead && this.deathK < 0.95) {
      const y = FLOOR_Y[s.f];
      for (let n = 0; n < 4; n++) {
        this.fx.glow.emit(this.x + (Math.random() - 0.5) * 1.4, y + Math.random() * this.model.height, this.z + (Math.random() - 0.5) * 1.4, 0, 1.5 + Math.random() * 2, 0, 1, this.color, -0.3, 0.5);
      }
    }
    // Ground telegraphs fill up as the strike nears, then flash.
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const tg = this.telegraphs[i];
      tg.age += dt;
      const f = tg.age / tg.life;
      tg.mesh.material.opacity = f < 1 ? 0.55 + Math.sin(tg.age * 18) * 0.2 : Math.max(0, 1 - (f - 1) * 5);
      tg.fill.material.opacity = f < 1 ? 0.12 + f * 0.33 : Math.max(0, 0.6 - (f - 1) * 5);
      if (tg.shape === 'circle') tg.fill.scale.setScalar(Math.min(1, 0.15 + f * 0.85));
      if (f >= 1.2 || s.dead) {
        for (const m of [tg.mesh, tg.fill]) {
          this.hazardGroup.remove(m);
          m.geometry.dispose();
          m.material.dispose();
        }
        this.telegraphs.splice(i, 1);
      }
    }
    for (const o of this.hazards.values()) {
      if (o.userData.h?.k === 'acid') o.material.emissiveIntensity = 0.55 + Math.sin(t * 4 + o.userData.h.id) * 0.2;
      if (o.userData.h?.k === 'wave') o.material.opacity = 0.85 * (1 - o.scale.x / 10);
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.age += dt;
      const f = e.age / e.life;
      e.mesh.material.opacity = Math.max(0, 1 - f);
      if (e.kind === 'ring') e.mesh.scale.setScalar(0.3 + f * e.r);
      if (f >= 1) {
        this.hazardGroup.remove(e.mesh);
        e.mesh.geometry.dispose();
        e.mesh.material.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const root of [this.group, this.hazardGroup]) {
      root.traverse((o) => {
        if (o.isMesh || o.isSprite) {
          o.geometry?.dispose();
          if (o.material?.map) o.material.map.dispose();
          o.material?.dispose?.();
        }
      });
    }
  }
}
