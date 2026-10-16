// Step 9: the seven wizards as handsome dark-fantasy mages. A sculpted head
// (a sphere deformed into a chiselled jaw, cheekbones, a nose bridge, a brow
// ridge and eye sockets), luminous elemental eyes with iris rings and
// catchlights, determined brows, and a distinct layered hairstyle per wizard
// (strands built as bent, tapered cones, merged into one mesh per layer, with
// gradient sheen and optional glowing tips). A tailored high-collar longcoat
// over a waistcoat, a silk cravat in the element's colour, metal pauldrons
// with a draped chain, split coattails, fitted trousers and tall boots,
// articulated hands with an elemental signet ring, and a carved wand.
//
// Only depends on `three`, so the in-game avatars, the lobby showcase and the
// vanity camera share it, and node tests can build every wizard.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Per-wizard looks: hair, eyes, attire. */
export const WIZARD_LOOKS = {
  injorath: { hair: 0x0e0b14, sheen: 1.35, eye: 0xb44dff, eye2: 0xff2a6a, style: 'undercut', coat: 0x120c18, vest: 0x2a1438, skin: 0xe2c4ae },
  parthius: { hair: 0x7a2c0e, sheen: 1.5, tip: 0xff7a1a, eye: 0xffa030, style: 'swept', coat: 0x1c0d08, vest: 0x4a1408, skin: 0xe8c2a2 },
  himandriel: { hair: 0x9ab8d8, sheen: 1.3, eye: 0x2a8aff, style: 'flowing', coat: 0x0a1222, vest: 0x123050, skin: 0xead2c0 },
  sushantus: { hair: 0x4a2e16, sheen: 1.4, eye: 0x2ad46a, style: 'wavy', coat: 0x0e140a, vest: 0x24361a, skin: 0xc89a78 },
  kartavian: { hair: 0xe4ecf2, sheen: 1.15, eye: 0x2ad8cc, style: 'windswept', coat: 0x0c1414, vest: 0x1a3434, skin: 0xe6ccb8 },
  soham: { hair: 0xe0b850, sheen: 1.35, eye: 0xffd24a, style: 'layered', halo: true, coat: 0x18140c, vest: 0x4a3a12, skin: 0xe8cdb2 },
  himanshu: { hair: 0x8c939c, sheen: 1.3, eye: 0xff2030, eye2: 0x6a0010, style: 'spiky', headband: true, coat: 0x0a0a0c, vest: 0x2a0a0e, skin: 0xd8b8a0 },
};

