// Step 9: the Keeper (the Malphas Amalgam), rebuilt as anatomical body horror.
// A 3.2 m contorted frame on digitigrade legs; wet, glistening necrotic skin
// (a clearcoated physical material); an exposed, cracked ivory ribcage with
// seven wet, pulsing anatomical hearts tangled in black arteries; an elongated
// pale skull with sunken weeping sockets and pinpoint red pupils; a lower
// mandible split in two halves that unhinge down to its chest; four spider-like
// bone limbs flexing out of its shoulder blades; long clawed hands; a tattered
// shroud; creeping shadow tendrils on the floor round its feet.
//
// Only depends on `three` (node tests build it). The avatar animates the parts
// it returns: hips, legs, spine, shoulders, arms, neck, head, the two jaw
// halves, the hearts, the spider limbs, the tendrils.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeByMaterial } from './wizardModel.js';

const jitter = (a, r = Math.random) => (r() - 0.5) * 2 * a;

/** A tapering bone along -y with knobbly ends. */
function boneGeo(len, r) {
  const g = new THREE.CylinderGeometry(r * 0.7, r, len, 8, 3).translate(0, -len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = -p.getY(i) / len;
    const k = 1 + 0.35 * Math.exp(-((t - 0.02) ** 2) / 0.004) + 0.3 * Math.exp(-((t - 0.98) ** 2) / 0.004) - 0.12 * Math.sin(t * Math.PI);
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** An anatomical heart: two atria, a tapering ventricle, a stub of aorta. */
function heartGeo() {
  const parts = [
    new THREE.SphereGeometry(0.05, 12, 10).scale(1, 0.9, 0.9).translate(-0.022, 0.02, 0),
    new THREE.SphereGeometry(0.045, 12, 10).scale(1, 0.9, 0.9).translate(0.024, 0.024, 0),
    new THREE.ConeGeometry(0.058, 0.11, 12).rotateX(Math.PI).translate(0, -0.045, 0),
    new THREE.CylinderGeometry(0.014, 0.018, 0.06, 8).translate(0.006, 0.07, -0.01),
  ];
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

/** A black artery: a tube along a sagging curve between two points. */
function arteryGeo(a, b, sag = 0.06, r = 0.008) {
  const mid = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(jitter(0.03), -sag, jitter(0.03)));
  return new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 10, r, 5, false);
}

/** A rib: an arc that may be cracked (broken off with a jagged end). */
function ribGeo(r, cracked) {
  const arc = cracked ? Math.PI * (0.55 + Math.random() * 0.15) : Math.PI * 0.92;
  const g = new THREE.TorusGeometry(r, 0.017, 5, 16, arc);
  if (cracked) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const ang = Math.atan2(p.getY(i), p.getX(i));
      if (ang > arc - 0.12 || ang < -Math.PI + arc - 0.12 + Math.PI * 2 && ang > arc - 0.2) p.setXYZ(i, p.getX(i) * (1 + jitter(0.06)), p.getY(i) * (1 + jitter(0.06)), p.getZ(i) * 1.4);
    }
    g.computeVertexNormals();
  }
  return g;
}

/**
 * @param opts { glowTex?: THREE.Texture } a soft sprite for the hearts' and eyes' glow (optional)
 */
