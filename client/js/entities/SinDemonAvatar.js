// The Seven Deadly Sins, as seen in their locked arenas. Seven procedural
// models (each with its own idle, windup and strike animation), a floating
// name + health plate, their hazards (acid pools, Envy's counter-waves,
// Greed's molten gold in flight) and their attack VFX. Step 7: red ground
// telegraphs for every windup, a white hit-flash, the enraged aura below half
// health, and a burning dissolve when it dies. (Damage numbers: ui/DamageNumbers.)

import * as THREE from 'three';
import { FLOOR_Y } from '/shared/constants.js';
import { SINS } from '/shared/sins.js';

const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const std = (color, rough = 0.6, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
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

function addMesh(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const lathe = (pts, seg = 18) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
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

// ---- the seven models: each returns { root, height, animate(t, dt, k) } ---------------
// k = { moving, windup (0..1), strike (0..1), hurt (0..1), state }

const MODELS = {
  pride() {
    const root = new THREE.Group();
    const robe = std(0xe8ecf4, 0.35, 0.1);
    // (No environment map to reflect: a pale, bright, barely-rough mirror steel instead.)
    const mirror = std(0xdfe8ff, 0.18, 0.55, { emissive: 0x3a4a66, emissiveIntensity: 0.6 });
    const gold = std(0xd8b048, 0.25, 0.9, { emissive: 0x6a4a10, emissiveIntensity: 0.4 });
    const body = new THREE.Group();
    body.position.y = 0.35; // it floats
    root.add(body);
    addMesh(body, lathe([[0.05, 0], [0.55, 0.05], [0.4, 0.8], [0.26, 1.5], [0.22, 1.8], [0.12, 1.95], [0, 2.0]]), robe);
    const face = addMesh(body, new THREE.SphereGeometry(0.2, 24, 16), mirror, 0, 2.15, 0);
    face.scale.set(0.85, 1.1, 0.85);
    const halo = addMesh(body, new THREE.TorusGeometry(0.32, 0.03, 8, 40), gold, 0, 2.5, -0.05);
    halo.rotation.x = 0.25;
    const wings = [];
    for (const side of [-1, 1]) {
      for (let tier = 0; tier < 2; tier++) {
        const wing = new THREE.Group();
        wing.position.set(side * 0.2, 1.6 - tier * 0.45, -0.15);
        for (let i = 0; i < 6; i++) {
          const shard = addMesh(wing, new THREE.BoxGeometry(0.16, 0.9 - i * 0.08, 0.015), mirror, side * (0.25 + i * 0.18), 0.2 + i * 0.05, -i * 0.02);
          shard.rotation.z = side * (0.5 + i * 0.12);
        }
        body.add(wing);
        wings.push({ wing, side, tier });
      }
    }
    for (const side of [-1, 1]) {
      const arm = addMesh(body, new THREE.CylinderGeometry(0.05, 0.07, 0.8, 8), robe, side * 0.32, 1.35, 0.08);
      arm.rotation.z = side * 0.45;
    }
    const lanceGlow = addMesh(body, new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff4c0 }), 0, 1.25, 0.45);
    return {
      root, height: 2.9,
      animate(t, dt, k) {
        body.position.y = 0.35 + Math.sin(t * 1.4) * 0.08;
        wings.forEach(({ wing, side, tier }) => { wing.rotation.y = side * (0.25 + Math.sin(t * 1.2 + tier) * 0.12 + k.windup * 0.4); });
        halo.rotation.z = t * 0.6;
        gold.emissiveIntensity = 0.4 + k.windup * 2.5;
        lanceGlow.scale.setScalar(0.3 + k.windup * 2.2);
        lanceGlow.visible = k.windup > 0.02;
      },
    };
  },

  greed() {
    const root = new THREE.Group();
    const gold = std(0xd4a020, 0.3, 0.95, { emissive: 0x5a2a00, emissiveIntensity: 0.5 });
    const dark = std(0x2a1a08, 0.6, 0.6);
    const body = new THREE.Group();
    root.add(body);
    const belly = addMesh(body, new THREE.SphereGeometry(0.75, 24, 18), gold, 0, 1.0, 0);
    belly.scale.set(1.1, 0.95, 1);
    const head = addMesh(body, new THREE.SphereGeometry(0.3, 18, 12), gold, 0, 1.85, 0.15);
    head.scale.set(1.2, 0.9, 1);
    for (let i = 0; i < 6; i++) {
      const spike = addMesh(body, new THREE.ConeGeometry(0.06, 0.28, 5), gold, Math.cos(i) * 0.2, 2.12, 0.15 + Math.sin(i) * 0.12);
      spike.rotation.z = Math.cos(i) * 0.3;
    }
    const eyes = std(0x000000, 0.5, 0, { emissive: 0xffd040, emissiveIntensity: 2 });
    for (const sx of [-1, 1]) addMesh(body, new THREE.SphereGeometry(0.05, 8, 6), eyes, sx * 0.12, 1.9, 0.4);
    const sack = addMesh(body, new THREE.SphereGeometry(0.55, 16, 12), dark, 0, 1.3, -0.75);
    sack.scale.set(1, 1.2, 0.8);
    const arms = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const arm = new THREE.Group();
        arm.position.set(side * 0.7, 1.3 - i * 0.35, 0.15);
        addMesh(arm, new THREE.CylinderGeometry(0.08, 0.11, 0.7, 8), gold, side * 0.25, -0.2, 0.1).rotation.z = side * 1.0;
        addMesh(arm, new THREE.CylinderGeometry(0.1, 0.1, 0.05, 14), gold, side * 0.55, -0.45, 0.25); // a coin in every hand
        body.add(arm);
        arms.push({ arm, side, i });
      }
    }
    for (const side of [-1, 1]) addMesh(body, new THREE.CylinderGeometry(0.16, 0.2, 0.6, 10), gold, side * 0.35, 0.3, 0);
    const coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 10), gold, 20);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 20; i++) {
      m4.makeRotationX(Math.random() * 3);
      m4.setPosition((Math.random() - 0.5) * 1.6, 0.02 + Math.random() * 0.05, (Math.random() - 0.5) * 1.6);
      coins.setMatrixAt(i, m4);
    }
    root.add(coins);
    return {
      root, height: 2.4,
      animate(t, dt, k) {
        body.position.y = Math.abs(Math.sin(t * (k.moving ? 6 : 1.5))) * 0.06;
        body.rotation.z = Math.sin(t * (k.moving ? 3 : 0.8)) * 0.05;
        arms.forEach(({ arm, side, i }) => { arm.rotation.x = Math.sin(t * 2 + i) * 0.2 - k.windup * 1.6; arm.rotation.z = side * k.windup * 0.4; });
        gold.emissiveIntensity = 0.5 + k.windup * 1.5 + Math.sin(t * 3) * 0.1;
      },
    };
  },

  lust() {
    const root = new THREE.Group();
    const silk = std(0xb02a78, 0.35, 0.1, { emissive: 0x4a0a30, emissiveIntensity: 0.4 });
    const skin = std(0xe8b8c8, 0.4);
    const body = new THREE.Group();
    body.position.y = 0.2;
    root.add(body);
    addMesh(body, lathe([[0.02, 0], [0.6, 0.05], [0.3, 0.7], [0.18, 1.2], [0.22, 1.45], [0.14, 1.65], [0, 1.7]]), silk);
    const head = addMesh(body, new THREE.SphereGeometry(0.15, 18, 14), skin, 0, 1.85, 0);
    head.scale.set(0.85, 1.15, 0.9);
    const eyes = std(0x000000, 0.5, 0, { emissive: 0xff60c8, emissiveIntensity: 2 });
    for (const sx of [-1, 1]) addMesh(body, new THREE.SphereGeometry(0.025, 8, 6), eyes, sx * 0.05, 1.88, 0.12);
    const arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.2, 1.5, 0);
      addMesh(arm, new THREE.CylinderGeometry(0.03, 0.04, 1.0, 8), skin, side * 0.3, -0.25, 0.2).rotation.z = side * 1.1;
      body.add(arm);
      arms.push({ arm, side });
    }
    // Ribbons of hair and silk that never stop moving.
    const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xff7ac8, emissive: 0xff3aa0, emissiveIntensity: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    const ribbons = [];
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.PlaneGeometry(0.08, 2.2, 1, 24);
      geo.translate(0, -1.1, 0);
      const mesh = addMesh(body, geo, ribbonMat, Math.cos(i * 0.8) * 0.12, 1.95, Math.sin(i * 0.8) * 0.12 - 0.05);
      mesh.userData.base = geo.attributes.position.array.slice();
      mesh.userData.phase = i * 0.9;
      ribbons.push(mesh);
    }
    return {
      root, height: 2.3,
      animate(t, dt, k) {
        body.position.y = 0.2 + Math.sin(t * 1.8) * 0.06;
        body.rotation.y = Math.sin(t * 0.7) * 0.2;
        arms.forEach(({ arm, side }) => { arm.rotation.x = -k.windup * 1.4 + Math.sin(t * 1.5) * 0.15; arm.rotation.y = side * Math.sin(t) * 0.2; });
        for (const r of ribbons) {
          const pos = r.geometry.attributes.position.array, base = r.userData.base;
          for (let i = 0; i < pos.length; i += 3) {
            const y = base[i + 1];
            pos[i] = base[i] + Math.sin(t * 2.2 + y * 2.5 + r.userData.phase) * 0.18 * (-y);
            pos[i + 2] = base[i + 2] + Math.cos(t * 1.7 + y * 2 + r.userData.phase) * 0.22 * (-y) - k.windup * (-y) * 0.6;
          }
          r.geometry.attributes.position.needsUpdate = true;
        }
        ribbonMat.emissiveIntensity = 0.6 + k.windup * 1.6;
      },
    };
  },

  envy() {
    const root = new THREE.Group();
    const porcelain = std(0x9ad8a8, 0.35, 0.1, { emissive: 0x0a3a14, emissiveIntensity: 0.5 });
    const hollow = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const body = new THREE.Group();
    root.add(body);
    const limb = (len, r) => {
      const g = new THREE.Group();
      addMesh(g, new THREE.CylinderGeometry(r * 0.8, r, len, 8), porcelain, 0, -len / 2, 0);
      addMesh(g, new THREE.SphereGeometry(r * 1.2, 8, 6), porcelain);
      return g;
    };
    const legs = [-1, 1].map((s) => {
      const hip = limb(0.95, 0.07);
      hip.position.set(s * 0.14, 1.0, 0);
      body.add(hip);
      return hip;
    });
    const torso = addMesh(body, new THREE.CylinderGeometry(0.28, 0.2, 0.75, 12, 1, true), porcelain, 0, 1.4, 0);
    torso.material = porcelain;
    addMesh(body, new THREE.TorusGeometry(0.15, 0.05, 8, 20), porcelain, 0, 1.45, 0.05); // the hollow in its chest
    addMesh(body, new THREE.CircleGeometry(0.12, 16), hollow, 0, 1.45, 0.04);
    const head = new THREE.Group();
    head.position.set(0, 2.0, 0);
    const mask = addMesh(head, new THREE.SphereGeometry(0.2, 18, 14, 0, Math.PI), porcelain, 0, 0, 0);
    mask.rotation.y = -Math.PI / 2;
    for (const sx of [-1, 1]) addMesh(head, new THREE.SphereGeometry(0.04, 8, 6), hollow, sx * 0.07, 0.04, 0.17);
    addMesh(head, new THREE.BoxGeometry(0.12, 0.015, 0.02), hollow, 0, -0.08, 0.18);
    body.add(head);
    const arms = [-1, 1].map((s) => {
      const sh = limb(0.9, 0.06);
      sh.position.set(s * 0.32, 1.75, 0);
      body.add(sh);
      return { sh, s };
    });
    return {
      root, height: 2.4,
      element: null,
      animate(t, dt, k) {
        const walk = k.moving ? Math.sin(t * 8) : 0;
        legs.forEach((l, i) => { l.rotation.x = walk * 0.5 * (i ? 1 : -1); });
        arms.forEach(({ sh, s }) => { sh.rotation.x = -walk * 0.4 * s - k.windup * 2; sh.rotation.z = s * (0.15 + k.windup * 0.5); });
        head.rotation.z = Math.sin(t * 3.7) * 0.25; // a mimic's twitch
        const el = this.element ? ELEMENT_COLORS[this.element] : 0x2aff60;
        porcelain.emissive.setHex(el);
        porcelain.emissiveIntensity = 0.25 + k.windup * 1.2 + k.hurt * 0.8;
      },
    };
  },

  gluttony() {
    const root = new THREE.Group();
    const flesh = std(0x6a7a2a, 0.75, 0, { emissive: 0x1a2a00, emissiveIntensity: 0.3 });
    const gums = std(0x3a0a10, 0.5);
    const teeth = std(0xe8e0c0, 0.4);
    const body = new THREE.Group();
    root.add(body);
    const sphere = addMesh(body, new THREE.SphereGeometry(1.0, 28, 20), flesh, 0, 1.25, 0);
    sphere.scale.set(1.05, 0.9, 1);
    const jaw = new THREE.Group();
    jaw.position.set(0, 1.05, 0.6);
    addMesh(jaw, new THREE.SphereGeometry(0.55, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), gums, 0, 0, 0).rotation.x = Math.PI;
    body.add(jaw);
    const mawUpper = addMesh(body, new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ color: 0x050102 }), 0, 1.15, 0.93);
    mawUpper.scale.y = 0.7;
    const fangs = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const f = addMesh(body, new THREE.ConeGeometry(0.05, 0.22, 5), teeth, Math.cos(a) * 0.5, 1.15 + Math.sin(a) * 0.36, 0.92);
      f.rotation.z = a + Math.PI / 2;
      fangs.push(f);
    }
    for (const side of [-1, 1]) {
      for (const fz of [-0.3, 0.3]) addMesh(body, new THREE.CylinderGeometry(0.08, 0.12, 0.5, 8), flesh, side * 0.55, 0.25, fz);
    }
    const drool = std(0x6aff2a, 0.2, 0, { emissive: 0x3aff10, emissiveIntensity: 0.8 });
    const drips = [];
    for (let i = 0; i < 4; i++) drips.push(addMesh(body, new THREE.SphereGeometry(0.04, 6, 4), drool, (i - 1.5) * 0.18, 0.8, 0.95));
    return {
      root, height: 2.6,
      animate(t, dt, k) {
        body.position.y = Math.abs(Math.sin(t * (k.moving ? 4 : 1.2))) * 0.05;
        sphere.scale.set(1.05 + Math.sin(t * 1.4) * 0.03 + k.windup * 0.1, 0.9 + Math.sin(t * 1.4) * 0.03, 1);
        jaw.rotation.x = 0.15 + k.windup * 0.7 + k.strike * 0.4;
        drips.forEach((d, i) => { d.position.y = 0.8 - ((t * 0.7 + i * 0.3) % 1) * 0.7; });
      },
    };
  },

  wrath() {
    const root = new THREE.Group();
    const flesh = std(0x7a1410, 0.55, 0.1, { emissive: 0xff1a08, emissiveIntensity: 0.35 });
    const horn = std(0x1a0a08, 0.4);
    const steel = std(0x5a5a62, 0.28, 0.9);
    const scar = std(0x200000, 0.6, 0, { emissive: 0xff4010, emissiveIntensity: 1.2 });
    const body = new THREE.Group();
    root.add(body);
    const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 12);
    const legs = [-1, 1].map((s) => {
      const hip = new THREE.Group();
      hip.position.set(s * 0.24, 1.0, 0);
      addMesh(hip, cap(0.13, 0.42), flesh, 0, -0.25, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.52;
      addMesh(knee, cap(0.11, 0.38), flesh, 0, -0.22, 0.02);
      addMesh(knee, new THREE.BoxGeometry(0.2, 0.08, 0.34), horn, 0, -0.46, 0.07);
      hip.add(knee);
      body.add(hip);
      return { hip, knee };
    });
    addMesh(body, cap(0.26, 0.25), flesh, 0, 1.12, 0).scale.set(1.15, 1, 0.85); // gut
    const chest = addMesh(body, cap(0.38, 0.35), flesh, 0, 1.62, 0);
    chest.scale.set(1.25, 1, 0.8);
    chest.rotation.x = 0.12;
    // Glowing veins/scars across the chest.
    for (let i = 0; i < 5; i++) {
      const v = addMesh(body, new THREE.BoxGeometry(0.03, 0.4 + (i % 2) * 0.2, 0.02), scar, -0.3 + i * 0.15, 1.6, 0.31);
      v.rotation.z = (i - 2) * 0.35;
    }
    for (const side of [-1, 1]) addMesh(body, new THREE.SphereGeometry(0.22, 12, 10), flesh, side * 0.5, 1.95, 0); // traps/shoulders
    const head = new THREE.Group();
    head.position.set(0, 2.18, 0.12);
    const skull = addMesh(head, new THREE.SphereGeometry(0.19, 14, 12), flesh);
    skull.scale.set(1, 0.95, 1.05);
    const jaw = addMesh(head, new THREE.BoxGeometry(0.26, 0.1, 0.2), flesh, 0, -0.14, 0.06);
    for (let i = -2; i <= 2; i++) addMesh(head, new THREE.ConeGeometry(0.018, 0.06, 4), std(0xe8e0c0, 0.4), i * 0.05, -0.1, 0.16).rotation.x = Math.PI;
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 6, 12, Math.PI * 0.8), horn);
      h.position.set(sx * 0.16, 0.12, -0.02);
      h.rotation.set(0, sx * 0.4, sx > 0 ? 0.3 : Math.PI - 0.3);
      head.add(h);
      addMesh(head, new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd020 }), sx * 0.075, 0.03, 0.16);
    }
    body.add(head);
    const arms = [-1, 1].map((s) => {
      const sh = new THREE.Group();
      sh.position.set(s * 0.62, 1.9, 0);
      addMesh(sh, cap(0.12, 0.38), flesh, 0, -0.26, 0);
      const el = new THREE.Group();
      el.position.y = -0.55;
      addMesh(el, cap(0.1, 0.34), flesh, 0, -0.2, 0);
      const blade = addMesh(el, new THREE.BoxGeometry(0.05, 1.1, 0.2), steel, 0, -0.85, 0.08);
      blade.rotation.x = 0.15;
      addMesh(el, new THREE.BoxGeometry(0.22, 0.05, 0.12), horn, 0, -0.38, 0.05);
      sh.add(el);
      body.add(sh);
      return { sh, el, s };
    });
    return {
      root, height: 2.5,
      animate(t, dt, k) {
        const fast = k.state === 'charge';
        const walk = k.moving ? Math.sin(t * (fast ? 16 : 9)) : 0;
        legs.forEach((l, i) => { l.hip.rotation.x = walk * 0.7 * (i ? 1 : -1); l.knee.rotation.x = Math.max(0, walk * (i ? -1 : 1)) * 0.8; });
        body.rotation.x = fast ? 0.45 : k.windup * 0.3;
        arms.forEach(({ sh, el, s }) => {
          sh.rotation.x = -walk * 0.5 * s - k.windup * 2.4 + k.strike * 2.4;
          sh.rotation.z = s * 0.25;
          el.rotation.x = -0.4 - k.windup * 0.6;
        });
        jaw.position.y = -0.14 - (k.windup + k.strike) * 0.05;
        flesh.emissiveIntensity = 0.35 + (1 - k.hpK) * 1.2 + Math.sin(t * 10) * 0.08; // it burns hotter as it bleeds
        scar.emissiveIntensity = 1.2 + (1 - k.hpK) * 2;
      },
    };
  },

  sloth() {
    const root = new THREE.Group();
    const shroud = std(0x5a6278, 0.95, 0, { side: THREE.DoubleSide });
    const chain = std(0x2a2a30, 0.4, 0.8);
    const body = new THREE.Group();
    root.add(body);
    const mass = addMesh(body, lathe([[0.2, 0], [1.2, 0.2], [1.1, 0.9], [0.85, 1.7], [0.55, 2.3], [0.2, 2.6], [0, 2.65]], 22), shroud, 0, 0.3, 0);
    mass.scale.z = 0.85;
    const lids = std(0x101418, 0.5, 0, { emissive: 0x6a8aff, emissiveIntensity: 0.3 });
    for (const sx of [-1, 1]) {
      const eye = addMesh(body, new THREE.SphereGeometry(0.1, 12, 8), lids, sx * 0.25, 2.3, 0.5);
      eye.scale.y = 0.18; // closed, dreaming
    }
    for (let i = 0; i < 5; i++) {
      const link = addMesh(body, new THREE.TorusGeometry(0.9 - i * 0.1, 0.03, 6, 28), chain, 0, 0.8 + i * 0.35, 0);
      link.rotation.x = Math.PI / 2 + Math.sin(i) * 0.2;
    }
    const tendrils = [];
    for (let i = 0; i < 6; i++) {
      const tdr = addMesh(body, new THREE.ConeGeometry(0.12, 1.2, 6), shroud, Math.cos(i) * 0.9, 0.1, Math.sin(i) * 0.9);
      tdr.rotation.x = Math.PI;
      tendrils.push(tdr);
    }
    return {
      root, height: 3.1,
      animate(t, dt, k) {
        body.position.y = 0.3 + Math.sin(t * 0.6) * 0.15;
        body.rotation.y = t * 0.08;
        mass.scale.x = 1 + Math.sin(t * 0.5) * 0.04 + k.windup * 0.18;
        lids.emissiveIntensity = 0.3 + k.windup * 2.5;
        tendrils.forEach((td, i) => { td.rotation.z = Math.sin(t * 0.7 + i) * 0.25; });
      },
    };
  },
};

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
    this.model = MODELS[this.sin]();
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