/** A deterministic little RNG per wizard, so each one's hair is always the same. */
function rng(seed) {
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A heroic head: a unit sphere sculpted into jaw, cheekbones, nose, brow and sockets (≈0.25 m tall). */
export function sculptHead() {
  const g = new THREE.SphereGeometry(1, 48, 40);
  const p = g.attributes.position;
  const colors = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let X = x * 0.8, Y = y * 1.1, Z = z * 0.92;
    const front = Math.max(0, z);
    // A sharp, tapering jaw and a strong chin.
    if (y < 0) {
      const k = Math.min(1, -y / 0.95);
      X *= 1 - 0.4 * k * k;
      Z *= 1 - 0.12 * k;
      Z += 0.1 * k * k * front;
      if (y < -0.55) X *= 1 - 0.3 * smooth(-0.55, -1, y) * (1 - front * 0.4); // the chin, squared off
    }
    // Defined cheekbones.
    const cheek = Math.exp(-((y - 0.02) ** 2) / 0.018) * front * Math.abs(x);
    X += Math.sign(x) * 0.07 * cheek;
    // Hollow under the cheekbones.
    X -= Math.sign(x) * 0.05 * Math.exp(-((y + 0.28) ** 2) / 0.02) * front * Math.abs(x);
    // Brow ridge.
    Z += 0.075 * Math.exp(-((y - 0.3) ** 2) / 0.006) * front ** 3;
    // Eye sockets.
    for (const s of [-1, 1]) Z -= 0.075 * Math.exp(-(((x - s * 0.34) ** 2) + (y - 0.17) ** 2) / 0.012) * front;
    // The nose: a straight sculpted bridge to a defined tip.
    const ridge = Math.exp(-(x * x) / 0.005) * smooth(-0.32, -0.12, y) * (1 - smooth(0.22, 0.34, y)) * front ** 4;
    Z += 0.17 * ridge * (1 + 0.6 * smooth(0.1, -0.2, y));
    // Lips and philtrum, just a touch.
    Z += 0.02 * Math.exp(-((y + 0.42) ** 2) / 0.004) * Math.exp(-(x * x) / 0.04) * front ** 4;
    // Temples in, the back of the skull rounder.
    X *= 1 - 0.06 * Math.exp(-((y - 0.4) ** 2) / 0.05) * front;
    if (z < 0) Z *= 1.04;
    p.setXYZ(i, X, Y, Z);
    // Baked shading: deeper in the sockets, under the cheekbones, the nose and the jaw.
    let ao = 1;
    for (const sx of [-1, 1]) ao -= 0.35 * Math.exp(-(((x - sx * 0.34) ** 2) + (y - 0.15) ** 2) / 0.01) * front;
    ao -= 0.18 * Math.exp(-((y + 0.3) ** 2) / 0.012) * front * Math.abs(x) * 2;
    ao -= 0.25 * Math.exp(-(x * x) / 0.01 - ((y + 0.3) ** 2) / 0.004) * front;
    ao -= 0.3 * smooth(-0.6, -0.95, y) * (1 - front);
    ao += 0.06 * Math.exp(-((y - 0.02) ** 2) / 0.02) * front * Math.abs(x); // cheekbone highlight
    colors.push(ao, ao * 0.97, ao * 0.96);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** The face's surface depth (head-local, after scaling) at (x, y): where to set the eyes. */
function faceDepth(geo, scale, x, y) {
  const p = geo.attributes.position;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < p.count; i++) {
    const d = Math.hypot(p.getX(i) * scale - x, p.getY(i) * scale - y);
    if (p.getZ(i) > 0 && d < bestD) { bestD = d; best = p.getZ(i) * scale; }
  }
  return best;
}

// ---- hair -------------------------------------------------------------------------
// Head-local space: the head's centre at the origin (eye level is y ≈ 0.02),
// +z is the face. The skull is an ellipsoid of these radii:
const SKULL = { x: 0.098, y: 0.13, z: 0.112, cy: 0.012 };

/** A point on the skull from the crown: theta 0 = top; phi 0 = the face, ±π/2 = the ears. Also its outward normal. */
function onSkull(theta, phi, lift = 0.004) {
  const n = new THREE.Vector3(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi));
  const p = new THREE.Vector3(n.x * (SKULL.x + lift), n.y * (SKULL.y + lift) + SKULL.cy, n.z * (SKULL.z + lift));
  const normal = new THREE.Vector3(n.x / SKULL.x, n.y / SKULL.y, n.z / SKULL.z).normalize();
  return { p, normal };
}

/**
 * The hair mass: a sphere sculpted over the skull, with a curved hairline
 * (higher in the middle), tucked away from the face, shaved at the sides
 * (undercut), lifted on top, and drawn down the back and sides for long hair.
 */
