// Client view of a MonsterBody (Step 3: the debug Training Husk). A gaunt
// ash-grey figure with procedural animation, a floating debug status panel,
// damage numbers, and per-status VFX: golden sigil rings (stunned), violet
// writhing (tormented), embers (burning), dripping water (slowed), a silver
// flash (blocked), and a depth-test-free silhouette visible through walls
// (Psychic Torment reveal).

import * as THREE from 'three';
import { FLOOR_Y } from '/shared/constants.js';

export const STATUS_LABELS = {
  stun: ['STUNNED', '#ffd76a'],
  frozen: ['FROZEN IN CHAINS', '#ffe08a'],
  confused: ['MIND FRACTURED', '#ff3a5a'],
  root: ['ROOTED', '#7fd36a'],
  pinned: ['PINNED', '#5ac8ff'],
  pull: ['PULLED', '#a060ff'],
  lift: ['LIFTED', '#9ef0e0'],
  carried: ['SWEPT AWAY', '#9ef0e0'],
  reach: ['REACH SHORTENED', '#c070ff'],
  calm: ['ENRAGE STRIPPED', '#d8e0ea'],
  torment: ['TORMENTED', '#c070ff'],
  slow: ['SLOWED', '#6ad0ff'],
  burn: ['BURNING', '#ff8a3a'],
  knock: ['KNOCKED BACK', '#9ef0e0'],
  block: ['BLOCKED', '#e6ebf0'],
  reveal: ['VISIBLE THROUGH WALLS', '#c58cff'],
};

const DAMAGE_COLORS = { fire: '#ff8a3a', water: '#6ad0ff', earth: '#b8d070' };

function sigilTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(255,220,130,1)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(128, 128, 100, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,230,160,1)';
  ctx.font = '20px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const glyphs = '☩✠☸☼☀✡☥☩✠☸☼☀';
  for (let i = 0; i < glyphs.length; i++) {
    const a = (i / glyphs.length) * Math.PI * 2;
    ctx.save();
    ctx.translate(128 + Math.cos(a) * 109, 128 + Math.sin(a) * 109);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(glyphs[i], 0, 0);
    ctx.restore();
  }
  return new THREE.CanvasTexture(c);
}

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