export function buildKeeperModel({ glowTex = null } = {}) {
  // Wet, necrotic: a dark body with a thin, soft clearcoat sheen (glints, never chalk-white).
  const skin = new THREE.MeshPhysicalMaterial({ color: 0x15110f, roughness: 0.62, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.5 });
  const pale = new THREE.MeshPhysicalMaterial({ color: 0x9a9284, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xa89c82, roughness: 0.6 });
  const crackedBone = new THREE.MeshStandardMaterial({ color: 0x8a7c62, roughness: 0.75 });
  const artery = new THREE.MeshPhysicalMaterial({ color: 0x050304, roughness: 0.2, clearcoat: 1 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x020101 });
  const teethMat = new THREE.MeshStandardMaterial({ color: 0xcfc2a0, roughness: 0.4 });
  const shroudMat = new THREE.MeshStandardMaterial({ color: 0x0e0b0a, roughness: 1, side: THREE.DoubleSide });
  const mats = [skin, pale, bone, crackedBone, artery, teethMat, shroudMat];
  const add = (parent, geo, m, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };

  const group = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(0.88); // the crown of its skull at ~3.2 m (the spider limbs rise higher)
  group.add(body);

  // ---- legs: long, digitigrade, the knees bending the wrong way ----
  const hips = new THREE.Group();
  hips.position.y = 1.75;
  body.add(hips);
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.15, 0, 0);
    add(hip, boneGeo(0.95, 0.1), skin);
    const knee = new THREE.Group();
    knee.position.y = -0.95;
    add(knee, boneGeo(0.62, 0.07), skin);
    const ankle = new THREE.Group();
    ankle.position.y = -0.62;
    ankle.rotation.x = 0.9;
    add(ankle, boneGeo(0.42, 0.05), skin);
    for (let t = 0; t < 3; t++) {
      const toe = add(ankle, boneGeo(0.22, 0.016), bone, (t - 1) * 0.035, -0.42, 0);
      toe.rotation.set(-1.35, 0, (t - 1) * 0.22);
    }
    knee.add(ankle);
    hip.add(knee);
    hips.add(hip);
    return { hip, knee, ankle, s };
  });
  add(hips, new THREE.SphereGeometry(0.19, 12, 10).scale(1.3, 0.6, 0.8), crackedBone); // pelvis

  // ---- spine, back flesh, the exposed ribcage ----
  const spine = new THREE.Group();
  hips.add(spine);
  for (let i = 0; i < 14; i++) add(spine, new THREE.SphereGeometry(0.045 - i * 0.0012, 8, 6).scale(1.2, 0.7, 1), bone, 0, 0.08 + i * 0.085, -0.06); // vertebrae
  const back = add(spine, new THREE.CylinderGeometry(0.29, 0.2, 0.95, 18, 6, true, Math.PI * 0.62, Math.PI * 0.76), skin, 0, 0.72, 0);
  back.material = skin;
  {
    // Torn edges of the flesh round the opening.
    const p = back.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (1 + jitter(0.04)));
    back.geometry.computeVertexNormals();
    back.material = skin.clone();
    back.material.side = THREE.DoubleSide;
    mats.push(back.material);
  }
  const ribs = [];
  for (let i = 0; i < 7; i++) {
    const r = 0.26 - Math.abs(i - 3) * 0.022;
    for (const s of [-1, 1]) {
      const cracked = (i + (s > 0 ? 1 : 0)) % 3 === 0;
      const rib = add(spine, ribGeo(r, cracked), cracked ? crackedBone : bone, 0, 0.36 + i * 0.1, -0.03);
      rib.rotation.set(Math.PI / 2 + 0.25, 0, s > 0 ? -Math.PI * 0.04 : Math.PI * 1.04);
      ribs.push(rib);
    }
  }
  add(spine, new THREE.BoxGeometry(0.035, 0.42, 0.02), crackedBone, 0, 0.6, 0.23).rotation.z = 0.25; // a split sternum, hanging

  // ---- seven wet hearts in black arteries ----
  const heartMat = (i) => new THREE.MeshPhysicalMaterial({ color: 0x4a0408, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0xff1010, emissiveIntensity: 0.2 + i * 0 });
  const hearts = [];
  const hg = heartGeo();
  const heartSpots = [[-0.08, 0.46, 0.05], [0.08, 0.5, 0.06], [-0.1, 0.62, 0.04], [0.09, 0.66, 0.05], [-0.06, 0.78, 0.04], [0.07, 0.82, 0.03], [0, 0.66, 0.1]];
  const arteries = [];
  heartSpots.forEach(([x, y, z], i) => {
    const mat = heartMat(i);
    mats.push(mat);
    const node = add(spine, hg, mat, x, y, z);
    node.rotation.set(jitter(0.5), jitter(1.5), jitter(0.6));
    node.scale.setScalar(i === 6 ? 1.35 : 0.9 + (i % 3) * 0.08);
    let glow = null;
    if (glowTex) {
      glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff1a10, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(0.3);
      node.add(glow);
    }
    hearts.push({ node, mat, glow, phase: i * 0.37, base: node.scale.x });
    // Arteries: to the spine, and to the next heart.
    arteries.push(arteryGeo(new THREE.Vector3(x, y + 0.05, z), new THREE.Vector3(0, y + 0.12, -0.05), 0.04, 0.009));
    if (i > 0) arteries.push(arteryGeo(new THREE.Vector3(x, y, z), new THREE.Vector3(...heartSpots[i - 1]), 0.05, 0.006));
  });
  for (let k = 0; k < 6; k++) arteries.push(arteryGeo(new THREE.Vector3(jitter(0.12), 0.4 + Math.random() * 0.5, 0.08), new THREE.Vector3(jitter(0.2), 0.3 + Math.random() * 0.6, jitter(0.1)), 0.08, 0.005));
  add(spine, mergeGeometries(arteries.map((g) => g.toNonIndexed())), artery);

  // ---- shoulders, the long clawed arms ----
  const shoulders = new THREE.Group();
  shoulders.position.y = 1.15;
  spine.add(shoulders);
  add(shoulders, new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), bone).rotation.z = Math.PI / 2 + 0.16; // clavicles
  const arms = [
    { s: -1, y: 0.07, upper: 0.92, fore: 1.02 },
    { s: 1, y: -0.08, upper: 0.98, fore: 1.22 },
  ].map(({ s, y, upper, fore }) => {
    const sh = new THREE.Group();
    sh.position.set(s * 0.35, y, 0);
    add(sh, boneGeo(upper, 0.065), skin);
    const elbow = new THREE.Group();
    elbow.position.y = -upper;
    add(elbow, boneGeo(fore, 0.05), skin);
    const hand = new THREE.Group();
    hand.position.y = -fore;
    for (let f = 0; f < 5; f++) {
      const thumb = f === 4;
      const finger = new THREE.Group();
      finger.position.set(thumb ? s * -0.05 : (f - 1.5) * 0.028, 0, thumb ? 0.03 : 0);
      finger.rotation.set(0.15, 0, thumb ? s * -0.6 : (f - 1.5) * 0.12);
      const len = thumb ? 0.2 : 0.36 + (f === 1 || f === 2 ? 0.06 : 0);
      add(finger, boneGeo(len, 0.012), pale);
      add(finger, new THREE.ConeGeometry(0.009, 0.08, 6).rotateX(Math.PI).translate(0, -len - 0.04, 0), dark); // a black talon
      hand.add(finger);
    }
    elbow.add(hand);
    sh.add(elbow);
    shoulders.add(sh);
    return { sh, elbow, hand, s };
  });

  // ---- four spider limbs from the shoulder blades ----
  const spiderLimbs = [];
  [[-1, 0], [1, 0], [-1, 1], [1, 1]].forEach(([s, row], i) => {
    const base = new THREE.Group();
    base.position.set(s * (0.16 + row * 0.04), 0.95 - row * 0.2, -0.16);
    base.rotation.set(-0.9 - row * 0.2, 0, s * (1.0 + row * 0.35));
    const segs = [];
    let parent = base;
    [[0.62, 0.035], [0.7, 0.026], [0.55, 0.017]].forEach(([len, r], k) => {
      const joint = new THREE.Group();
      if (k) joint.position.y = -[0.62, 0.7][k - 1];
      add(joint, boneGeo(len, r), k === 2 ? pale : bone);
      add(joint, new THREE.SphereGeometry(r * 1.5, 8, 6), crackedBone);
      parent.add(joint);
      segs.push(joint);
      parent = joint;
    });
    add(parent, new THREE.ConeGeometry(0.014, 0.16, 6).rotateX(Math.PI).translate(0, -0.55 - 0.08, 0), dark); // the hooked tip
    spine.add(base);
    spiderLimbs.push({ base, segs, s, row, phase: i * 1.7 });
  });

  // ---- a tattered shroud hanging from the back ----
  {
    const g = new THREE.CylinderGeometry(0.34, 0.6, 1.9, 16, 8, true, Math.PI * 0.55, Math.PI * 0.9);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < -0.6) p.setY(i, p.getY(i) - Math.random() * 0.55); // a ragged hem
      p.setX(i, p.getX(i) * (0.9 + Math.random() * 0.2));
    }
    g.computeVertexNormals();
    add(spine, g, shroudMat, 0, 0.3, -0.04);
  }

  // ---- neck, the elongated skull, sunken weeping sockets, the split mandible ----
  const neck = new THREE.Group();
  neck.position.set(0, 1.18, -0.02);
  spine.add(neck);
  for (let i = 0; i < 5; i++) add(neck, new THREE.SphereGeometry(0.038, 8, 6).scale(1, 0.75, 1), bone, 0, i * 0.075, 0);
  const head = new THREE.Group();
  head.position.y = 0.38;
  neck.add(head);
  const skullGeo = new THREE.SphereGeometry(0.15, 28, 22);
  {
    // Elongated up and back, cheeks hollow, the brow heavy.
    const p = skullGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const up = Math.max(0, y) / 0.15;
      y *= 1.55 + up * 0.35;
      z -= up * up * 0.09; // swept back
      x *= 0.78 - 0.12 * Math.exp(-((y + 0.05) ** 2) / 0.004) * Math.max(0, -z / 0.15 * -1 + 0.4);
      if (y < 0) x *= 1 - 0.25 * Math.min(1, -y / 0.2);
      p.setXYZ(i, x, y + 0.16, z);
    }
    skullGeo.computeVertexNormals();
  }
  add(head, skullGeo, pale);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.05, 0.03).multiplyScalar(6) }); // pinpoint red: they bloom
  const glints = [];
  for (const s of [-1, 1]) {
    add(head, new THREE.SphereGeometry(0.038, 10, 8).scale(1, 1.25, 0.7), dark, s * 0.05, 0.2 + s * 0.012, 0.115); // sunken socket
    add(head, new THREE.SphereGeometry(0.0065, 6, 4), eyeMat, s * 0.05, 0.2 + s * 0.012, 0.135);
    // Black tears weeping from each socket.
    add(head, new THREE.BoxGeometry(0.007, 0.16, 0.004).translate(0, -0.08, 0), dark, s * 0.052, 0.17 + s * 0.012, 0.128).rotation.z = s * 0.05;
    if (glowTex) {
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff2010, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      glint.scale.setScalar(0.07);
      glint.position.set(s * 0.05, 0.2 + s * 0.012, 0.14);
      head.add(glint);
      glints.push(glint);
    }
  }
  // The upper teeth (fixed to the skull).
  for (let i = 0; i < 9; i++) {
    const a = (i / 8 - 0.5) * 1.6;
    add(head, new THREE.ConeGeometry(0.008, 0.05, 5).rotateX(Math.PI), teethMat, Math.sin(a) * 0.07, 0.005, 0.1 + Math.cos(a) * 0.02);
  }
  // The split mandible: two halves hinged at the skull, each with its row of teeth.
  const jaws = [-1, 1].map((s) => {
    const hinge = new THREE.Group();
    hinge.position.set(s * 0.07, 0.04, 0.0);
    add(hinge, new THREE.BoxGeometry(0.03, 0.025, 0.2).translate(0, -0.012, 0.085), crackedBone).rotation.y = -s * 0.25;
    for (let i = 0; i < 5; i++) add(hinge, new THREE.ConeGeometry(0.0075, 0.045, 5), teethMat, -s * (0.005 + i * 0.008), 0.012, 0.06 + i * 0.03);
    head.add(hinge);
    return { hinge, s };
  });

  // ---- creeping shadow tendrils on the floor ----
  const tendrilMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
  const tendrils = [];
  for (let i = 0; i < 9; i++) {
    const t = new THREE.Group();
    t.rotation.y = (i / 9) * Math.PI * 2 + jitter(0.2);
    const geo = new THREE.PlaneGeometry(0.22, 1, 1, 6).translate(0, 0.5, 0).rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const along = -p.getZ(k);
      p.setX(k, p.getX(k) * (1 - along * 0.85) + Math.sin(along * 7 + i) * 0.06 * along);
    }
    const m = add(t, geo, tendrilMat, 0, 0.012, 0);
    m.renderOrder = 1;
    group.add(t);
    tendrils.push({ group: t, mesh: m, phase: i * 0.9 });
  }
  const pool = add(group, new THREE.CircleGeometry(0.9, 24).rotateX(-Math.PI / 2), tendrilMat, 0, 0.011, 0);
  pool.renderOrder = 1;

  group.traverse((o) => { if (o.isMesh && !o.material.isMeshBasicMaterial) { o.castShadow = true; o.receiveShadow = true; } });
  // Fewer draw calls: merge the static pieces (the beating hearts and the tendrils stay apart).
  mergeByMaterial(group, new Set([...hearts.map((h) => h.node), ...tendrils.map((t) => t.mesh), pool]));
  return { group, body, hips, legs, spine, ribs, hearts, shoulders, arms, spiderLimbs, neck, head, jaws, eyeMat, glints, tendrils, tendrilMat, skin, mats };
}