const MASS = {
  undercut: { vol: 1.1, top: 1.1, hairline: 0.5, shave: true, length: 0, sides: 0 },
  swept: { vol: 1.1, top: 1.08, hairline: 0.62, length: 0.08, sides: 0 },
  flowing: { vol: 1.12, top: 1.06, hairline: 0.48, length: 0.75, sides: 0.55 },
  wavy: { vol: 1.15, top: 1.08, hairline: 0.5, length: 0.25, sides: 0.2 },
  windswept: { vol: 1.12, top: 1.06, hairline: 0.5, length: 0.2, sides: 0.1, lean: 0.12 },
  layered: { vol: 1.13, top: 1.06, hairline: 0.42, length: 0.45, sides: 0.35 },
  spiky: { vol: 1.08, top: 1.05, hairline: 0.55, shave: true, length: 0, sides: 0 },
};
function hairMass(style) {
  const c = MASS[style] ?? MASS.wavy;
  const g = new THREE.SphereGeometry(1, 44, 34);
  const p = g.attributes.position;
  const col = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let vol = c.vol;
    let X = x * SKULL.x, Y = y * SKULL.y, Z = z * SKULL.z;
    if (y > 0) Y *= c.top;
    // The face: tuck everything below a curved hairline inside the skull.
    const hairline = c.hairline - 0.35 * x * x;
    const face = z > 0.2 && y < hairline;
    if (face) vol = 0.9;
    // An undercut: the sides and back shaved close below the crown.
    if (c.shave && y < 0.25 && !face) vol = 1.015;
    // Ears stay clear (unless long hair covers them).
    if (Math.abs(x) > 0.75 && y < 0.15 && y > -0.35 && z > -0.4 && c.sides < 0.3 && !face) vol = Math.min(vol, 0.92);
    X *= vol; Y *= vol; Z *= vol;
    // Long hair: the back and sides fall toward the shoulders.
    if (!face && y < 0.25) {
      const k = smooth(0.25, -0.9, y);
      const behind = smooth(0.35, -0.6, z);
      const sideK = Math.abs(x) > 0.5 && z < 0.55 ? c.sides : 0;
      Y -= k * Math.max(c.length * behind, sideK) * 0.32;
      X *= 1 + k * 0.12 * Math.max(behind, sideK > 0 ? 1 : 0);
      Z -= k * 0.04 * behind;
    }
    if (c.lean) X += c.lean * SKULL.x * Math.max(0, y + 0.2) * (z < 0.5 ? 1 : 0.5);
    p.setXYZ(i, X, Y + SKULL.cy, Z);
    const shade = face ? 0 : 0.7 + 0.5 * Math.max(0, y); // the crown catches the light
    col.push(shade, shade, shade);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Is this root behind the hairline (never on the face)? */
const behindHairline = (theta, phi) => !(Math.cos(phi) > 0.35 && theta > 0.62);

/**
 * A strand grown from a root: out along the scalp normal, then along `dir`,
 * sagging under `gravity` (and swirling by `wave`): a tapered tube.
 */
function growStrand(root, normal, dir, len, r, gravity = 0, wave = 0, rand = Math.random, lift = 0.28) {
  // Never into the skull: strip the inward part of the direction.
  const d = dir.clone().normalize();
  const inward = d.dot(normal);
  if (inward < 0) d.addScaledVector(normal, -inward).normalize();
  const p0 = root.clone();
  const p1 = root.clone().addScaledVector(normal, len * lift).addScaledVector(d, len * 0.22);
  const p2 = p1.clone().addScaledVector(d, len * 0.45).add(new THREE.Vector3(0, -gravity * len * 0.45, 0));
  const p3 = p2.clone().addScaledVector(d, len * 0.3).add(new THREE.Vector3(wave * (rand() - 0.5), -gravity * len * 0.6, wave * (rand() - 0.5)));
  const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
  const SEG = 10, RAD = 5;
  const g = new THREE.TubeGeometry(curve, SEG, r, RAD, false);
  const pos = g.attributes.position;
  const col = [];
  const c = new THREE.Vector3();
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    curve.getPointAt(t, c);
    const k = 1 - t * 0.92; // taper to a point
    for (let j = 0; j <= RAD; j++) {
      const idx = i * (RAD + 1) + j;
      pos.setXYZ(idx, c.x + (pos.getX(idx) - c.x) * k, c.y + (pos.getY(idx) - c.y) * k * 0.7, c.z + (pos.getZ(idx) - c.z) * k);
      const shade = 0.62 + 0.62 * t; // a darker root, sheen toward the tip
      col.push(shade, shade, shade);
    }
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.userData.tip = curve.getPointAt(1);
  g.userData.tipDir = curve.getTangentAt(1);
  return g;
}

/** Strands per hairstyle, and (for Parthius) the glowing ember tips. */
function hairstyle(style, rand) {
  const main = [], tips = [];
  const R = (a, b) => a + rand() * (b - a);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  let lift = 0.28;
  const grow = (theta, phi, dir, len, r, gravity, wave = 0) => {
    const { p, normal } = onSkull(theta, phi, 0.012); // on the hair mass, not the skull
    const g = growStrand(p, normal, dir, len, r * 1.6, gravity, wave, rand, lift);
    main.push(g);
    return g;
  };
  // Cover the crown evenly: rings of roots from the top down to the hairline.
  const crown = (rings, perRing, maxTheta, fn) => {
    for (let ri = 0; ri < rings; ri++) {
      const theta = (ri + 0.5) / rings * maxTheta;
      const n = Math.max(2, Math.round(perRing * 0.6 * Math.sin(theta) + 1));
      for (let k = 0; k < n; k++) {
        const phi = (k / n) * Math.PI * 2 + R(-0.2, 0.2) + ri * 0.4;
        if (!behindHairline(theta, phi)) continue;
        fn(theta, phi);
      }
    }
  };
  switch (style) {
    case 'undercut': {
      // Tousled top swept forward and to the side; short faded sides.
      lift = 0.14;
      crown(4, 8, 1.0, (th, ph) => grow(th, ph, V(-0.3 + R(-0.2, 0.2), 0.05, 0.9), R(0.1, 0.14), R(0.017, 0.022), 0.45, 0.01));
      // Bangs falling over the left eye (to the cheekbone, no further).
      lift = 0.1;
      for (let i = 0; i < 6; i++) grow(R(0.5, 0.62), R(-0.3, 0.2), V(-0.5, -0.45, 0.6), R(0.13, 0.16), R(0.014, 0.018), 0.5, 0.01);
      break;
    }
    case 'swept': {
      lift = 0.08;
      // Swept straight back from a high hairline, lying close, lifting at the ends; ember tips.
      crown(5, 10, 1.25, (th, ph) => {
        const back = V(Math.sin(ph) * 0.25, -0.15, -1);
        const g = grow(th, ph, back, R(0.13, 0.19), R(0.017, 0.022), 0.25 + th * 0.2, 0.008);
        if (rand() < 0.55) {
          const tip = new THREE.ConeGeometry(0.006, 0.035, 5).translate(0, 0.0175, 0);
          tip.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), g.userData.tipDir.clone().normalize()));
          tip.translate(g.userData.tip.x, g.userData.tip.y, g.userData.tip.z);
          tips.push(tip);
        }
      });
      break;
    }
    case 'flowing': {
      // Parted in the middle: falls to each side behind the ears, down past the jaw to the shoulders.
      lift = 0.05;
      crown(5, 10, 1.45, (th, ph) => {
        const side = Math.sign(Math.sin(ph) || 1);
        grow(th, ph, V(side * 0.45, -0.35, -0.3), R(0.3, 0.4), R(0.016, 0.02), 1.5, 0.012);
      });
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) grow(R(0.62, 0.78), side * R(1.0, 1.3), V(side * 0.2, -1, 0.1), R(0.28, 0.34), 0.016, 1.6, 0.008); // framing locks beside the temples
      break;
    }
    case 'wavy': {
      lift = 0.1;
      crown(5, 10, 1.45, (th, ph) => grow(th, ph, V(Math.sin(ph) * 0.8, 0.1, Math.cos(ph) * 0.6 - 0.2), R(0.13, 0.18), R(0.018, 0.023), 0.6, 0.04));
      break;
    }
    case 'windswept': {
      lift = 0.1;
      // Everything streams back and to the right, as if in a gale.
      crown(5, 10, 1.35, (th, ph) => grow(th, ph, V(0.65, 0.15, -0.8), R(0.17, 0.25), R(0.015, 0.02), 0.05, 0.03));
      for (let i = 0; i < 5; i++) grow(R(0.5, 0.62), R(-0.4, 0.3), V(0.85, 0.25, 0.2), R(0.15, 0.2), 0.014, 0.1, 0.02); // the fringe blown aside
      break;
    }
    case 'layered': {
      lift = 0.07;
      // Soft, layered, shoulder-grazing gold; a short parted fringe.
      crown(6, 10, 1.45, (th, ph) => grow(th, ph, V(Math.sin(ph) * 0.7, 0.05, Math.cos(ph) * 0.3 - 0.45), R(0.14, 0.24), R(0.017, 0.022), 0.85, 0.02));
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) grow(R(0.48, 0.6), side * R(0.1, 0.45), V(side * 0.8, -0.3, 0.45), R(0.11, 0.14), 0.014, 0.6, 0.01);
      break;
    }
    case 'spiky': {
      lift = 0.35;
      // Stark spikes standing out and up, a few falling forward.
      crown(5, 9, 1.35, (th, ph) => {
        const { normal } = onSkull(th, ph);
        grow(th, ph, normal.clone().add(V(0, 0.5, -0.15)), R(0.12, 0.19), R(0.022, 0.03), -0.25, 0);
      });
      for (let i = 0; i < 4; i++) grow(R(0.4, 0.55), R(-0.5, 0.5), V(0, -0.2, 1), R(0.1, 0.13), 0.02, 0.2, 0);
      break;
    }
  }
  return { main, tips };
}