const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class MonsterAvatar {
  constructor(snap, fx) {
    this.id = snap.id;
    this.fx = fx;
    this.x = snap.x;
    this.z = snap.z;
    this.yaw = snap.yaw;
    this.floor = snap.f;
    this.snap = snap;
    this.anim = 0;
    this.windup = 0;
    this.deathK = 0;
    this.blockFlash = 0;
    this.labelKey = '';
    this.damageNumbers = [];

    this.skin = new THREE.MeshStandardMaterial({ color: 0x5e5a52, roughness: 0.9 });
    const rag = new THREE.MeshStandardMaterial({ color: 0x15110f, roughness: 1, side: THREE.DoubleSide });
    const hollow = new THREE.MeshBasicMaterial({ color: 0x000000 });

    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    const limb = (len, r, mat = this.skin) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, len, 6).translate(0, -len / 2, 0), mat);
      return m;
    };

    // Legs (pivot at hip)
    this.legs = [-1, 1].map((s) => {
      const hip = new THREE.Group();
      hip.position.set(s * 0.12, 1.12, 0);
      hip.add(limb(0.58, 0.055));
      const knee = new THREE.Group();
      knee.position.y = -0.58;
      knee.add(limb(0.55, 0.045));
      hip.add(knee);
      this.body.add(hip);
      return { hip, knee };
    });
    // Torso + shroud
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.62, 4, 10), this.skin);
    torso.position.y = 1.55;
    torso.scale.set(1, 1, 0.65);
    this.body.add(torso);
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 1.05, 9, 1, true), rag);
    shroud.position.y = 1.15;
    this.body.add(shroud);
    // Arms (pivot at shoulder), absurdly long
    this.arms = [-1, 1].map((s) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.25, 1.92, 0);
      shoulder.add(limb(0.62, 0.045));
      const elbow = new THREE.Group();
      elbow.position.y = -0.62;
      elbow.add(limb(0.68, 0.04));
      for (let f = -1; f <= 1; f++) {
        const finger = limb(0.22, 0.012);
        finger.position.set(f * 0.025, -0.68, 0);
        finger.rotation.z = f * 0.15;
        elbow.add(finger);
      }
      shoulder.add(elbow);
      this.body.add(shoulder);
      return { shoulder, elbow, s };
    });
    // Neck + head
    this.head = new THREE.Group();
    this.head.position.set(0, 2.08, 0.03);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.18, 6), this.skin);
    neck.position.y = 0.04;
    this.head.add(neck);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), this.skin);
    skull.scale.set(0.9, 1.4, 1);
    skull.position.y = 0.22;
    this.head.add(skull);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), hollow);
      eye.position.set(s * 0.05, 0.26, -0.11);
      this.head.add(eye);
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.02), hollow);
    mouth.position.set(0, 0.1, -0.12);
    this.head.add(mouth);
    this.body.add(this.head);

    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    // Through-walls silhouette + wireframe (Psychic Torment reveal).
    this.revealFill = new THREE.MeshBasicMaterial({ color: 0x9a3cff, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false });
    this.revealWire = new THREE.MeshBasicMaterial({ color: 0xe6c4ff, wireframe: true, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false });
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

    // Sigil rings (stunned)
    const sigil = sigilTexture();
    this.rings = [0.5, 1.3, 2.1].map((y, i) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.85, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: sigil, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0 }),
      );
      m.position.y = y;
      m.userData.dir = i % 2 ? 1 : -1;
      this.group.add(m);
      return m;
    });

    // Debug status panel
    this.label = textSprite(512, 200, 2.3);
    this.label.sprite.position.y = 3.15;
    this.group.add(this.label.sprite);
    this.setSnapshot(snap);
  }

  setSnapshot(s) {
    if (s.f !== this.floor) {
      this.x = s.x;
      this.z = s.z;
    }
    this.snap = s;
    this.floor = s.f;
    const key = `${s.hp}|${s.st.join(',')}|${s.dead}|${s.act}`;
    if (key !== this.labelKey) {
      this.labelKey = key;
      this.drawLabel(s);
    }
  }

  has(code) { return this.snap.st.includes(code); }

  drawLabel(s) {
    const { ctx, tex, canvas } = this.label;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(8,4,6,0.72)';
    ctx.fillRect(0, 0, 512, 200);
    ctx.strokeStyle = 'rgba(176,141,74,0.6)';
    ctx.strokeRect(1, 1, 510, 198);
    ctx.font = 'bold 26px Cinzel, Georgia, serif';
    ctx.fillStyle = '#d9cdb8';
    ctx.textAlign = 'center';
    ctx.fillText(s.dead ? 'HUSK CRUMBLED — RE-FORMING' : s.act === 'windup' ? 'TEST MONSTER HUSK — SWIPING!' : 'TEST MONSTER HUSK', 256, 36);
    // HP bar
    const k = Math.max(0, s.hp / s.maxHp);
    ctx.fillStyle = '#2a0a0c';
    ctx.fillRect(24, 54, 464, 26);
    ctx.fillStyle = k > 0.5 ? '#b0222c' : k > 0.25 ? '#d4602c' : '#ff3a2a';
    ctx.fillRect(24, 54, 464 * k, 26);
    ctx.font = 'bold 20px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(`HP ${s.hp} / ${s.maxHp}`, 256, 74);
    // Status chips
    ctx.font = 'bold 18px ui-monospace, Menlo, monospace';
    let x = 24, y = 98;
    const chips = s.st.length ? s.st : ['none'];
    for (const code of chips) {
      const [label, color] = STATUS_LABELS[code] ?? ['NO STATUS', '#8a7f70'];
      const w = ctx.measureText(label).width + 20;
      if (x + w > 490) { x = 24; y += 34; }
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, y, w, 28);
      ctx.strokeStyle = color;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 27);
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(label, x + 10, y + 20);
      x += w + 8;
    }
    tex.needsUpdate = true;
  }

  showDamage(amount, source) {
    const d = textSprite(128, 64, 0.9);
    const { ctx, tex } = d;
    ctx.font = 'bold 44px Cinzel, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#000';
    const text = `-${Math.round(amount)}`;
    ctx.strokeText(text, 64, 46);
    ctx.fillStyle = DAMAGE_COLORS[source] ?? '#ff4040';
    ctx.fillText(text, 64, 46);
    tex.needsUpdate = true;
    d.sprite.position.set((Math.random() - 0.5) * 0.6, 2.5, (Math.random() - 0.5) * 0.6);
    this.group.add(d.sprite);
    this.damageNumbers.push({ ...d, age: 0 });
  }

  blocked() { this.blockFlash = 1; }

  update(dt, t, visibleFloor) {
    const s = this.snap;
    const k = 1 - Math.exp(-dt * 10);
    this.x += (s.x - this.x) * k;
    this.z += (s.z - this.z) * k;
    this.yaw = angleLerp(this.yaw, s.yaw, k);
    this.group.visible = s.f === visibleFloor;
    const lifted = this.has('lift') || this.has('carried');
    this.liftK = (this.liftK ?? 0) + ((lifted ? 1 : 0) - (this.liftK ?? 0)) * Math.min(1, dt * 6);
    this.group.position.set(this.x, FLOOR_Y[s.f] + this.liftK * 1.2, this.z);
    this.group.rotation.y = this.yaw + (lifted ? t * 6 : 0);

    const stunned = this.has('stun') || this.has('frozen');
    const tormented = this.has('torment');
    const knocked = this.has('knock');
    const burning = this.has('burn');
    const slowed = this.has('slow');
    const revealed = this.has('reveal');

    // Body animation
    if (!stunned) this.anim += dt * (s.mv ? 7 * (slowed ? 0.6 : 1) : 1.2);
    const walk = s.mv && !stunned ? Math.sin(this.anim) : 0;
    this.legs.forEach((l, i) => {
      l.hip.rotation.x = walk * 0.5 * (i ? 1 : -1);
      l.knee.rotation.x = Math.max(0, -walk * (i ? 1 : -1)) * 0.6;
    });
    const windupTarget = s.act === 'windup' ? 1 : 0;
    this.windup += (windupTarget - this.windup) * Math.min(1, dt * (windupTarget ? 4 : 10));
    this.arms.forEach((a) => {
      a.shoulder.rotation.x = -walk * 0.35 * a.s + Math.sin(this.anim * 0.5) * 0.05 + this.windup * 2.4;
      a.shoulder.rotation.z = a.s * (0.08 + this.windup * 0.35);
      a.elbow.rotation.x = 0.15 + this.windup * 0.6;
    });
    this.head.rotation.set(-0.25, 0, Math.sin(this.anim * 0.4) * 0.25); // hunched forward
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);

    if (tormented) {
      // Clutches its skull, convulsing.
      this.arms.forEach((a) => {
        a.shoulder.rotation.x = 2.6 + Math.sin(t * 41 + a.s) * 0.25;
        a.shoulder.rotation.z = a.s * 0.9;
        a.elbow.rotation.x = 1.9;
      });
      this.head.rotation.z = Math.sin(t * 37) * 0.5;
      this.head.rotation.x = -0.5 + Math.sin(t * 29) * 0.3;
      this.body.position.x = (Math.random() - 0.5) * 0.06;
    }
    if (knocked) this.body.rotation.x = 0.35; // reels backwards

    // Death: fold to the floor.
    this.deathK += ((s.dead ? 1 : 0) - this.deathK) * Math.min(1, dt * 4);
    if (this.deathK > 0.01) {
      this.body.rotation.x = 1.4 * this.deathK;
      this.body.position.y = -0.3 * this.deathK;
    }

    // Material tints
    this.blockFlash = Math.max(0, this.blockFlash - dt * 2.5);
    const e = this.skin.emissive;
    e.setRGB(0, 0, 0);
    if (burning) e.setRGB(0.5 + Math.random() * 0.3, 0.12, 0);
    if (this.blockFlash > 0) e.setRGB(this.blockFlash * 0.8, this.blockFlash * 0.85, this.blockFlash * 0.95);
    if (stunned) e.setRGB(0.35, 0.28, 0.08);
    this.skin.color.set(slowed ? 0x4a5a66 : 0x5e5a52);

    // Rings
    this.rings.forEach((r) => {
      r.material.opacity += ((stunned ? 0.95 : 0) - r.material.opacity) * Math.min(1, dt * 8);
      r.rotation.y += dt * 1.6 * r.userData.dir;
      r.visible = r.material.opacity > 0.01;
    });

    // Reveal through walls
    const pulse = 0.75 + Math.sin(t * 6) * 0.25;
    this.revealFill.opacity = 0.32 * pulse;
    for (const o of this.overlays) o.visible = revealed;

    // Particle accents
    if (this.group.visible && this.fx) {
      const wx = this.x, wz = this.z, wy = FLOOR_Y[s.f];
      if (burning && Math.random() < 0.8) {
        this.fx.glow.emit(wx + (Math.random() - 0.5) * 0.5, wy + 0.5 + Math.random() * 1.6, wz + (Math.random() - 0.5) * 0.5,
          0, 1 + Math.random(), 0, 0.6, EMBER, -1, 1);
      }
      if (slowed && Math.random() < 0.5) {
        this.fx.glow.emit(wx + (Math.random() - 0.5) * 0.5, wy + 1 + Math.random(), wz + (Math.random() - 0.5) * 0.5,
          0, -0.5, 0, 0.7, DRIP, 5, 0);
      }
      if (tormented && Math.random() < 0.7) {
        this.fx.glow.emit(wx + (Math.random() - 0.5) * 0.4, wy + 2.2 + Math.random() * 0.3, wz + (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2, 0.5, VIOLET, 0, 2);
      }
    }

    // Damage numbers
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const d = this.damageNumbers[i];
      d.age += dt;
      d.sprite.position.y += dt * 0.9;
      d.sprite.material.opacity = Math.max(0, 1 - d.age / 1.2);
      if (d.age > 1.2) {
        this.group.remove(d.sprite);
        d.tex.dispose();
        d.sprite.material.dispose();
        this.damageNumbers.splice(i, 1);
      }
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
      if (o.material && !Array.isArray(o.material)) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}

const EMBER = new THREE.Color(0xff6a10);
const DRIP = new THREE.Color(0x5ac8ff);
const VIOLET = new THREE.Color(0xa040ff);
