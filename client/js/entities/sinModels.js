// Step 9: the Seven Deadly Sins as bespoke nightmare bosses. Each builder
// returns { root, height, animate(t, dt, k) } with
// k = { moving, windup (0..1), strike (0..1), hurt (0..1), state, hpK }.
//
//   Pride     a towering faceless porcelain angel: six razor-edged shattered
//             mirror wings, a floating crown of bleeding golden eyes
//   Greed     a hulking six-armed abomination of melted gold bullion, chained
//             skeletons, a furnace chest dripping molten gold
//   Lust      a hyper-flexible porcelain-masked arachnid bride, hung from
//             crimson silk puppeteer threads, with scissor claws
//   Envy      a tall crooked skin-walker: five weeping masks orbiting its
//             neck, shifting; parasitic tendrils
//   Gluttony  a distended centipede behemoth whose torso splits vertically
//             into a ringed abyssal mouth of rotating teeth
//   Wrath     a massive flayed minotaur fiend in red-hot iron chains, twin
//             molten cleavers, steam venting from its skull
//   Sloth     a floating corpse-giant chained in a broken pendulum cage,
//             dragging iron weights, exhaling black narcotic mist
//
// Only depends on `three` (node tests build every one).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const std = (color, rough = 0.6, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const phys = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, ...extra });
const basic = (color, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
const lathe = (pts, seg = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const limbGeo = (len, r0, r1 = r0 * 0.7, seg = 8) => new THREE.CylinderGeometry(r1, r0, len, seg).translate(0, -len / 2, 0);
/** A chain of links along a curve (merged). */
function chainGeo(points, link = 0.04, thick = 0.012) {
  const curve = new THREE.CatmullRomCurve3(points);
  const n = Math.max(4, Math.round(curve.getLength() / (link * 1.6)));
  const parts = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.TorusGeometry(link, thick, 5, 10);
    const p = curve.getPointAt(i / n), tan = curve.getTangentAt(i / n);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan));
    if (i % 2) g.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(tan, Math.PI / 2)); // alternate links interlock
    g.translate(p.x, p.y, p.z);
    parts.push(g);
  }
  return mergeGeometries(parts);
}
/** A shard of a shattered mirror: an irregular, razor-edged quad. */
function shardGeo(w, h, rand) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(w * (0.4 + rand() * 0.2), -h * 0.05);
  s.lineTo(w, h * (0.3 + rand() * 0.3));
  s.lineTo(w * (0.75 + rand() * 0.2), h);
  s.lineTo(w * 0.1, h * (0.75 + rand() * 0.2));
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
}
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export const SIN_MODELS = {
  pride() {
    const rand = rng(7);
    const root = new THREE.Group();
    const porcelain = phys(0xb4aca4, { roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    const mirror = std(0xb8c4e0, 0.06, 1, { envMapIntensity: 2.2, emissive: 0x1a2440, emissiveIntensity: 0.25 });
    const gold = std(0xe2b450, 0.25, 1, { emissive: 0x4a3008, emissiveIntensity: 0.5 });
    const blood = basic(0x6a0006, 1.2);
    const body = new THREE.Group();
    body.position.y = 0.45; // it floats
    root.add(body);
    // A tall, faceless porcelain figure in a long robe.
    add(body, lathe([[0.04, 0], [0.62, 0.04], [0.48, 0.9], [0.3, 1.8], [0.27, 2.2], [0.15, 2.38], [0, 2.42]], 32), porcelain);
    const head = add(body, new THREE.SphereGeometry(0.21, 28, 20), porcelain, 0, 2.62, 0);
    head.scale.set(0.82, 1.18, 0.88); // smooth: no face at all
    add(body, new THREE.BoxGeometry(0.008, 0.18, 0.01), blood, 0.04, 2.55, 0.19).rotation.z = 0.2; // a single crack, weeping
    // Six shattered-mirror wings, three per side, each a fan of razor shards.
    const wings = [];
    for (const side of [-1, 1]) {
      for (let tier = 0; tier < 3; tier++) {
        const wing = new THREE.Group();
        wing.position.set(side * 0.18, 2.1 - tier * 0.42, -0.2);
        const n = 7 - tier;
        for (let i = 0; i < n; i++) {
          const sh = add(wing, shardGeo(0.22 + rand() * 0.12, 0.8 - i * 0.06 - tier * 0.1, rand), mirror, side * (0.15 + i * 0.17), 0.05 + i * 0.02, -i * 0.025);
          sh.rotation.set(0.05, side > 0 ? 0 : Math.PI, side * (0.25 + i * 0.16 + tier * 0.15));
        }
        body.add(wing);
        wings.push({ wing, side, tier });
      }
    }
    // A floating crown of bleeding golden eyes.
    const crown = new THREE.Group();
    crown.position.y = 3.05;
    const eyes = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const e = new THREE.Group();
      e.position.set(Math.cos(a) * 0.36, Math.sin(i * 1.7) * 0.05, Math.sin(a) * 0.36);
      add(e, new THREE.SphereGeometry(0.055, 14, 10), gold);
      const iris = add(e, new THREE.SphereGeometry(0.03, 10, 8), basic(0xffd040, 3.5), 0, 0, 0.035);
      add(e, new THREE.SphereGeometry(0.014, 8, 6), basic(0x050000), 0, 0, 0.058);
      add(e, new THREE.BoxGeometry(0.008, 0.12, 0.006).translate(0, -0.06, 0), blood, 0, -0.03, 0.04); // a bleeding tear
      e.lookAt(Math.cos(a) * 2, 0, Math.sin(a) * 2);
      crown.add(e);
      eyes.push({ e, iris });
    }
    add(crown, new THREE.TorusGeometry(0.36, 0.012, 6, 64).rotateX(Math.PI / 2), gold);
    body.add(crown);
    const lance = add(body, new THREE.ConeGeometry(0.06, 1.1, 8).rotateX(Math.PI / 2), basic(0xfff4c0, 4), 0.35, 1.5, 0.6);
    return {
      root, height: 3.4, parts: { wings, eyes, crown },
      animate(t, dt, k) {
        body.position.y = 0.45 + Math.sin(t * 1.2) * 0.1;
        wings.forEach(({ wing, side, tier }) => {
          wing.rotation.y = side * (0.35 + Math.sin(t * 1.1 + tier) * 0.12 + k.windup * 0.6);
          wing.rotation.z = side * Math.sin(t * 0.9 + tier * 2) * 0.05;
        });
        crown.rotation.y = t * 0.5;
        crown.position.y = 3.05 + Math.sin(t * 1.7) * 0.05;
        for (const { iris } of eyes) iris.material.color.setRGB(1, 0.8, 0.25).multiplyScalar(2.5 + k.windup * 4 + Math.random() * 0.5);
        lance.visible = k.windup > 0.05 || k.strike > 0.05;
        lance.scale.setScalar(0.3 + k.windup * 1.2 + k.strike);
        mirror.emissiveIntensity = 0.25 + k.windup * 2;
      },
    };
  },

  greed() {
    const root = new THREE.Group();
    const molten = std(0xb8861c, 0.25, 1, { emissive: 0x8a4000, emissiveIntensity: 0.25, envMapIntensity: 1.6 });
    const bullion = std(0xb8862a, 0.32, 1, { envMapIntensity: 1.6 });
    const bone = std(0xb8ab8a, 0.65);
    const iron = std(0x2a2a30, 0.4, 0.9);
    const fire = basic(0xff8a20, 4);
    const body = new THREE.Group();
    root.add(body);
    // A hulking mass of slumped, melted gold.
    const mass = new THREE.SphereGeometry(0.85, 32, 24);
    {
      const p = mass.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const sag = y < 0 ? 1 + (-y) * 0.35 : 1;
        const drip = Math.max(0, Math.sin(p.getX(i) * 9) * Math.sin(p.getZ(i) * 7)) * (y < 0.2 ? 0.25 : 0);
        p.setXYZ(i, p.getX(i) * sag, y - drip, p.getZ(i) * sag * 0.9);
      }
      mass.computeVertexNormals();
    }
    add(body, mass, molten, 0, 1.15, 0);
    // Bullion bars fused into it.
    for (let i = 0; i < 14; i++) {
      const a = i * 1.1, b = add(body, new THREE.BoxGeometry(0.32, 0.12, 0.16), bullion, Math.cos(a) * 0.62, 0.7 + (i % 5) * 0.28, Math.sin(a) * 0.55);
      b.rotation.set(i * 0.4, a, i * 0.7);
    }
    // The furnace chest: a grate of fire, molten gold pouring out.
    const furnace = add(body, new THREE.CircleGeometry(0.3, 24), fire, 0, 1.2, 0.84);
    for (let i = -2; i <= 2; i++) add(body, new THREE.BoxGeometry(0.03, 0.6, 0.04), iron, i * 0.11, 1.2, 0.87);
    const pour = add(body, new THREE.CylinderGeometry(0.05, 0.09, 0.9, 10).translate(0, -0.45, 0), molten, 0, 0.95, 0.86);
    // A head: a crown-like crest, two eyes of fire.
    const head = new THREE.Group();
    head.position.set(0, 2.1, 0.2);
    add(head, new THREE.SphereGeometry(0.3, 18, 14).scale(1.2, 0.85, 1), molten);
    for (let i = 0; i < 7; i++) add(head, new THREE.ConeGeometry(0.05, 0.3, 5), bullion, Math.cos(i * 0.9) * 0.2, 0.28, Math.sin(i * 0.9) * 0.15 - 0.05);
    for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.05, 10, 8), fire, s * 0.12, 0.02, 0.27);
    body.add(head);
    // Six arms, each clutching coins.
    const arms = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const sh = new THREE.Group();
        sh.position.set(side * 0.75, 1.65 - i * 0.38, 0.15);
        add(sh, limbGeo(0.75, 0.12, 0.09), molten).rotation.z = side * 1.0;
        const hand = add(sh, new THREE.SphereGeometry(0.12, 12, 10), bullion, side * 0.62, -0.42, 0.1);
        hand.scale.set(1, 0.8, 1.2);
        body.add(sh);
        arms.push({ sh, side, i });
      }
    }
    // Chained skeletons hanging off its back.
    for (const s of [-1, 1]) {
      const sk = new THREE.Group();
      sk.position.set(s * 0.45, 1.1, -0.85);
      add(sk, new THREE.SphereGeometry(0.1, 10, 8), bone, 0, 0.35, 0);
      add(sk, limbGeo(0.5, 0.03), bone, 0, 0.25, 0);
      for (let r = 0; r < 4; r++) add(sk, new THREE.TorusGeometry(0.1 - r * 0.012, 0.01, 4, 10, Math.PI), bone, 0, 0.18 - r * 0.07, 0).rotation.x = Math.PI / 2;
      for (const a of [-1, 1]) add(sk, limbGeo(0.45, 0.02), bone, a * 0.08, 0.2, 0).rotation.z = a * 2.6;
      body.add(sk);
    }
    add(body, chainGeo([new THREE.Vector3(-0.6, 1.6, -0.6), new THREE.Vector3(-0.45, 1.5, -0.9), new THREE.Vector3(0, 1.45, -0.95), new THREE.Vector3(0.45, 1.5, -0.9), new THREE.Vector3(0.6, 1.6, -0.6)], 0.045, 0.013), iron);
    for (const s of [-1, 1]) add(body, limbGeo(0.5, 0.2, 0.17), molten, s * 0.38, 0.5, 0);
    const coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 10), bullion, 30);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 30; i++) {
      m4.makeRotationX(Math.random() * 3);
      m4.setPosition((Math.random() - 0.5) * 2, 0.02 + Math.random() * 0.05, (Math.random() - 0.5) * 2);
      coins.setMatrixAt(i, m4);
    }
    root.add(coins);
    return {
      root, height: 2.6, parts: { arms, furnace, pour },
      animate(t, dt, k) {
        body.position.y = Math.abs(Math.sin(t * (k.moving ? 5 : 1.3))) * 0.06;
        body.rotation.z = Math.sin(t * (k.moving ? 2.5 : 0.7)) * 0.05;
        arms.forEach(({ sh, side, i }) => {
          sh.rotation.x = Math.sin(t * 1.8 + i * 1.3 + side) * 0.25 - k.windup * 1.4;
          sh.rotation.z = side * (k.windup * 0.4 + Math.sin(t + i) * 0.08);
        });
        molten.emissiveIntensity = 0.25 + k.windup * 1.2 + Math.sin(t * 3) * 0.08;
        fire.color.setRGB(1, 0.55, 0.12).multiplyScalar(2.6 + Math.sin(t * 9) * 0.5 + k.windup * 2.5);
        furnace.scale.setScalar(1 + Math.sin(t * 6) * 0.05);
        pour.scale.y = 0.9 + Math.sin(t * 4) * 0.15;
        head.rotation.y = Math.sin(t * 0.5) * 0.3;
      },
    };
  },

  lust() {
    const root = new THREE.Group();
    const porcelain = phys(0xc0b4b6, { roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    const silk = std(0x8a0a2a, 0.35, 0.1, { emissive: 0x4a0018, emissiveIntensity: 0.5, side: THREE.DoubleSide });
    const thread = basic(0xff2a5a, 2.2);
    const steel = std(0x9aa0aa, 0.2, 1);
    const body = new THREE.Group();
    body.position.y = 1.1;
    root.add(body);
    // A bride's torso of porcelain, a veil of crimson silk.
    add(body, lathe([[0.02, 0], [0.22, 0.05], [0.16, 0.45], [0.2, 0.7], [0.1, 0.85], [0, 0.88]], 24), porcelain);
    const veil = add(body, new THREE.ConeGeometry(0.45, 1.3, 24, 6, true).translate(0, -0.15, 0), silk, 0, 0.55, 0);
    const vp = veil.geometry.attributes.position;
    for (let i = 0; i < vp.count; i++) if (vp.getY(i) < -0.6) vp.setY(i, vp.getY(i) - Math.random() * 0.25);
    veil.geometry.computeVertexNormals();
    // The porcelain mask, a too-wide painted smile.
    const head = new THREE.Group();
    head.position.y = 1.05;
    add(head, new THREE.SphereGeometry(0.15, 22, 16).scale(0.85, 1.15, 0.9), porcelain);
    for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.022, 8, 6), basic(0x050003), s * 0.05, 0.03, 0.12);
    add(head, new THREE.TorusGeometry(0.06, 0.006, 4, 16, Math.PI), basic(0x9a0020, 1.5), 0, -0.06, 0.125).rotation.z = Math.PI;
    body.add(head);
    // Eight arachnid legs: long, jointed, porcelain.
    const legs = [];
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1, k = i % 4;
      const hip = new THREE.Group();
      hip.position.set(side * 0.12, 0.2, -0.15 + k * 0.1);
      hip.rotation.set(0, side * (0.4 + k * 0.35) - (side < 0 ? 0 : 0), side * 1.25);
      add(hip, limbGeo(0.75, 0.035, 0.025), porcelain);
      const knee = new THREE.Group();
      knee.position.y = -0.75;
      knee.rotation.z = -side * 2.1;
      add(knee, limbGeo(1.05, 0.025, 0.008), porcelain);
      hip.add(knee);
      body.add(hip);
      legs.push({ hip, knee, side, k });
    }
    // Scissor claws on two long front arms.
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.2, 0.75, 0.05);
      add(sh, limbGeo(0.6, 0.03, 0.02), porcelain).rotation.z = s * 0.4;
      const claw = new THREE.Group();
      claw.position.set(s * 0.24, -0.55, 0.05);
      const bladeA = add(claw, new THREE.BoxGeometry(0.02, 0.5, 0.06).translate(0, -0.25, 0), steel);
      const bladeB = add(claw, new THREE.BoxGeometry(0.02, 0.5, 0.06).translate(0, -0.25, 0), steel);
      add(claw, new THREE.TorusGeometry(0.03, 0.008, 6, 12), steel);
      sh.add(claw);
      body.add(sh);
      arms.push({ sh, bladeA, bladeB, s });
    }
    // Crimson puppeteer threads rising out of sight.
    const threads = [];
    for (const [x, y, z] of [[0, 1.2, 0], [-0.2, 0.8, 0], [0.2, 0.8, 0], [-0.4, 0.5, 0.2], [0.4, 0.5, 0.2]]) {
      threads.push(add(body, new THREE.CylinderGeometry(0.003, 0.003, 4, 4).translate(0, 2, 0), thread, x, y, z));
    }
    return {
      root, height: 2.5, parts: { legs, arms, threads },
      animate(t, dt, k) {
        body.position.y = 1.1 + Math.sin(t * 1.6) * 0.12;
        body.rotation.y = Math.sin(t * 0.6) * 0.25;
        head.rotation.z = Math.sin(t * 2.3) * 0.35; // uncanny, puppet-like tilts
        legs.forEach(({ hip, knee, side, k: i }) => {
          const step = k.moving ? Math.sin(t * 8 + i * 1.6 + (side > 0 ? Math.PI : 0)) : Math.sin(t * 1.5 + i) * 0.2;
          hip.rotation.x = step * 0.35;
          knee.rotation.z = -side * (2.1 + step * 0.2);
        });
        arms.forEach(({ sh, bladeA, bladeB, s }) => {
          sh.rotation.x = -k.windup * 1.5 + Math.sin(t * 1.3 + s) * 0.15;
          const snip = 0.15 + Math.abs(Math.sin(t * (k.windup > 0.2 ? 14 : 3))) * 0.5;
          bladeA.rotation.z = snip;
          bladeB.rotation.z = -snip;
        });
        threads.forEach((th, i) => { th.rotation.z = Math.sin(t * 1.1 + i) * 0.04; });
        silk.emissiveIntensity = 0.5 + k.windup * 1.5;
      },
    };
  },

  envy() {
    const root = new THREE.Group();
    const flesh = std(0x6a7a5a, 0.55, 0, { emissive: 0x0a2a10, emissiveIntensity: 0.4 });
    const mask = phys(0xd8e8d0, { roughness: 0.25, clearcoat: 1 });
    const hollow = basic(0x020302);
    const tear = basic(0x2aff6a, 2.5);
    const body = new THREE.Group();
    root.add(body);
    // A tall, crooked, too-thin skin-walker.
    const legs = [-1, 1].map((s) => {
      const hip = new THREE.Group();
      hip.position.set(s * 0.13, 1.25, 0);
      add(hip, limbGeo(0.7, 0.06, 0.045), flesh);
      const knee = new THREE.Group();
      knee.position.y = -0.7;
      add(knee, limbGeo(0.62, 0.045, 0.03), flesh);
      hip.add(knee);
      body.add(hip);
      return { hip, knee };
    });
    const torso = add(body, new THREE.CylinderGeometry(0.2, 0.13, 1.0, 12), flesh, 0, 1.75, 0);
    torso.rotation.z = 0.18; // crooked
    for (let i = 0; i < 5; i++) add(body, new THREE.TorusGeometry(0.16 - i * 0.01, 0.012, 4, 12, Math.PI), flesh, 0.03, 1.5 + i * 0.09, 0.05).rotation.set(Math.PI / 2, 0, 0.3);
    const neck = new THREE.Group();
    neck.position.set(0.1, 2.3, 0);
    add(neck, limbGeo(0.35, 0.04, 0.03).rotateX(Math.PI), flesh);
    const head = add(neck, new THREE.SphereGeometry(0.14, 16, 12), flesh, 0, 0.42, 0);
    head.scale.set(0.8, 1.2, 0.9);
    body.add(neck);
    // Five weeping masks orbiting the neck, shifting expressions.
    const masks = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Group();
      add(m, new THREE.SphereGeometry(0.14, 16, 12, 0, Math.PI), mask).rotation.y = -Math.PI / 2;
      for (const s of [-1, 1]) {
        add(m, new THREE.SphereGeometry(0.025, 8, 6), hollow, s * 0.05, 0.03, 0.12);
        add(m, new THREE.BoxGeometry(0.008, 0.12, 0.004).translate(0, -0.06, 0), tear, s * 0.05, 0.0, 0.135);
      }
      const mouth = add(m, new THREE.TorusGeometry(0.04, 0.008, 4, 12, Math.PI), hollow, 0, -0.06, 0.13);
      neck.add(m);
      masks.push({ m, mouth, phase: (i / 5) * Math.PI * 2 });
    }
    // Long arms with too many knuckles.
    const arms = [-1, 1].map((s) => {
      const sh = new THREE.Group();
      sh.position.set(s * 0.25 + 0.08, 2.15, 0);
      add(sh, limbGeo(0.75, 0.045, 0.03), flesh);
      const el = new THREE.Group();
      el.position.y = -0.75;
      add(el, limbGeo(0.7, 0.03, 0.02), flesh);
      for (let f = 0; f < 4; f++) add(el, limbGeo(0.25, 0.008), flesh, (f - 1.5) * 0.02, -0.7, 0).rotation.z = (f - 1.5) * 0.15;
      sh.add(el);
      body.add(sh);
      return { sh, el, s };
    });
    // Parasitic tendrils writhing out of its back.
    const tendrils = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      g.position.set((i - 2.5) * 0.06, 1.7 + (i % 3) * 0.15, -0.15);
      g.rotation.set(-0.8 - (i % 2) * 0.4, (i - 2.5) * 0.4, 0);
      let parent = g;
      for (let sgm = 0; sgm < 4; sgm++) {
        const s = new THREE.Group();
        if (sgm) s.position.y = 0.22;
        add(s, new THREE.CylinderGeometry(0.02 - sgm * 0.004, 0.025 - sgm * 0.004, 0.22, 6).translate(0, 0.11, 0), flesh);
        parent.add(s);
        parent = s;
      }
      body.add(g);
      tendrils.push({ g, phase: i * 1.3 });
    }
    return {
      root, height: 2.85, parts: { masks, tendrils, arms },
      element: null,
      animate(t, dt, k) {
        const walk = k.moving ? Math.sin(t * 7) : 0;
        legs.forEach((l, i) => { l.hip.rotation.x = walk * 0.5 * (i ? 1 : -1); l.knee.rotation.x = Math.max(0, walk * (i ? -1 : 1)) * 0.6; });
        arms.forEach(({ sh, el, s }) => { sh.rotation.x = -walk * 0.35 * s - k.windup * 2; sh.rotation.z = s * (0.12 + k.windup * 0.5); el.rotation.x = -0.3 - k.windup * 0.6; });
        head.rotation.z = Math.sin(t * 3.7) * 0.25; // a mimic's twitch
        masks.forEach(({ m, mouth, phase }, i) => {
          const a = t * 0.8 + phase;
          m.position.set(Math.cos(a) * 0.3, 0.25 + Math.sin(t * 2 + i) * 0.05, Math.sin(a) * 0.3);
          m.lookAt(m.position.x * 3, m.position.y, m.position.z * 3);
          mouth.rotation.z = Math.sin(t * 1.3 + i) > 0 ? Math.PI : 0; // weeping, then smiling
        });
        tendrils.forEach(({ g, phase }) => {
          let s = g.children[0];
          let n = 0;
          while (s) { s.rotation.x = Math.sin(t * 2.2 + phase + n) * 0.35; s.rotation.z = Math.cos(t * 1.7 + phase + n) * 0.25; s = s.children.find((c) => c.isGroup); n++; }
        });
        const el = this.element ? ELEMENT_COLORS[this.element] : 0x2aff60;
        flesh.emissive.setHex(el);
        flesh.emissiveIntensity = 0.25 + k.windup * 1.2 + k.hurt * 0.8;
      },
    };
  },

  gluttony() {
    const root = new THREE.Group();
    const flesh = std(0x5a6a24, 0.5, 0, { emissive: 0x1a2a00, emissiveIntensity: 0.35 });
    const chitin = phys(0x2a2a14, { roughness: 0.25, clearcoat: 0.8 });
    const gums = std(0x5a0a14, 0.35);
    const teeth = std(0xe0d4b0, 0.35);
    const abyss = basic(0x010000);
    const drool = basic(0x9aff3a, 2.4);
    const body = new THREE.Group();
    root.add(body);
    // A distended, segmented centipede body, rearing up at the front.
    const segs = [];
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Group();
      const r = 0.55 - Math.abs(i - 2) * 0.035;
      s.position.set(0, 0.55 + Math.max(0, 3 - i) * 0.32, 0.5 - i * 0.42);
      add(s, new THREE.SphereGeometry(r, 18, 14).scale(1.1, 0.9, 0.85), i < 3 ? flesh : chitin);
      add(s, new THREE.TorusGeometry(r * 0.95, 0.04, 6, 24), chitin).rotation.y = Math.PI / 2;
      // Two short legs per segment.
      for (const side of [-1, 1]) {
        const leg = add(s, limbGeo(0.55, 0.05, 0.02), chitin, side * r * 0.9, -0.1, 0);
        leg.rotation.z = side * 0.9;
        leg.userData.side = side;
      }
      body.add(s);
      segs.push(s);
    }
    // The torso splits vertically into a ringed abyssal maw of rotating teeth.
    const maw = new THREE.Group();
    maw.position.set(0, 1.55, 0.72);
    const lips = [-1, 1].map((s) => {
      const lip = new THREE.Group();
      add(lip, new THREE.SphereGeometry(0.62, 20, 14, s < 0 ? 0 : Math.PI, Math.PI).scale(0.5, 1.1, 0.4), gums);
      maw.add(lip);
      return { lip, s };
    });
    add(maw, new THREE.CircleGeometry(0.45, 32), abyss, 0, 0, -0.05);
    const rings = [];
    for (let r = 0; r < 3; r++) {
      const ring = new THREE.Group();
      ring.position.z = -0.02 - r * 0.08;
      const n = 18 - r * 4, rad = 0.42 - r * 0.11;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const tooth = add(ring, new THREE.ConeGeometry(0.03 - r * 0.004, 0.16 - r * 0.02, 5), teeth, Math.cos(a) * rad, Math.sin(a) * rad, 0);
        tooth.rotation.z = a + Math.PI / 2;
        tooth.rotation.x = 0.5;
      }
      maw.add(ring);
      rings.push(ring);
    }
    const drips = [];
    for (let i = 0; i < 6; i++) drips.push(add(maw, new THREE.SphereGeometry(0.035, 6, 4), drool, (i - 2.5) * 0.12, -0.4, 0.05));
    body.add(maw);
    return {
      root, height: 2.8, parts: { segs, rings, lips },
      animate(t, dt, k) {
        segs.forEach((s, i) => {
          s.position.x = Math.sin(t * (k.moving ? 4 : 1) - i * 0.6) * 0.12;
          s.rotation.y = Math.cos(t * (k.moving ? 4 : 1) - i * 0.6) * 0.15;
          for (const c of s.children) if (c.userData.side) c.rotation.x = Math.sin(t * 10 + i) * (k.moving ? 0.5 : 0.1);
        });
        const open = 0.18 + k.windup * 0.7 + k.strike * 0.4 + Math.sin(t * 1.4) * 0.04;
        lips.forEach(({ lip, s }) => { lip.position.x = s * open * 0.45; lip.rotation.y = s * open * 0.7; });
        rings.forEach((r, i) => { r.rotation.z = t * (i % 2 ? -1.2 : 0.9) * (1 + k.windup * 2); });
        drips.forEach((d, i) => { d.position.y = -0.4 - ((t * 0.6 + i * 0.3) % 1) * 0.8; });
        flesh.emissiveIntensity = 0.35 + k.windup * 0.8;
      },
    };
  },

  wrath() {
    const root = new THREE.Group();
    const flayed = std(0x6a0e08, 0.45, 0, { emissive: 0x2a0200, emissiveIntensity: 0.6 });
    const sinew = std(0xa82a1a, 0.4, 0, { emissive: 0x4a0a00, emissiveIntensity: 0.4 });
    const horn = std(0x1a0a06, 0.35);
    const hotIron = std(0x401008, 0.45, 0.8, { emissive: 0xff3a0a, emissiveIntensity: 1.6 });
    const molten = basic(0xff5a10, 4);
    const steam = new THREE.MeshBasicMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.25, depthWrite: false });
    const body = new THREE.Group();
    root.add(body);
    const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 12);
    // Massive digitigrade legs with hooves.
    const legs = [-1, 1].map((s) => {
      const hip = new THREE.Group();
      hip.position.set(s * 0.3, 1.25, 0);
      add(hip, cap(0.17, 0.5), flayed, 0, -0.3, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.62;
      add(knee, cap(0.12, 0.45), flayed, 0, -0.27, 0.05);
      add(knee, new THREE.CylinderGeometry(0.14, 0.17, 0.14, 10), horn, 0, -0.6, 0.08); // a hoof
      hip.add(knee);
      body.add(hip);
      return { hip, knee };
    });
    // A huge flayed torso: muscle striations, a chest bound in red-hot chains.
    const chest = add(body, cap(0.5, 0.45), flayed, 0, 1.95, 0);
    chest.scale.set(1.35, 1, 0.8);
    for (let i = 0; i < 12; i++) {
      const st = add(body, new THREE.BoxGeometry(0.035, 0.6, 0.02), sinew, -0.5 + i * 0.09, 1.95, 0.39);
      st.rotation.z = (i - 6) * 0.06;
    }
    add(body, chainGeo([new THREE.Vector3(-0.68, 2.35, 0), new THREE.Vector3(-0.2, 2.0, 0.45), new THREE.Vector3(0.3, 1.65, 0.42), new THREE.Vector3(0.66, 1.45, 0)], 0.06, 0.018), hotIron);
    add(body, chainGeo([new THREE.Vector3(0.68, 2.35, 0), new THREE.Vector3(0.2, 2.0, 0.45), new THREE.Vector3(-0.3, 1.65, 0.42), new THREE.Vector3(-0.66, 1.45, 0)], 0.06, 0.018), hotIron);
    for (const s of [-1, 1]) add(body, new THREE.SphereGeometry(0.3, 14, 12), flayed, s * 0.72, 2.45, 0);
    // A bull's skull of a head: horns, burning eyes, steam venting from cracks.
    const head = new THREE.Group();
    head.position.set(0, 2.75, 0.3);
    add(head, new THREE.SphereGeometry(0.28, 18, 14).scale(0.9, 0.95, 1.2), flayed);
    add(head, new THREE.BoxGeometry(0.28, 0.18, 0.3), flayed, 0, -0.12, 0.25);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 8, 16, Math.PI * 0.7), horn);
      h.position.set(s * 0.22, 0.15, -0.05);
      h.rotation.set(0, s * 0.3, s > 0 ? 0.4 : Math.PI - 0.4);
      head.add(h);
      add(head, new THREE.SphereGeometry(0.045, 10, 8), molten, s * 0.12, 0.05, 0.3);
    }
    const vents = [];
    for (let i = 0; i < 3; i++) vents.push(add(head, new THREE.ConeGeometry(0.1, 0.6, 10, 1, true).translate(0, 0.3, 0), steam, (i - 1) * 0.1, 0.25, -0.05));
    body.add(head);
    // Arms wielding twin molten cleavers.
    const arms = [-1, 1].map((s) => {
      const sh = new THREE.Group();
      sh.position.set(s * 0.82, 2.4, 0);
      add(sh, cap(0.15, 0.45), flayed, 0, -0.32, 0);
      const el = new THREE.Group();
      el.position.y = -0.68;
      add(el, cap(0.12, 0.42), flayed, 0, -0.26, 0);
      add(el, new THREE.TorusGeometry(0.14, 0.03, 6, 14), hotIron, 0, -0.1, 0).rotation.x = Math.PI / 2; // a shackle
      const cleaver = new THREE.Group();
      cleaver.position.set(0, -0.6, 0.12);
      add(cleaver, new THREE.BoxGeometry(0.06, 0.35, 0.06), horn, 0, 0, 0);
      add(cleaver, new THREE.BoxGeometry(0.05, 0.85, 0.42).translate(0, -0.5, 0.12), hotIron);
      add(cleaver, new THREE.BoxGeometry(0.054, 0.8, 0.03).translate(0, -0.52, 0.34), molten); // the glowing edge
      el.add(cleaver);
      sh.add(el);
      body.add(sh);
      return { sh, el, s };
    });
    return {
      root, height: 3.1, parts: { arms, vents, head },
      animate(t, dt, k) {
        const fast = k.state === 'charge';
        const walk = k.moving ? Math.sin(t * (fast ? 15 : 8)) : 0;
        legs.forEach((l, i) => { l.hip.rotation.x = walk * 0.6 * (i ? 1 : -1); l.knee.rotation.x = Math.max(0, walk * (i ? -1 : 1)) * 0.7; });
        body.rotation.x = fast ? 0.45 : k.windup * 0.3;
        arms.forEach(({ sh, el, s }) => {
          sh.rotation.x = -walk * 0.45 * s - k.windup * 2.4 + k.strike * 2.4;
          sh.rotation.z = s * 0.2;
          el.rotation.x = -0.4 - k.windup * 0.6;
        });
        // It burns hotter as it bleeds.
        flayed.emissiveIntensity = 0.6 + (1 - k.hpK) * 1.4 + Math.sin(t * 10) * 0.1;
        hotIron.emissiveIntensity = 1.6 + (1 - k.hpK) * 2 + k.windup * 2;
        vents.forEach((v, i) => {
          const p = (t * 0.9 + i * 0.33) % 1;
          v.scale.set(0.6 + p, 0.5 + p * 1.5, 0.6 + p);
          v.material.opacity = 0.3 * (1 - p) * (0.6 + (1 - k.hpK));
        });
      },
    };
  },

  sloth() {
    const root = new THREE.Group();
    const corpse = std(0x6a7280, 0.85, 0, { emissive: 0x0a1020, emissiveIntensity: 0.3 });
    const brass = std(0x8a6a2a, 0.3, 1);
    const iron = std(0x2a2a30, 0.5, 0.9);
    const lids = std(0x101418, 0.5, 0, { emissive: 0x6a8aff, emissiveIntensity: 0.3 });
    const mist = new THREE.MeshBasicMaterial({ color: 0x050508, transparent: true, opacity: 0.4, depthWrite: false });
    const body = new THREE.Group();
    root.add(body);
    // The broken pendulum clockwork cage.
    const cage = new THREE.Group();
    cage.position.y = 0.2;
    for (let i = 0; i < 10; i++) {
      if (i === 3 || i === 7) continue; // broken bars
      const a = (i / 10) * Math.PI * 2;
      add(cage, new THREE.CylinderGeometry(0.03, 0.03, 3.2, 6), brass, Math.cos(a) * 1.0, 1.6, Math.sin(a) * 1.0);
    }
    for (const y of [0.05, 3.15]) add(cage, new THREE.TorusGeometry(1.0, 0.05, 6, 40).rotateX(Math.PI / 2), brass, 0, y, 0);
    const gears = [];
    for (let i = 0; i < 4; i++) {
      const gear = new THREE.Group();
      gear.position.set(Math.cos(i * 1.6) * 1.0, 0.6 + i * 0.7, Math.sin(i * 1.6) * 1.0);
      gear.lookAt(0, gear.position.y, 0);
      add(gear, new THREE.TorusGeometry(0.22 - i * 0.03, 0.03, 6, 20), brass);
      for (let tth = 0; tth < 10; tth++) {
        const a = (tth / 10) * Math.PI * 2;
        add(gear, new THREE.BoxGeometry(0.05, 0.05, 0.04), brass, Math.cos(a) * (0.25 - i * 0.03), Math.sin(a) * (0.25 - i * 0.03), 0);
      }
      cage.add(gear);
      gears.push(gear);
    }
    const pendulum = new THREE.Group();
    pendulum.position.y = 3.1;
    add(pendulum, new THREE.CylinderGeometry(0.015, 0.015, 2.4, 6).translate(0, -1.2, 0), brass);
    add(pendulum, new THREE.CylinderGeometry(0.3, 0.3, 0.04, 24).rotateX(Math.PI / 2).translate(0, -2.45, 0), brass);
    cage.add(pendulum);
    body.add(cage);
    // The floating corpse-giant, curled in sleep, chained.
    const giant = new THREE.Group();
    giant.position.y = 1.8;
    const mass = add(giant, lathe([[0.1, -0.9], [0.55, -0.6], [0.62, 0], [0.5, 0.5], [0.3, 0.8], [0, 0.9]], 24), corpse);
    mass.scale.z = 0.8;
    const head = add(giant, new THREE.SphereGeometry(0.3, 18, 14), corpse, 0, 1.05, 0.15);
    head.scale.set(0.9, 1.05, 1);
    for (const s of [-1, 1]) add(giant, new THREE.SphereGeometry(0.06, 10, 8).scale(1, 0.2, 1), lids, s * 0.11, 1.08, 0.43); // closed, dreaming
    const mouth = add(giant, new THREE.CircleGeometry(0.07, 16), basic(0x000000), 0, 0.95, 0.44);
    for (const s of [-1, 1]) add(giant, limbGeo(1.0, 0.12, 0.08), corpse, s * 0.5, 0.5, 0.1).rotation.set(0.5, 0, s * 0.3);
    for (const [a, b] of [[[-0.9, 3.0, 0.6], [-0.3, 0.6, 0.3]], [[0.9, 3.0, -0.6], [0.3, 0.6, 0.0]], [[-0.9, 0.3, -0.5], [-0.3, -0.5, 0.0]], [[0.9, 0.3, 0.5], [0.3, -0.5, 0.2]]]) {
      add(body, chainGeo([new THREE.Vector3(...a), new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1] + 1.8 * 2) / 2 - 0.4, (a[2] + b[2]) / 2), new THREE.Vector3(b[0], b[1] + 1.8, b[2])], 0.05, 0.014), iron);
    }
    // Heavy iron weights dragging beneath.
    const weights = [];
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Group();
      w.position.set((i - 1) * 0.5, 0.3, 0.2 + (i % 2) * 0.3);
      add(w, new THREE.CylinderGeometry(0.16, 0.2, 0.3, 12), iron);
      add(w, new THREE.CylinderGeometry(0.006, 0.006, 1.2, 4).translate(0, 0.75, 0), iron);
      body.add(w);
      weights.push(w);
    }
    body.add(giant);
    // Black narcotic mist exhaled from its mouth.
    const puffs = [];
    for (let i = 0; i < 6; i++) {
      const p = add(body, new THREE.SphereGeometry(0.2, 10, 8), mist, 0, 2.75, 0.5);
      puffs.push({ p, phase: i / 6 });
    }
    return {
      root, height: 3.4, parts: { cage, pendulum, weights, puffs, giant },
      animate(t, dt, k) {
        giant.position.y = 1.8 + Math.sin(t * 0.6) * 0.15;
        giant.rotation.y = Math.sin(t * 0.2) * 0.3;
        pendulum.rotation.z = Math.sin(t * 0.9) * 0.35 * (1 - k.windup * 0.5);
        gears.forEach((g, i) => { g.rotateZ(dt * (i % 2 ? -0.4 : 0.6)); });
        weights.forEach((w, i) => { w.rotation.z = Math.sin(t * 0.7 + i) * 0.15; });
        lids.emissiveIntensity = 0.3 + k.windup * 3;
        mouth.scale.setScalar(1 + k.windup * 1.5 + Math.sin(t * 0.8) * 0.2);
        puffs.forEach(({ p, phase }) => {
          const q = (t * 0.25 + phase) % 1;
          p.position.set(Math.sin(phase * 9) * q * 0.6, 2.75 + q * 0.6 - k.windup * 0.4, 0.5 + q * 0.9);
          p.scale.setScalar(0.5 + q * 2.5 * (1 + k.windup));
          p.material.opacity = 0.45 * (1 - q);
        });
      },
    };
  },
};

const ELEMENT_COLORS = { black: 0x7a3cff, fire: 0xff5a1f, water: 0x2fa8ff, earth: 0x8bb33a, wind: 0x9ef0e0, white: 0xfff6d8, void: 0x9aa3ad };

/** Build a Sin's model by id. */
export function buildSinModel(sin) {
  const make = SIN_MODELS[sin];
  if (!make) throw new Error(`no model for ${sin}`);
  return make();
}
