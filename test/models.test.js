// Step 9: the new character models (built in node: they only depend on
// three) and the vanity camera's logic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildWizardModel, WIZARD_LOOKS, sculptHead } from '../client/js/entities/wizardModel.js';
import { buildKeeperModel } from '../client/js/entities/keeperModel.js';
import { SIN_MODELS, buildSinModel } from '../client/js/entities/sinModels.js';
import { VanityCam, VANITY } from '../client/js/player/VanityCam.js';
import { WIZARDS } from '../shared/wizards.js';
import { SIN_IDS } from '../shared/sins.js';

function stats(root) {
  let meshes = 0, tris = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  const box = new THREE.Box3().setFromObject(root);
  return { meshes, tris, size: box.getSize(new THREE.Vector3()) };
}
const hdr = (m) => Math.max(m.color.r, m.color.g, m.color.b) > 1.5;

test('wizards: seven distinct handsome mages: sculpted heads, luminous eyes, their own hair, tailored attire', () => {
  const hairs = new Set();
  for (const w of WIZARDS) {
    const m = buildWizardModel(w);
    const st = stats(m.group);
    assert.ok(st.size.y > 1.7 && st.size.y < 2.1, `${w.id} stands ~1.8 m tall (${st.size.y.toFixed(2)})`);
    assert.ok(st.tris < 30000 && st.meshes < 70, `${w.id} stays within budget (${Math.round(st.tris)} tris, ${st.meshes} meshes)`);
    assert.equal(m.legs.length, 2);
    assert.equal(m.coattails.length, 2, 'split coattails');
    assert.ok(m.cravatTail && m.wand && m.tip);
    // Eyes: two luminous (HDR) iris rings with catchlights.
    const irises = m.mats.filter((x) => x.isMeshBasicMaterial && hdr(x) && x.color.getHex() !== 0xffffff);
    assert.ok(irises.length >= 1, `${w.id}: luminous elemental eyes`);
    // Their own hairstyle (a merged mesh per wizard, all different).
    const hairGeo = m.parts.hairMesh.geometry;
    hairs.add(`${WIZARD_LOOKS[w.id].style}:${hairGeo.attributes.position.count}`);
    // The signet ring and its gem on the wand hand.
    let ring = false;
    m.armR.hand.traverse((o) => { if (o.isMesh && o.geometry.type === 'TorusGeometry') ring = true; });
    assert.ok(ring, `${w.id}: a signet ring`);
  }
  assert.equal(hairs.size, 7, 'seven different hairstyles');
  assert.ok(buildWizardModel(WIZARDS.find((w) => w.id === 'soham')).parts.halo, 'Soham has a halo');
  assert.ok(!buildWizardModel(WIZARDS.find((w) => w.id === 'parthius')).parts.halo);
  // The sculpted head: a jaw narrower than the cheekbones, a nose standing proud.
  const head = sculptHead();
  const p = head.attributes.position;
  let jawW = 0, cheekW = 0, noseZ = 0;
  for (let i = 0; i < p.count; i++) {
    const x = Math.abs(p.getX(i)), y = p.getY(i), z = p.getZ(i);
    if (Math.abs(y + 0.75) < 0.05) jawW = Math.max(jawW, x);
    if (Math.abs(y - 0.02) < 0.05) cheekW = Math.max(cheekW, x);
    if (x < 0.03 && y > -0.2 && y < 0.1) noseZ = Math.max(noseZ, z);
  }
  assert.ok(jawW < cheekW * 0.75, `a chiselled jaw (${jawW.toFixed(2)} vs ${cheekW.toFixed(2)})`);
  assert.ok(noseZ > 0.95, `a sculpted nose bridge (${noseZ.toFixed(2)})`);
});

test('the Keeper: 3.2 m of anatomy: seven wet hearts, a cracked ribcage, a split mandible, four spider limbs', () => {
  const k = buildKeeperModel();
  const st = stats(k.group);
  k.group.updateMatrixWorld(true);
  const skullTop = new THREE.Box3().setFromObject(k.head).max.y;
  assert.ok(skullTop > 2.9 && skullTop < 3.5, `towering: its skull at ${skullTop.toFixed(2)} m`);
  assert.equal(k.hearts.length, 7);
  for (const h of k.hearts) {
    assert.ok(h.mat.isMeshPhysicalMaterial && h.mat.clearcoat > 0.5, 'wet, glistening hearts');
  }
  assert.equal(k.jaws.length, 2, 'the mandible is split in two');
  assert.deepEqual(k.jaws.map((j) => j.s).sort(), [-1, 1]);
  assert.equal(k.spiderLimbs.length, 4);
  for (const L of k.spiderLimbs) assert.equal(L.segs.length, 3, 'three jointed segments each');
  assert.ok(k.ribs.length >= 12);
  assert.ok(k.skin.isMeshPhysicalMaterial && k.skin.clearcoat > 0, 'glistening necrotic skin');
  assert.ok(hdr(k.eyeMat) && k.eyeMat.color.r > k.eyeMat.color.g * 5, 'pinpoint red pupils that bloom');
  assert.ok(k.tendrils.length >= 6, 'creeping shadows');
  assert.ok(st.tris < 40000);
});

