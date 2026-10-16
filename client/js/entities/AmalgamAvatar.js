// The Malphas Amalgam, client side. Step 9: anatomical body horror
// (keeperModel.js): a 3.2 m contorted frame, a cracked ribcage with seven wet
// hearts (one dies with each destroyed Heart), a split mandible that unhinges
// to its chest when it hunts, four spider limbs from its shoulder blades,
// glistening skin, black ichor, creeping shadows.
//
// Uncanny motion: limb/head transforms are only recomputed at a quantised
// ~13 Hz (stop-motion), while the body's position glides smoothly. It snaps
// its head sideways and hunches through doorways, and convulses when stunned
// or tormented.

import * as THREE from 'three';
import { FLOOR_Y, TILE, TILE_DOOR } from '/shared/constants.js';
import { STATUS_LABELS } from './MonsterAvatar.js';
import { buildKeeperModel } from './keeperModel.js';

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
    this.heartsLit = 7;
    this.liftK = 0;

    // Step 9: the anatomical nightmare (keeperModel.js). Sculpted facing +z; turned
    // to face -z like everything else (and the poses below mirror their pitch).
    const k = buildKeeperModel({ glowTex: fx?.softTex ?? null });
    this.model = k;
    this.skin = k.skin;
    this.mats = k.mats;
    this.group = new THREE.Group();
    this.body = k.body;
    this.group.add(k.group);
    k.group.rotation.y = Math.PI;
    this.hips = k.hips;
    this.legs = k.legs;
    this.spine = k.spine;
    this.shoulders = k.shoulders;
    this.arms = k.arms;
    this.neck = k.neck;
    this.head = k.head;
    this.jaws = k.jaws;
    this.hearts = k.hearts;
    this.spiderLimbs = k.spiderLimbs;
    this.tendrils = k.tendrils;
    this.eyeMat = k.eyeMat;
    this.glints = k.glints;
    this.headTilt = 0.32; // permanently crooked
    this.mouthK = 0;

    // Through-walls silhouette for Psychic Torment.
    this.revealFill = new THREE.MeshBasicMaterial({ color: 0x9a3cff, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false });
    this.revealWire = new THREE.MeshBasicMaterial({ color: 0xe6c4ff, wireframe: true, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false });
    this.overlays = [];
    const meshes = [];
    this.body.traverse((o) => { if (o.isMesh && !o.material.transparent) meshes.push(o); });
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
      this.label.position.y = 4.0;
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

  /** Turn this into a phantom: one dark translucent material, no hearts. */
  ghostify() {
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x0a0608, transparent: true, opacity: 0, depthWrite: false });
    this.group.traverse((o) => {
      if (o.isMesh && !this.overlays.includes(o)) o.material = this.ghostMat;
    });
    this.hearts.forEach((h) => { if (h.glow) h.glow.visible = false; });
    for (const t of this.tendrils) t.group.visible = false;
    this.ghost = true;
    if (this.label) this.label.visible = false;
  }

  setOpacity(v) {
    if (this.ghostMat) this.ghostMat.opacity = v;
    for (const gl of this.glints) gl.material.opacity = v;
  }

  /** Destroyed Hearts extinguish the nodes in its ribcage. */
  setHeartsLit(n) { this.heartsLit = n; }

  /** Freeze into a pose for the local jumpscare. */
  force(pose, seconds) { this.forced = { pose, until: performance.now() + seconds * 1000 }; }

  /** World position of the face, and the direction it faces. */
  face(out = new THREE.Vector3()) {
    this.head.updateWorldMatrix(true, false);
    return this.head.localToWorld(out.set(0, 0.2, 0.13));
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
    // The march toward activity (Step 8) is as heavy and loud as a hunt.
    const hunting = s.state === 'hunting' || (s.state === 'investigating' && s.ip === 'approach');
    const twitching = this.has('stun') || this.has('torment') || this.has('confused');
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

    // (Poses are authored for the old -z-facing figure: X() mirrors their pitch for this one.)
    const X = (v) => -v;
    this.hips.position.y = 1.75 - hunch * 0.14 + (moving ? Math.abs(w) * 0.06 : 0);
    this.spine.rotation.set(X(-((hunting ? 0.7 : 0.28) + hunch * 0.3)), 0, 0);
    this.legs.forEach((l) => {
      l.hip.rotation.x = X(w * swing * -l.s) - 0.15;
      l.knee.rotation.x = 0.45 + Math.max(0, w * l.s) * 0.5; // the knees bend the wrong way
      l.ankle.rotation.x = -0.9 - Math.max(0, -w * l.s) * 0.3;
    });
    this.arms.forEach((a) => {
      a.sh.rotation.set(X(hunting ? -w * 0.9 * a.s - 0.3 : 0.15 + w * 0.15 * a.s), 0, a.s * (0.12 + hunch * 0.25));
      a.elbow.rotation.x = X(hunting ? 0.6 : 0.25);
    });
    this.shoulders.position.y = 1.15 - hunch * 0.1;
    this.shoulders.rotation.x = X(-hunch * 0.35);
    this.neck.rotation.x = X(-0.35);
    this.head.rotation.set(X(hunting ? 0.8 : 0.4), 0, this.headTilt + hunch * 1.25); // face stays on its prey
    // The split mandible: ajar while it stalks, unhinged to its chest when it hunts.
    let mouth = hunting ? 0.75 : 0.12;
    // The spider limbs: folded over its back, flexing; flung forward when it hunts.
    const reach = hunting ? 0.6 : 0;
    this.spiderLimbs.forEach((L) => {
      const f = Math.sin(this.walkPhase * 0.5 + L.phase + performance.now() / 700) * 0.18;
      L.base.rotation.x = -0.9 - L.row * 0.2 + reach * 0.6 + f;
      L.segs[1].rotation.x = 0.9 + f * 1.5 - reach * 0.4;
      L.segs[2].rotation.x = 0.8 - f - reach * 0.2;
    });

    switch (act) {
      case 'peek':
        this.spine.rotation.z = 0.55;
        this.head.rotation.z = this.headTilt + 1.1;
        this.arms[1].sh.rotation.set(X(0.9), 0, 0.6);
        break;
      case 'listen':
        this.head.rotation.z = this.headTilt + 0.7;
        this.head.rotation.x = X(0.1);
        mouth = 0.25;
        break;
      case 'windup':
        this.arms.forEach((a) => { a.sh.rotation.set(X(2.6), 0, a.s * 0.7); a.elbow.rotation.x = X(0.4); });
        mouth = 0.45;
        this.spine.rotation.x = X(0.4);
        break;
      case 'lunge':
        this.arms.forEach((a) => { a.sh.rotation.set(X(1.55), 0, a.s * 0.15); a.elbow.rotation.x = X(0.05); });
        this.spine.rotation.x = X(-1.0);
        mouth = 0.85;
        this.head.rotation.x = X(1.1);
        this.spiderLimbs.forEach((L) => { L.base.rotation.x = 0.3; L.segs[1].rotation.x = 0.2; });
        break;
      case 'claw':
        this.arms[1].sh.rotation.set(X(2.6), 0, 0.9);
        this.arms[1].elbow.rotation.x = X(1.2);
        this.spine.rotation.y = -0.4;
        break;
      case 'shockwave':
        this.arms.forEach((a) => { a.sh.rotation.set(X(3.0), 0, a.s * 0.4); a.elbow.rotation.x = X(0.2); });
        this.spine.rotation.x = X(0.25);
        mouth = 0.7;
        break;
      case 'tendril':
        this.arms[0].sh.rotation.set(X(1.5), 0, -0.1);
        this.arms[0].elbow.rotation.x = 0;
        this.spine.rotation.x = X(-0.6);
        mouth = 0.6;
        break;
      case 'smash':
        this.arms.forEach((a) => { a.sh.rotation.set(X(2.9), 0, a.s * 0.15); a.elbow.rotation.x = X(0.6); });
        break;
      case 'confused':
        this.arms.forEach((a) => {
          a.sh.rotation.set(X(2.7 + jitter(0.4)), 0, a.s * (0.9 + jitter(0.3)));
          a.elbow.rotation.x = X(2.0 + jitter(0.5));
        });
        this.spine.rotation.x = X(-0.3 + jitter(0.3));
        mouth = 0.7 + Math.random() * 0.3;
        break;
      case 'scream':
        // The capture: face to face, its mandibles snapping wide inches from you,
        // the spider limbs reaching round to grip the edges of your sight.
        this.spine.rotation.x = X(-0.25);
        this.neck.rotation.x = X(-0.1);
        this.head.rotation.set(X(0.15), 0, this.headTilt * 1.6);
        this.arms.forEach((a) => { a.sh.rotation.set(X(2.2), 0, a.s * 0.9); a.elbow.rotation.x = X(0.9); });
        mouth = 1;
        this.head.rotation.z += jitter(0.25);
        this.spiderLimbs.forEach((L) => {
          L.base.rotation.x = 0.4 + jitter(0.08);
          L.base.rotation.z = L.s * (0.5 + L.row * 0.25);
          L.segs[1].rotation.x = 0.4 + jitter(0.1);
          L.segs[2].rotation.x = 1.2 + jitter(0.15);
        });
        break;
      case 'retreat':
        this.arms.forEach((a) => { a.sh.rotation.set(X(3.0), 0, a.s * 0.3); });
        this.head.rotation.x = X(0.9);
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
      if (twitching) mouth = 0.3 + Math.random() * 0.7;
    }
    this.mouth(mouth);
  }

  /** Open the split mandible (0 shut … 1 unhinged to the chest, the halves splayed). */
  mouth(k) {
    this.mouthK = k;
    for (const j of this.jaws) {
      j.hinge.rotation.set(k * 1.25, -j.s * k * 0.35, j.s * k * 0.55);
    }
  }

  update(dt, t, visibleFloor) {
    const s = this.snap;
    const forced = this.forced && performance.now() < this.forced.until;
    const visible = (!s.hid && s.f === visibleFloor) || forced; // (the capture screen always shows its face)
    this.group.visible = visible || this.rise > 0.01;
    if (this.label) this.label.visible = !forced;

    if (!forced) {
      const k = 1 - Math.exp(-dt * (s.state === 'hunting' ? 14 : 9));
      this.x += (s.x - this.x) * k;
      this.z += (s.z - this.z) * k;
      this.yaw = angleLerp(this.yaw, s.yaw, k);
    }
    // Retreat: claws its way up into the ceiling.
    const rising = s.act === 'retreat' && !forced;
    this.rise = rising ? Math.min(1, this.rise + dt * 1.2) : s.hid ? 0 : Math.max(0, this.rise - dt * 3);
    // Lifted by a vortex / geyser, or swept away by the wind dragon.
    const lifted = this.has('lift') || this.has('carried');
    this.liftK += ((lifted ? 1 : 0) - this.liftK) * Math.min(1, dt * 6);
    this.group.position.set(this.x, FLOOR_Y[s.f] + this.rise * this.rise * 3.2 + this.liftK * 1.4, this.z);
    this.group.rotation.y = this.yaw + (lifted ? t * 5 : 0);

    // Stop-motion skeleton.
    this.poseAcc += dt;
    if (this.poseAcc >= 1 / POSE_HZ) {
      const stepDt = this.poseAcc;
      this.poseAcc = 0;
      this.applyPose(stepDt);
    }

    // Heart-nodes pulse (one goes dark per destroyed Heart).
    this.hearts.forEach((h, i) => {
      const lit = i < this.heartsLit && !this.ghost;
      const p = (t * 1.3 + h.phase) % 1;
      const beat = Math.exp(-((p - 0.05) ** 2) / 0.002) + 0.6 * Math.exp(-((p - 0.22) ** 2) / 0.002);
      // Wet and pulsing while its Heart lives; grey and shrivelled once destroyed.
      h.mat.color.setRGB(lit ? 0.3 + beat * 0.15 : 0.08, lit ? 0.02 : 0.06, lit ? 0.03 : 0.05);
      h.mat.emissiveIntensity = lit ? 0.4 + beat * 4.5 : 0; // the beat blooms
      h.node.scale.setScalar(h.base * (lit ? 1 + beat * 0.14 : 0.7));
      if (h.glow) {
        h.glow.visible = lit;
        h.glow.material.opacity = 0.35 + beat * 0.65;
      }
    });
    // Creeping shadows: tendrils of dark reaching out across the floor (further when it hunts).
    const hunt = s.state === 'hunting' || (s.state === 'investigating' && s.ip === 'approach');
    for (const td of this.tendrils) {
      td.group.scale.z = (hunt ? 2.4 : 1.4) + Math.sin(t * 1.3 + td.phase) * 0.35;
      td.group.rotation.y += Math.sin(t * 0.7 + td.phase) * dt * 0.2;
    }
    // Black ichor dripping from its jaw and its open chest.
    if (visible && this.fx && !this.ghost && Math.random() < 0.35) {
      const src = Math.random() < 0.5 ? this.head : this.spine;
      const p0 = (this._drip ??= new THREE.Vector3()).set(jitter(0.06), src === this.head ? -0.02 : 0.5 + Math.random() * 0.4, src === this.head ? 0.1 : 0.12);
      src.localToWorld(p0);
      this.fx.dust.emit(p0.x, p0.y, p0.z, 0, -2.5, 0, 0.7, ICHOR, 6, 0);
    }
    this.eyeMat.color.setRGB(1, 0.05, 0.03).multiplyScalar(4.5 + Math.random() * 2.5); // pinpoint red, flickering
    const watching = s.state === 'haunt' || s.state === 'stalking' || s.act === 'peek';
    if (!this.ghost) for (const gl of this.glints) gl.material.opacity = watching ? 0.55 + Math.random() * 0.3 : 0.25;

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
const ICHOR = new THREE.Color(0x050203);
const VIOLET = new THREE.Color(0xa040ff);