/** A fresnel rim light on any standard material: edges glow in `color`. */
export function rimLight(material, color, strength = 0.8) {
  const uRim = { value: new THREE.Color(color) };
  const uStrength = { value: strength };
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = uRim;
    sh.uniforms.uRimStrength = uStrength;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uRimStrength;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float rimF = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
totalEmissiveRadiance += uRim * rimF * uRimStrength;`);
  };
  material.customProgramCacheKey = () => `rim-${strength}`;
  material.userData.rim = { uRim, uStrength };
  return material;
}

/**
 * Fewer draw calls: within each group, merge the direct child meshes that share
 * a material (and aren't kept apart for animation) into one mesh.
 */
export function mergeByMaterial(root, keep = new Set()) {
  const groups = [];
  root.traverse((o) => { if (o.children.length) groups.push(o); });
  for (const g of groups) {
    const buckets = new Map();
    for (const c of g.children) {
      if (!c.isMesh || c.children.length || keep.has(c) || c.isInstancedMesh) continue;
      if (!buckets.has(c.material)) buckets.set(c.material, []);
      buckets.get(c.material).push(c);
    }
    for (const [material, list] of buckets) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
        if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
        return geo.applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = list[0].castShadow;
      mesh.receiveShadow = list[0].receiveShadow;
      for (const m of list) g.remove(m);
      g.add(mesh);
    }
  }
}

const lathe = (pts, seg = 24, phiStart = 0, phiLength = Math.PI * 2) =>
  new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLength);

/**
 * Build one wizard.
 * @param wizard { id, color, lightTint? } (from shared/wizards.js)
 * @returns parts the avatars animate: { group, body, head, hair, legs[], armL, armR, wand, tip, tipMat,
 *   coattails[], cravatTail, mats[], parts }
 */
export function buildWizardModel(wizard, { rim = true } = {}) {
  const look = WIZARD_LOOKS[wizard.id] ?? WIZARD_LOOKS.injorath;
  const color = new THREE.Color(wizard.color);
  const rand = rng(wizard.id);
  const mats = [];
  const mat = (m) => { mats.push(m); return m; };
  const std = (c, rough, metal = 0, extra = {}) => mat(new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, ...extra }));

  const skin = std(look.skin, 0.52);
  if (rim) rimLight(skin, color.clone().multiplyScalar(0.2), 0.7);
  const faceSkin = std(look.skin, 0.5, 0, { vertexColors: true });
  if (rim) rimLight(faceSkin, color.clone().multiplyScalar(0.2), 0.7);
  const coat = std(look.coat, 0.62, 0.05);
  if (rim) rimLight(coat, color.clone().multiplyScalar(0.35), 0.9);
  const lining = std(color.clone().multiplyScalar(0.3), 0.4, 0, { side: THREE.DoubleSide });
  const vest = std(look.vest, 0.5, 0.1);
  const silk = std(color.clone().lerp(new THREE.Color(0xffffff), 0.1), 0.28, 0.1, { emissive: color, emissiveIntensity: 0.12 });
  const gold = std(0xd8a848, 0.28, 1);
  const gunmetal = std(0x3a3c44, 0.32, 0.95);
  const trousers = std(0x0a090c, 0.7);
  const leather = std(0x120c0a, 0.4, 0.1);
  const hair = std(look.hair, 0.5, 0, { vertexColors: true });
  if (rim) rimLight(hair, new THREE.Color(look.hair).multiplyScalar(0.6), 1.2);
  const wood = std(0x2a160c, 0.45);
  const sclera = mat(new THREE.MeshStandardMaterial({ color: 0xf2eee8, roughness: 0.25 }));
  const iris = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(look.eye).multiplyScalar(3.4) })); // luminous: it blooms
  const iris2 = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(look.eye2 ?? look.eye).multiplyScalar(3.4) }));
  const dark = mat(new THREE.MeshBasicMaterial({ color: 0x050307 }));
  const glint = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2.5) }));
  const brow = std(new THREE.Color(look.hair).multiplyScalar(0.8), 0.8);
  const tipMat = new THREE.MeshBasicMaterial({ color });

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const parts = {};
  const add = (parent, geo, m, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };

  // ---- legs: fitted trousers, tall boots with cuffs ----
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.1, 0.92, 0);
    add(hip, new THREE.CylinderGeometry(0.075, 0.06, 0.46, 12).translate(0, -0.23, 0), trousers);
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    add(knee, new THREE.CylinderGeometry(0.058, 0.05, 0.2, 12).translate(0, -0.1, 0), trousers);
    add(knee, new THREE.CylinderGeometry(0.066, 0.056, 0.3, 14).translate(0, -0.27, 0), leather); // the boot shaft
    add(knee, new THREE.TorusGeometry(0.066, 0.012, 6, 16).rotateX(Math.PI / 2).translate(0, -0.12, 0), leather); // turned-down cuff
    const foot = add(knee, new THREE.BoxGeometry(0.1, 0.07, 0.24), leather, 0, -0.43, 0.05);
    foot.geometry.translate(0, 0, 0);
    add(knee, new THREE.SphereGeometry(0.05, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1.4), leather, 0, -0.4, 0.15); // the toe
    hip.add(knee);
    body.add(hip);
    return { hip, knee, side: s };
  });
  parts.legs = legs;

  // ---- torso: waistcoat inside a tailored longcoat ----
  const torsoPts = [[0.16, 0.9], [0.165, 0.98], [0.19, 1.12], [0.22, 1.28], [0.235, 1.38], [0.2, 1.45], [0.11, 1.5], [0.06, 1.52]];
  add(body, lathe(torsoPts.map(([r, y]) => [r * 0.97, y]), 24).scale(1, 1, 0.74), vest);
  const OPEN = Math.PI * 0.16;
  const coatBody = add(body, lathe(torsoPts.map(([r, y]) => [r + 0.012, y]), 28, OPEN, Math.PI * 2 - OPEN * 2).scale(1, 1, 0.78), coat);
  coatBody.material.side = THREE.DoubleSide;
  // Waistcoat buttons, a watch chain.
  for (let i = 0; i < 5; i++) add(body, new THREE.SphereGeometry(0.009, 8, 6), gold, 0, 1.0 + i * 0.07, 0.125);
  // Peak lapels.
  for (const s of [-1, 1]) {
    const lapel = add(body, new THREE.BoxGeometry(0.06, 0.3, 0.012), lining, s * 0.085, 1.33, 0.155);
    lapel.rotation.set(-0.15, s * 0.35, s * 0.32);
  }
  // A standing high collar, lined in the element's colour.
  const collar = add(body, new THREE.CylinderGeometry(0.115, 0.095, 0.14, 24, 1, true, Math.PI * 0.35, Math.PI * 1.3), coat, 0, 1.55, -0.005);
  collar.scale.z = 0.85;
  add(body, new THREE.CylinderGeometry(0.11, 0.09, 0.13, 24, 1, true, Math.PI * 0.35, Math.PI * 1.3), lining, 0, 1.55, -0.005).scale.z = 0.83;
  // The silk cravat: a knot and a falling tail.
  add(body, new THREE.SphereGeometry(0.032, 12, 10).scale(1.2, 0.9, 0.8), silk, 0, 1.49, 0.075);
  const cravatTail = new THREE.Group();
  cravatTail.position.set(0, 1.47, 0.085);
  add(cravatTail, new THREE.CylinderGeometry(0.035, 0.012, 0.16, 6, 1).translate(0, -0.08, 0).scale(1, 1, 0.3), silk);
  body.add(cravatTail);
  // Pauldrons: two layered plates, gold-edged.
  for (const s of [-1, 1]) {
    const pa = new THREE.Group();
    pa.position.set(s * 0.25, 1.43, 0);
    pa.rotation.z = -s * 0.35;
    add(pa, new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1.05, 0.55, 0.9), gunmetal);
    add(pa, new THREE.TorusGeometry(0.1, 0.008, 6, 24).rotateX(Math.PI / 2).scale(1.05, 1, 0.9), gold);
    add(pa, new THREE.SphereGeometry(0.085, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1.05, 0.5, 0.9), gunmetal, 0, -0.035, 0).rotation.z = -s * 0.15;
    body.add(pa);
  }
  // A draped chain from the left pauldron to the right lapel.
  {
    const link = new THREE.TorusGeometry(0.011, 0.003, 4, 8);
    const links = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const g = link.clone();
      g.rotateY(i % 2 ? Math.PI / 2 : 0);
      g.translate(-0.22 + t * 0.32, 1.42 - Math.sin(t * Math.PI) * 0.09 - t * 0.04, 0.16 + Math.sin(t * Math.PI) * 0.03);
      links.push(g);
    }
    add(body, mergeGeometries(links), gold);
  }
  // Belt and buckle.
  add(body, new THREE.TorusGeometry(0.168, 0.016, 6, 24).rotateX(Math.PI / 2).scale(1, 0.75, 1), leather, 0, 0.93, 0);
  add(body, new THREE.BoxGeometry(0.05, 0.04, 0.012), gold, 0, 0.93, 0.13);
  // Split coattails: two back panels that swing with every step and with speed.
  const coattails = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.065, 0.95, -0.08);
    const g = new THREE.CylinderGeometry(0.18, 0.24, 0.62, 10, 4, true, Math.PI + (s < 0 ? -0.75 : 0.05), 0.7).translate(0, -0.31, 0.08).scale(1, 1, 0.8);
    const panel = add(pivot, g, coat);
    panel.material = coat;
    add(pivot, g.clone(), lining).scale.setScalar(0.985);
    body.add(pivot);
    return pivot;
  });
  // Short front skirts of the coat.
  for (const s of [-1, 1]) {
    const fs = add(body, new THREE.CylinderGeometry(0.17, 0.2, 0.28, 8, 1, true, (s < 0 ? Math.PI * 1.55 : Math.PI * 0.12), Math.PI * 0.33).translate(0, -0.14, 0).scale(1, 1, 0.8), coat, 0, 0.94, 0);
    fs.material = coat;
  }

  // ---- arms and hands ----
  const arm = (side) => {
    const sh = new THREE.Group();
    sh.position.set(side * 0.26, 1.4, 0);
    add(sh, new THREE.CylinderGeometry(0.058, 0.052, 0.32, 12).translate(0, -0.16, 0), coat);
    const el = new THREE.Group();
    el.position.y = -0.3;
    add(el, new THREE.CylinderGeometry(0.052, 0.045, 0.27, 12).translate(0, -0.135, 0), coat);
    // A deep turned-back cuff with two gold buttons.
    add(el, new THREE.CylinderGeometry(0.062, 0.058, 0.08, 14, 1, true).translate(0, -0.24, 0), lining);
    for (const k of [0, 1]) add(el, new THREE.SphereGeometry(0.008, 6, 5), gold, 0.0, -0.22 - k * 0.03, 0.06);
    const hand = new THREE.Group();
    hand.position.y = -0.31;
    add(hand, new THREE.SphereGeometry(0.036, 12, 10).scale(0.85, 1.1, 0.55), skin);
    for (let f = 0; f < 4; f++) {
      const finger = add(hand, new THREE.CapsuleGeometry(0.0085, 0.035, 3, 6).translate(0, -0.022, 0), skin, -0.022 + f * 0.0145, -0.035, 0.008);
      finger.rotation.x = 0.9; // curled round the wand
      if (f === 2 && side > 0) add(finger, new THREE.TorusGeometry(0.0105, 0.0035, 6, 12).rotateX(Math.PI / 2), gold, 0, -0.012, 0); // signet ring
      if (f === 2 && side > 0) add(finger, new THREE.SphereGeometry(0.006, 8, 6), iris, 0, -0.012, 0.011); // its elemental gem
    }
    add(hand, new THREE.CapsuleGeometry(0.009, 0.03, 3, 6), skin, side * -0.03, -0.01, 0.015).rotation.z = side * 0.9;
    el.add(hand);
    sh.add(el);
    body.add(sh);
    return { sh, el, hand, side };
  };
  const armL = arm(-1);
  const armR = arm(1);

  // The wand: carved handle (grip bands, spiral inlay), pommel, tapered shaft, glowing tip.
  const wand = new THREE.Group();
  wand.position.y = -0.33;
  wand.rotation.x = Math.PI;
  add(wand, lathe([[0, -0.07], [0.016, -0.065], [0.013, -0.05], [0.015, -0.02], [0.012, 0.02], [0.014, 0.05], [0.009, 0.07], [0, 0.07]], 12), wood);
  add(wand, new THREE.SphereGeometry(0.017, 10, 8), gold, 0, -0.075, 0);
  for (const y of [-0.045, 0.0, 0.045]) add(wand, new THREE.TorusGeometry(0.0145, 0.0035, 5, 12).rotateX(Math.PI / 2), gold, 0, y, 0);
  add(wand, new THREE.TorusKnotGeometry(0.012, 0.0018, 40, 4, 2, 7).scale(1, 2.2, 1), gold, 0, 0.0, 0);
  add(wand, new THREE.CylinderGeometry(0.0035, 0.009, 0.3, 8).translate(0, 0.22, 0), wood);
  const tip = add(wand, new THREE.SphereGeometry(0.016, 10, 8), tipMat, 0, 0.375, 0);
  armR.el.add(wand);

  // ---- head ----
  const head = new THREE.Group();
  head.position.set(0, 1.66, 0.01);
  add(head, new THREE.CylinderGeometry(0.045, 0.05, 0.12, 12), skin, 0, -0.1, -0.01); // neck
  const FACE = 0.118;
  const faceGeo = sculptHead();
  const face = add(head, faceGeo, faceSkin);
  face.scale.setScalar(FACE);
  // Ears.
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.022, 10, 8).scale(0.45, 1, 0.75), skin, s * 0.094, 0.0, -0.005);
  // Eyes, set into the sculpted sockets: sclera, a luminous iris ring, a pupil, a catchlight; lash line and brows.
  for (const s of [-1, 1]) {
    const ex = s * 0.0395, ey = 0.02;
    const ez = faceDepth(faceGeo, FACE, ex, ey) - 0.003;
    const eye = new THREE.Group();
    eye.position.set(ex, ey, ez);
    add(eye, new THREE.SphereGeometry(0.0145, 16, 12).scale(1.05, 0.66, 0.5), sclera);
    const irisMat = s < 0 ? iris : iris2;
    add(eye, new THREE.RingGeometry(0.0043, 0.0082, 24), irisMat, 0, 0, 0.0074);
    add(eye, new THREE.CircleGeometry(0.0044, 16), dark, 0, 0, 0.0075);
    add(eye, new THREE.CircleGeometry(0.0019, 8), glint, s * 0.0028, 0.003, 0.0078);
    add(eye, new THREE.BoxGeometry(0.033, 0.0035, 0.004), dark, 0, 0.0085, 0.0058).rotation.z = -s * 0.14; // upper lash line
    head.add(eye);
    const browZ = faceDepth(faceGeo, FACE, s * 0.04, 0.045) + 0.002;
    const b = add(head, new THREE.BoxGeometry(0.034, 0.0065, 0.008), brow, s * 0.041, 0.045, browZ);
    b.rotation.z = s * 0.22; // determined: angled down toward the nose
    b.rotation.y = -s * 0.3;
  }
  add(head, new THREE.BoxGeometry(0.026, 0.003, 0.003), new THREE.MeshBasicMaterial({ color: 0x4a201c }), 0, -0.052, faceDepth(faceGeo, FACE, 0, -0.052) + 0.001); // a firm mouth
  // Hair: a scalp shell kept above the hairline, and the strands (one merged mesh per layer) on a swaying pivot.
  const hairPivot = new THREE.Group();
  add(hairPivot, hairMass(look.style), hair); // the sculpted mass
  const { main, tips } = hairstyle(look.style, rand);
  const hairMesh = add(hairPivot, mergeGeometries(main), hair);
  if (tips.length) {
    const ember = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(look.tip).multiplyScalar(4.5) }));
    add(hairPivot, mergeGeometries(tips), ember);
  }
  hairMesh.material.color.multiplyScalar(look.sheen);
  head.add(hairPivot);
  if (look.headband) {
    const band = std(0x050505, 0.4, 0.4);
    add(head, new THREE.TorusGeometry(0.115, 0.011, 6, 32).rotateX(Math.PI / 2).scale(0.95, 1, 1.02), band, 0, 0.065, -0.005).rotation.x = -0.12;
    for (let i = -2; i <= 2; i++) {
      const spike = add(head, new THREE.ConeGeometry(0.009, 0.045, 4), i ? band : gold, Math.sin(i * 0.35) * 0.11, 0.09, Math.cos(i * 0.35) * 0.105);
      spike.rotation.x = -0.25;
    }
    add(head, new THREE.OctahedronGeometry(0.012), iris, 0, 0.068, 0.112); // a crimson stone on the brow
  }
  if (look.halo) {
    const haloMat = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(look.eye).multiplyScalar(2.6), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    haloMat.userData.alwaysTransparent = true;
    const halo = add(head, new THREE.TorusGeometry(0.16, 0.005, 6, 48), haloMat, 0, 0.14, -0.1);
    halo.rotation.x = -0.35;
    parts.halo = halo;
  }
  body.add(head);

  group.traverse((o) => {
    if (o.isMesh && !o.material.isMeshBasicMaterial) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  Object.assign(parts, { coatBody, collar, hairMesh, hairPivot, face });
  mergeByMaterial(group, new Set([tip, hairMesh, coatBody, face, parts.halo].filter(Boolean)));
  return { group, body, head, hair: hairPivot, legs, armL, armR, wand, tip, tipMat, coattails, cravatTail, mats, parts, look };
}