test('the Seven Sins: bespoke boss sculpts with their signature anatomy, all animated', () => {
  assert.deepEqual(Object.keys(SIN_MODELS).sort(), [...SIN_IDS].sort());
  const sizes = new Set();
  for (const sin of SIN_IDS) {
    const m = buildSinModel(sin);
    const st = stats(m.root);
    assert.ok(m.height >= 2.4 && m.height <= 3.5, sin);
    assert.ok(st.tris < 30000, `${sin}: ${Math.round(st.tris)} tris`);
    for (let i = 0; i < 5; i++) m.animate(i * 0.3, 0.05, { moving: i % 2 === 0, windup: i / 4, strike: 0, hurt: 0, state: 'x', hpK: 0.5 });
    sizes.add(`${st.size.x.toFixed(1)}x${st.size.y.toFixed(1)}`);
  }
  assert.ok(sizes.size >= 6, 'seven different silhouettes');
  const pride = buildSinModel('pride');
  assert.equal(pride.parts.wings.length, 6, 'Pride: six shattered-mirror wings');
  assert.ok(pride.parts.eyes.length >= 7, 'a crown of golden eyes');
  assert.equal(buildSinModel('greed').parts.arms.length, 6, 'Greed: six arms');
  assert.equal(buildSinModel('lust').parts.legs.length, 8, 'Lust: an arachnid bride');
  assert.equal(buildSinModel('envy').parts.masks.length, 5, 'Envy: five masks round its neck');
  const glut = buildSinModel('gluttony');
  const r0 = glut.parts.rings[0].rotation.z;
  glut.animate(2, 0.05, { moving: false, windup: 1, strike: 0, hurt: 0, state: 'x', hpK: 1 });
  assert.notEqual(glut.parts.rings[0].rotation.z, r0, 'Gluttony: rotating rings of teeth');
  assert.equal(buildSinModel('wrath').parts.arms.length, 2, 'Wrath: twin cleavers');
  assert.equal(buildSinModel('sloth').parts.weights.length, 3, 'Sloth: dragging iron weights');
});

test('vanity camera (C): over the shoulder while moving, a slow orbit once still, pulled in by walls', () => {
  const cam = new VanityCam();
  assert.equal(cam.toggle(), true);
  const pose = { x: 10, y: 1.6, z: 10, yaw: 0, pitch: 0, moving: true };
  let p = cam.update(0.05, pose);
  // yaw 0 looks toward -z: behind is +z, the right shoulder is +x.
  assert.ok(Math.abs(p.z - (10 + VANITY.distance)) < 0.01, `behind you (${p.z})`);
  assert.ok(p.x > 10.3, 'over the right shoulder');
  assert.ok(p.y > pose.y, 'a little above your eyes');
  assert.ok(p.lookZ < pose.z, 'looking where you look');
  // Standing still: after ORBIT_AFTER it starts to circle.
  const still = { ...pose, moving: false };
  for (let t = 0; t < VANITY.orbitAfter + 2; t += 0.05) p = cam.update(0.05, still);
  assert.ok(cam.orbit > 0.5, `circling (${cam.orbit.toFixed(2)} rad)`);
  assert.ok(Math.abs(Math.hypot(p.x - 10, p.z - 10) - VANITY.distance) < 0.6);
  // Moving again: back over the shoulder.
  for (let t = 0; t < 3; t += 0.05) p = cam.update(0.05, pose);
  assert.ok(Math.abs(cam.orbit) < 0.05, 'eased back');
  // A wall right behind: the camera comes in close.
  p = cam.update(0.05, pose, (x0, z0, x1, z1) => Math.hypot(x1 - x0, z1 - z0) < 1);
  assert.ok(p.distance < 1.2 && p.distance >= VANITY.minDistance, `pulled in (${p.distance.toFixed(2)})`);
  assert.equal(cam.toggle(), false);
});
