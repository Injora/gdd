// The Malphas Amalgam, client side. A procedural, asymmetric, too-tall figure:
// open ribcage with six heart-nodes (one dies with each destroyed Heart),
// crooked pale head, hair curtains, absurd limbs.
//
// Uncanny motion: limb/head transforms are only recomputed at a quantised
// ~13 Hz (stop-motion), while the body's position glides smoothly. It snaps
// its head sideways and hunches through doorways, and convulses when stunned
// or tormented.

import * as THREE from 'three';
import { FLOOR_Y, TILE, TILE_DOOR } from '/shared/constants.js';
import { STATUS_LABELS } from './MonsterAvatar.js';

const POSE_HZ = 13;
const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const jitter = (a) => (Math.random() - 0.5) * 2 * a;

export class AmalgamAvatar {
  constructor(snap, { map, fx, debug, onStep }) {
    this.id = snap.id;
    this.map = map;
    this.fx = fx;
    this.onStep = onStep;
    this.snap = snap;
    this.x = snap.x;
    this.z = snap.z;
    this.yaw = snap.yaw;
    this.floor = snap.f;
    this.poseAcc = 0;
    this.walkPhase = 0;
    this.doorK = 0;
    this.rise = 0;
    this.forced = null;
    this.heartsLit = 6;

    const skin = new THREE.MeshStandardMaterial({ color: 0xcdc3b4, roughness: 0.55 });
    const bone = new THREE.MeshStandardMaterial({ color: 0x9a8c7a, roughness: 0.7 });
    const dark = new THREE.MeshBasicMaterial({ color: 0x050303 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x070505, roughness: 1, side: THREE.DoubleSide });
    this.skin = skin;
    this.mats = [skin, bone, hair];

    const limb = (len, r, mat = skin) =>
      new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, len, 7).translate(0, -len / 2, 0), mat);

    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);

    // Legs: long, digitigrade-ish.
    this.hips = new THREE.Group();
    this.hips.position.y = 1.6;
    this.body.add(this.hips);
    this.legs = [-1, 1].map((s) => {
      const hip = new THREE.Group();
      hip.position.set(s * 0.13, 0, 0);
      hip.add(limb(0.85, 0.09));
      const knee = new THREE.Group();
      knee.position.y = -0.85;
      knee.add(limb(0.82, 0.065));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.32), skin);
      foot.position.set(0, -0.84, -0.1);
      knee.add(foot);
      hip.add(knee);
      this.hips.add(hip);
      return { hip, knee, s };
    });
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), bone);
    pelvis.scale.set(1.3, 0.6, 0.8);
    this.hips.add(pelvis);

    // Spine + ribcage + six heart-nodes.
    this.spine = new THREE.Group();
    this.hips.add(this.spine);
    const column = limb(1.05, 0.045, bone);
    column.rotation.x = Math.PI;
    column.position.y = 0;
    this.spine.add(column);
    for (let i = 0; i < 6; i++) {
      const r = 0.21 - Math.abs(i - 2.5) * 0.02;
      for (const s of [-1, 1]) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(r, 0.016, 4, 12, Math.PI * 0.95), bone);
        rib.rotation.set(Math.PI / 2, 0, s > 0 ? -Math.PI * 0.05 : Math.PI * 1.05);
        rib.position.set(0, 0.42 + i * 0.1, -0.02);
        this.spine.add(rib);
      }
    }
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.17, 0.75, 12, 1, true, -Math.PI * 0.42, Math.PI * 0.84), skin);
    back.material = skin.clone();
    back.material.side = THREE.DoubleSide;
    this.mats.push(back.material);
    back.position.y = 0.66;
    this.spine.add(back);
    // A tattered burial shroud hanging from the shoulders gives it mass.
    const shroudGeo = new THREE.CylinderGeometry(0.3, 0.5, 1.7, 14, 6, true, -Math.PI * 0.7, Math.PI * 1.4);
    const sp = shroudGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      if (sp.getY(i) < -0.6) sp.setY(i, sp.getY(i) - Math.random() * 0.45); // ragged hem
      sp.setX(i, sp.getX(i) * (0.92 + Math.random() * 0.16));
    }
    shroudGeo.computeVertexNormals();
    const shroud = new THREE.Mesh(shroudGeo, new THREE.MeshStandardMaterial({ color: 0x14100d, roughness: 1, side: THREE.DoubleSide }));
    shroud.position.y = 0.25;
    this.spine.add(shroud);
    this.mats.push(shroud.material);
    this.hearts = [];
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
      const node = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), mat);
      node.position.set((i % 2 ? 1 : -1) * 0.065, 0.5 + Math.floor(i / 2) * 0.13, -0.04);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.softTex, color: 0xff1a10, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(0.32);
      node.add(glow);
      this.spine.add(node);
      this.hearts.push({ node, mat, glow, phase: i * 0.37 });
    }

    // Shoulders (uneven) + arms (one much longer).
    this.shoulders = new THREE.Group();
    this.shoulders.position.y = 1.02;
    this.spine.add(this.shoulders);
    const clav = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), bone);
    clav.rotation.z = Math.PI / 2 + 0.18;
    this.shoulders.add(clav);
    this.arms = [
      { s: -1, y: 0.06, upper: 0.82, fore: 0.92 },
      { s: 1, y: -0.07, upper: 0.88, fore: 1.12 },
    ].map(({ s, y, upper, fore }) => {
      const sh = new THREE.Group();
      sh.position.set(s * 0.3, y, 0);
      sh.add(limb(upper, 0.06));
      const elbow = new THREE.Group();
      elbow.position.y = -upper;
      elbow.add(limb(fore, 0.048));
      for (let f = 0; f < 4; f++) {
        const finger = limb(0.34, 0.011);
        finger.position.set((f - 1.5) * 0.025, -fore, 0);
        finger.rotation.set(0.1, 0, (f - 1.5) * 0.12);
        elbow.add(finger);
      }
      sh.add(elbow);
      this.shoulders.add(sh);
      return { sh, elbow, s };
    });

    // Neck + crooked head + hair.
    this.neck = new THREE.Group();
    this.neck.position.set(0, 1.05, -0.04);
    this.spine.add(this.neck);
    const neckMesh = limb(0.34, 0.035);
    neckMesh.rotation.x = Math.PI;
    this.neck.add(neckMesh);
    this.head = new THREE.Group();
    this.head.position.y = 0.34;
    this.neck.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), skin);
    skull.scale.set(0.78, 1.4, 0.92);
    skull.position.y = 0.16;
    this.head.add(skull);
    this.jaw = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.22, 10), dark);
    this.jaw.position.set(0, 0.02, -0.11);
    this.jaw.rotation.x = 0.25;
    this.head.add(this.jaw);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xf4efe6 });
    for (const s of [-1, 1]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), dark);
      socket.position.set(s * 0.048, 0.22 + s * 0.012, -0.115);
      this.head.add(socket);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), this.eyeMat);
      eye.position.set(s * 0.048, 0.22 + s * 0.012, -0.135);
      this.head.add(eye);
      // Two pinpoints that pierce the fog: you see it watching before you see it.
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({
        map: fx.softTex, color: 0xfff4e0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      glint.scale.setScalar(0.09);
      glint.position.copy(eye.position);
      this.head.add(glint);
      (this.glints ??= []).push(glint);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const len = 0.6 + Math.random() * 0.5;
      const strand = new THREE.Mesh(new THREE.PlaneGeometry(0.05, len).translate(0, -len / 2, 0), hair);
      strand.position.set(Math.cos(a) * 0.1, 0.36, Math.sin(a) * 0.1 + 0.02);
      strand.rotation.set(jitter(0.15), a, jitter(0.15));
      this.head.add(strand);
    }
    this.headTilt = 0.32; // permanently crooked

    this.group.traverse((o) => { if (o.isMesh && !o.material.isMeshBasicMaterial) { o.castShadow = true; o.receiveShadow = true; } });

    // Through-walls silhouette for Psychic Torment.
    this.revealFill = new THREE.MeshBasicMaterial({ color: 0x9a3cff, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false });
    this.revealWire = new THREE.MeshBasicMaterial({ color: 0xe6c4ff, wireframe: true, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false });
    this.overlays = [];
    const meshes = [];
    this.body.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) {
      for (const mat of [this.revealFill, this.revealWire]) {
        const o = new THREE.Mesh(m.geometry, mat);
        o.position.copy(m.position);
        o.rotation.copy(m.rotation);
        o.scale.copy(m.scale);
        o.renderOrder = 999;
        o.visible = false;
        m.parent.add(o);
        this.overlays.push(o);
      }
    }

    if (debug) {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 64;
      this.labelCtx = c.getContext('2d');
      this.labelTex = new THREE.CanvasTexture(c);
      this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTex, transparent: true, depthTest: false }));
      this.label.scale.set(2.4, 0.3, 1);
      this.label.position.y = 3.7;
      this.label.renderOrder = 1000;
      this.group.add(this.label);
      this.labelKey = '';
    }
    this.applyPose(0);
  }

  has(code) { return this.snap.st.includes(code); }

  setSnapshot(s) {
    if (s.f !== this.floor || (this.snap.hid && !s.hid)) {
      // Teleported (stairs) or reappeared: no gliding across the map.
      this.x = s.x;
      this.z = s.z;
      this.yaw = s.yaw;
    }
    this.snap = s;
    this.floor = s.f;
    if (this.label) {
      const key = `${s.state}|${s.act}|${s.hp}|${s.st.join(',')}`;
      if (key !== this.labelKey) {
        this.labelKey = key;
        const ctx = this.labelCtx;
        ctx.clearRect(0, 0, 512, 64);
        ctx.font = 'bold 22px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff6a6a';
        const st = s.st.map((c) => STATUS_LABELS[c]?.[0] ?? c).join(' · ');
        ctx.fillText(`${s.state.toUpperCase()}${s.act ? ` [${s.act}]` : ''} HP ${s.hp}${st ? ` · ${st}` : ''}`, 256, 40);
        this.labelTex.needsUpdate = true;
      }
    }
  }

  /** Floating damage numbers (debug only; in play its health stays a mystery). */
  showDamage(amount) {
    if (!this.label) return;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 40px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff6a6a';
    ctx.fillText(`-${Math.round(amount)}`, 64, 46);
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(0.8, 0.4, 1);
    sprite.position.set(jitter(0.4), 3.3, 0);
    this.group.add(sprite);
    const start = performance.now();
    const tick = () => {
      const k = (performance.now() - start) / 1000;
      sprite.position.y = 3.3 + k;
      sprite.material.opacity = 1 - k;
      if (k < 1) requestAnimationFrame(tick);
      else { this.group.remove(sprite); tex.dispose(); sprite.material.dispose(); }
    };
    requestAnimationFrame(tick);
  }

  /** Destroyed Hearts extinguish the nodes in its ribcage. */
  setHeartsLit(n) { this.heartsLit = n; }

  /** Freeze into a pose for the local jumpscare. */
  force(pose, seconds) { this.forced = { pose, until: performance.now() + seconds * 1000 }; }

  /** World position of the face, and the direction it faces. */
  face(out = new THREE.Vector3()) {
    this.head.updateWorldMatrix(true, false);
    return this.head.localToWorld(out.set(0, 0.2, -0.1));
  }

  nearDoor() {
    const f = this.map.floors[this.floor];
    const tx = Math.floor(this.x / TILE), ty = Math.floor(this.z / TILE);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = tx + dx, y = ty + dy;
      if (x >= 0 && y >= 0 && x < f.w && y < f.h && f.tiles[y * f.w + x] === TILE_DOOR) {
        if (dx === 0 && dy === 0) return true;
        // Only the neighbouring door tile counts if we're close to it.
        const cx = (x + 0.5) * TILE, cz = (y + 0.5) * TILE;
        if (Math.hypot(cx - this.x, cz - this.z) < 1.6) return true;
      }
    }
    return false;
  }

  /** Recompute the skeleton. Called only on quantised "stop-motion" frames. */
  applyPose(stepDt) {
    const s = this.snap;
    const forced = this.forced && performance.now() < this.forced.until ? this.forced.pose : null;
    const act = forced ?? s.act;
    const hunting = s.state === 'hunting';
    const twitching = this.has('stun') || this.has('torment');
    const moving = s.mv && !forced;

    if (moving) {
      const before = this.walkPhase;
      this.walkPhase += stepDt * (hunting ? 11 : 5.5);
      if (Math.floor(before / Math.PI) !== Math.floor(this.walkPhase / Math.PI)) this.onStep?.(this, hunting);
    }
    const w = moving ? Math.sin(this.walkPhase) : 0;
    const swing = hunting ? 0.75 : 0.45;

    // Doorway neck-snap + hunch.
    this.doorK += ((this.nearDoor() ? 1 : 0) - this.doorK) * 0.5;
    const hunch = this.doorK;

    this.hips.position.y = 1.6 - hunch * 0.12 + (moving ? Math.abs(w) * 0.05 : 0);
    // Upright parts lean forward with negative X (the model faces -Z).
    this.spine.rotation.set(-((hunting ? 0.7 : 0.28) + hunch * 0.3), 0, 0);
    this.legs.forEach((l) => {
      l.hip.rotation.x = w * swing * -l.s;
      l.knee.rotation.x = -0.25 - Math.max(0, w * l.s) * 0.7;
    });
    this.arms.forEach((a) => {
      a.sh.rotation.set(hunting ? -w * 0.9 * a.s - 0.3 : 0.15 + w * 0.15 * a.s, 0, a.s * (0.12 + hunch * 0.25));
      a.elbow.rotation.x = hunting ? 0.6 : 0.25;
    });
    this.shoulders.position.y = 1.02 - hunch * 0.1;
    this.shoulders.rotation.x = -hunch * 0.35;
    this.neck.rotation.x = -0.35;
    this.head.rotation.set(hunting ? 0.8 : 0.4, 0, this.headTilt + hunch * 1.25); // face stays on its prey
    this.jaw.scale.y = 1;

    switch (act) {
      case 'peek':
        this.spine.rotation.z = 0.55;
        this.head.rotation.z = this.headTilt + 1.1;
        this.arms[1].sh.rotation.set(0.9, 0, 0.6);
        break;
      case 'listen':
        this.head.rotation.z = this.headTilt + 0.7;
        this.head.rotation.x = 0.1;
        break;
      case 'windup':
        this.arms.forEach((a) => { a.sh.rotation.set(2.6, 0, a.s * 0.7); a.elbow.rotation.x = 0.4; });
        this.jaw.scale.y = 1.6;
        this.spine.rotation.x = 0.4;
        break;
      case 'lunge':
        this.arms.forEach((a) => { a.sh.rotation.set(1.55, 0, a.s * 0.15); a.elbow.rotation.x = 0.05; });
        this.spine.rotation.x = -1.0;
        this.jaw.scale.y = 2.1;
        this.head.rotation.x = 1.1;
        break;
      case 'scream': // the jumpscare: face-to-face, jaw unhinged
        this.spine.rotation.x = -0.25;
        this.neck.rotation.x = -0.1;
        this.head.rotation.set(0.15, 0, this.headTilt * 1.6);
        this.arms.forEach((a) => { a.sh.rotation.set(2.2, 0, a.s * 0.9); a.elbow.rotation.x = 0.9; });
        this.jaw.scale.y = 2.6;
        this.head.rotation.z += jitter(0.25);
        break;
      case 'retreat':
        this.arms.forEach((a) => { a.sh.rotation.set(3.0, 0, a.s * 0.3); });
        this.head.rotation.x = 0.9; // looking up at the ceiling it climbs into
        break;
    }

    if (twitching || (!moving && Math.random() < 0.08)) {
      const amp = twitching ? 1 : 0.35;
      this.head.rotation.x += jitter(0.6 * amp);
      this.head.rotation.z += jitter(0.9 * amp);
      this.arms.forEach((a) => {
        a.sh.rotation.x += jitter(0.7 * amp);
        a.sh.rotation.z += jitter(0.4 * amp);
        a.elbow.rotation.x += jitter(0.8 * amp);
      });
      this.spine.rotation.z += jitter(0.2 * amp);
      if (twitching) this.jaw.scale.y = 1 + Math.random() * 1.2;
    }
  }

  update(dt, t, visibleFloor) {
    const s = this.snap;
    const visible = !s.hid && s.f === visibleFloor;
    this.group.visible = visible || this.rise > 0.01;
    const forced = this.forced && performance.now() < this.forced.until;

    if (!forced) {
      const k = 1 - Math.exp(-dt * (s.state === 'hunting' ? 14 : 9));
      this.x += (s.x - this.x) * k;
      this.z += (s.z - this.z) * k;
      this.yaw = angleLerp(this.yaw, s.yaw, k);
    }
    // Retreat: claws its way up into the ceiling.
    const rising = s.act === 'retreat' && !forced;
    this.rise = rising ? Math.min(1, this.rise + dt * 1.2) : s.hid ? 0 : Math.max(0, this.rise - dt * 3);
    this.group.position.set(this.x, FLOOR_Y[s.f] + this.rise * this.rise * 3.2, this.z);
    this.group.rotation.y = this.yaw;

    // Stop-motion skeleton.
    this.poseAcc += dt;
    if (this.poseAcc >= 1 / POSE_HZ) {
      const stepDt = this.poseAcc;
      this.poseAcc = 0;
      this.applyPose(stepDt);
    }

    // Heart-nodes pulse (one goes dark per destroyed Heart).
    this.hearts.forEach((h, i) => {
      const lit = i < this.heartsLit;
      const p = (t * 1.3 + h.phase) % 1;
      const beat = Math.exp(-((p - 0.05) ** 2) / 0.002) + 0.6 * Math.exp(-((p - 0.22) ** 2) / 0.002);
      h.mat.color.setRGB(lit ? 0.5 + beat * 0.5 : 0.05, lit ? 0.02 : 0.02, lit ? 0.02 : 0.02);
      h.glow.visible = lit;
      h.glow.material.opacity = 0.35 + beat * 0.65;
    });
    this.eyeMat.color.setScalar(0.7 + Math.random() * 0.3);
    const watching = s.state === 'haunt' || s.state === 'stalking' || s.act === 'peek';
    for (const gl of this.glints) gl.material.opacity = watching ? 0.55 + Math.random() * 0.3 : 0.25;

    const burning = this.has('burn'), stunned = this.has('stun'), slowed = this.has('slow'), blocked = this.has('block');
    this.skin.emissive.setRGB(burning ? 0.5 : stunned ? 0.35 : blocked ? 0.5 : 0, burning ? 0.12 : stunned ? 0.28 : blocked ? 0.5 : 0, stunned ? 0.06 : blocked ? 0.55 : 0);
    this.skin.color.set(slowed ? 0x9fb0bc : 0xcdc3b4);
    const revealed = this.has('reveal') && !s.hid;
    this.revealFill.opacity = 0.32 * (0.75 + Math.sin(t * 6) * 0.25);
    for (const o of this.overlays) o.visible = revealed;

    if (visible && this.fx) {
      const y = FLOOR_Y[s.f];
      if (burning && Math.random() < 0.8) this.fx.glow.emit(this.x + jitter(0.3), y + 1 + Math.random() * 2, this.z + jitter(0.3), 0, 1, 0, 0.6, EMBER, -1, 1);
      if (this.has('torment') && Math.random() < 0.7) this.fx.glow.emit(this.x + jitter(0.3), y + 3 + Math.random() * 0.3, this.z + jitter(0.3), jitter(2), Math.random(), jitter(2), 0.5, VIOLET, 0, 2);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
      if (o.material && !Array.isArray(o.material)) o.material.dispose();
    });
    this.labelTex?.dispose();
  }
}

const EMBER = new THREE.Color(0xff6a10);
const VIOLET = new THREE.Color(0xa040ff);
