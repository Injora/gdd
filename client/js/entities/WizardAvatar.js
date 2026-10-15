// A teammate (human or bot) as everyone else sees them: a robed wizard in the
// old style. Layered robes (an open outer cloak with a trim in their colour, a
// house crest on the breast), a striped scarf whose tails swing, a pointed hat
// (or a deep hood), articulated arms holding a carved wand with a glowing core,
// cloth that sways as they walk, a contact shadow underfoot, a faint name, a
// visible Lumos beam, and the glassy shimmer of the Disillusionment Charm.

import * as THREE from 'three';
import { FLOOR_Y, CROUCH_EYE_HEIGHT, EYE_HEIGHT } from '/shared/constants.js';
import { crestTexture } from '../world/textures.js';

const GLYPHS = { black: '☾', fire: '✹', water: '≈', earth: '▲', wind: '≋', white: '☀', void: '⊘' };
const HOODED = new Set(['injorath', 'himanshu']);

function nameSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '28px "IM Fell English", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.4, 0.35, 1);
  return s;
}

/** Scarf stripes in the house colour and gold. */
function scarfTexture(color) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#c8a040' : color;
    ctx.fillRect(0, i * 8, 16, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let shadowTex = null;
function contactShadow() {
  if (!shadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.75)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  m.position.y = 0.015;
  m.renderOrder = 1;
  return m;
}

const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const lathe = (pts, seg = 20, phiStart = 0, phiLength = Math.PI * 2) =>
  new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLength);

export class WizardAvatar {
  constructor(info, wizard) {
    this.id = info.id;
    this.wizard = wizard;
    const color = new THREE.Color(wizard.color);
    const robeColor = color.clone().multiplyScalar(0.16).lerp(new THREE.Color(0x0b0a0c), 0.55);
    this.mats = [];
    const mat = (m) => { this.mats.push(m); return m; };

    const robeMat = mat(new THREE.MeshStandardMaterial({ color: robeColor, roughness: 0.92 }));
    const cloakMat = mat(new THREE.MeshStandardMaterial({ color: 0x0c0a0e, roughness: 0.85, side: THREE.DoubleSide }));
    const liningMat = mat(new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.35), roughness: 0.6, side: THREE.BackSide }));
    const trimMat = mat(new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, emissive: color, emissiveIntensity: 0.08 }));
    const goldMat = mat(new THREE.MeshStandardMaterial({ color: 0xc8a040, roughness: 0.35, metalness: 0.85 }));
    const skinMat = mat(new THREE.MeshStandardMaterial({ color: 0xd2b49a, roughness: 0.6 }));
    const hairMat = mat(new THREE.MeshStandardMaterial({ color: [0x1a120c, 0x3a2414, 0x0a0806, 0x5a4a3a][wizard.id.length % 4], roughness: 0.9 }));
    const bootMat = mat(new THREE.MeshStandardMaterial({ color: 0x120c08, roughness: 0.5 }));
    const wandMat = mat(new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.55 }));
    const scarfMat = mat(new THREE.MeshStandardMaterial({ map: scarfTexture(wizard.color), roughness: 0.95 }));
    const crestMat = this.crestMat = mat(new THREE.MeshStandardMaterial({ map: crestTexture(wizard.color, GLYPHS[wizard.source] ?? '✦'), transparent: true, roughness: 0.5, metalness: 0.3 }));
    this.tipMat = new THREE.MeshBasicMaterial({ color });

    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.group.add(this.shadow = contactShadow());

    // Boots (step under the hem)
    this.boots = [-1, 1].map((s) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.26), bootMat);
      b.position.set(s * 0.11, 0.045, -0.02);
      this.body.add(b);
      return b;
    });
    // Inner robe
    const robe = new THREE.Mesh(lathe([[0.36, 0.05], [0.34, 0.3], [0.27, 0.8], [0.22, 1.2], [0.2, 1.38], [0.1, 1.48], [0, 1.5]]), robeMat);
    this.body.add(robe);
    // Outer cloak: open at the front, lined, trimmed; its skirt sways.
    this.skirt = new THREE.Group();
    this.skirt.position.y = 1.05;
    const skirtGeo = lathe([[0.27, 0], [0.33, -0.45], [0.42, -0.85], [0.47, -1.02]], 24, Math.PI * 0.62, Math.PI * 1.76);
    this.skirt.add(new THREE.Mesh(skirtGeo, cloakMat));
    this.skirt.add(new THREE.Mesh(skirtGeo, liningMat));
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.018, 5, 40, Math.PI * 1.76), trimMat);
    hem.rotation.x = Math.PI / 2;
    hem.rotation.z = Math.PI * 0.62 - Math.PI / 2;
    hem.position.y = -1.02;
    this.skirt.add(hem);
    this.body.add(this.skirt);
    const shoulders = new THREE.Mesh(lathe([[0.27, 1.05], [0.29, 1.28], [0.24, 1.42], [0.12, 1.5]], 24, Math.PI * 0.7, Math.PI * 1.6), cloakMat);
    this.body.add(shoulders);
    for (const side of [-1, 1]) {
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.55, 0.012), trimMat);
      lapel.position.set(side * 0.13, 1.2, 0.24);
      lapel.rotation.z = side * 0.12;
      this.body.add(lapel);
    }
    const crest = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), crestMat);
    crest.position.set(-0.11, 1.3, 0.235);
    this.body.add(crest);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.018, 5, 20), goldMat);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.98;
    this.body.add(belt);

    // Head, hair, and a pointed hat (or a deep hood).
    this.head = new THREE.Group();
    this.head.position.set(0, 1.58, 0);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skinMat);
    face.scale.set(0.9, 1.08, 0.95);
    this.head.add(face);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0a0806 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), eyeMat);
      eye.position.set(sx * 0.04, 0.02, 0.1);
      this.head.add(eye);
    }
    const hooded = HOODED.has(wizard.id);
    if (hooded) {
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), cloakMat);
      hood.rotation.x = -0.35;
      hood.position.set(0, 0.03, -0.02);
      this.head.add(hood);
      const peak = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 10), cloakMat);
      peak.position.set(0, 0.06, -0.17);
      peak.rotation.x = -1.2;
      this.head.add(peak);
      const hoodTrim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 5, 24), trimMat);
      hoodTrim.position.set(0, 0.0, 0.06);
      hoodTrim.rotation.x = -0.25;
      this.head.add(hoodTrim);
    } else {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
      hair.position.y = 0.02;
      hair.rotation.x = -0.2;
      this.head.add(hair);
      const brim = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.3, 28).rotateX(-Math.PI / 2), cloakMat);
      brim.position.y = 0.08;
      this.head.add(brim);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.14, 0.04, 20, 1, true), trimMat);
      band.position.y = 0.11;
      this.head.add(band);
      // The famous crooked point: three stacked, bending cones.
      let y = 0.09, tilt = 0;
      const tipGroup = new THREE.Group();
      let parent = this.head;
      for (const [r0, r1, h] of [[0.14, 0.09, 0.2], [0.09, 0.045, 0.18], [0.045, 0.001, 0.17]]) {
        const seg = new THREE.Group();
        seg.position.y = y;
        seg.rotation.x = tilt;
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 14), cloakMat);
        cone.position.y = h / 2;
        seg.add(cone);
        parent.add(seg);
        parent = seg;
        y = h;
        tilt = -0.32;
      }
      this.hatTip = parent;
      void tipGroup;
    }
    this.body.add(this.head);

    // Scarf: a striped wrap and two swinging tails.
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.045, 8, 20), scarfMat);
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = 1.44;
    this.body.add(wrap);
    this.scarfTails = [-1, 1].map((s, i) => {
      const tail = new THREE.Group();
      tail.position.set(s * 0.07, 1.42, 0.12);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42 + i * 0.08, 0.018).translate(0, -(0.21 + i * 0.04), 0), scarfMat);
      tail.add(strip);
      this.body.add(tail);
      return tail;
    });

    // Arms: shoulder → elbow → hand. The right one holds the wand and follows your aim.
    const arm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(side * 0.26, 1.36, 0);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.32, 8).translate(0, -0.16, 0), cloakMat);
      sh.add(upper);
      const el = new THREE.Group();
      el.position.y = -0.3;
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.05, 0.3, 8).translate(0, -0.15, 0), cloakMat);
      el.add(fore);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 5, 14), trimMat);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = -0.28;
      el.add(cuff);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), skinMat);
      hand.position.y = -0.33;
      el.add(hand);
      sh.add(el);
      this.body.add(sh);
      return { sh, el, hand, side };
    };
    this.armL = arm(-1);
    this.armR = arm(1);
    // The wand: a carved handle, a tapered shaft, and its glowing core.
    this.wand = new THREE.Group();
    this.wand.position.y = -0.35;
    this.wand.rotation.x = Math.PI; // continuing the forearm, tip first
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.012, 0.1, 8), wandMat);
    this.wand.add(handle);
    for (const y of [-0.04, 0.0, 0.04]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 4, 10), goldMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      this.wand.add(ring);
    }
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.01, 0.32, 6), wandMat);
    shaft.position.y = 0.2;
    this.wand.add(shaft);
    this.tip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), this.tipMat);
    this.tip.position.y = 0.37;
    this.wand.add(this.tip);
    this.armR.el.add(this.wand);

    this.label = nameSprite(info.name, wizard.color);
    this.label.position.y = 2.3;
    this.group.add(this.label);

    // Teammates' Lumos: a visible beam from the wand.
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 1.6, 7, 16, 1, true).translate(0, -3.5, 0).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(wizard.lightTint) }, uOpacity: { value: 0 } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vZ; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vZ = position.z; gl_Position = projectionMatrix*mv; }',
        fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV; varying float vZ; void main(){ float e = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float a = uOpacity * e * (1.0 - smoothstep(0.0, 7.0, vZ)); gl_FragColor = vec4(uColor * a, a); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
    this.beam.visible = false;
    this.group.add(this.beam);

    this.group.traverse((o) => {
      if (o.isMesh && !o.material.isMeshBasicMaterial && !o.material.isShaderMaterial) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    this.light = null;
    this.x = this.tx = 0;
    this.z = this.tz = 0;
    this.yaw = this.tyaw = 0;
    this.pitch = this.tpitch = 0;
    this.floor = 0;
    this.state = {};
    this.walk = 0;
    this.crouchK = 0;
    this.invisK = 0;
    this.initialized = false;
    this.castK = 0;
    this._tipWorld = new THREE.Vector3();
  }

  /** Wand recoil + flare when this wizard casts. */
  castPulse() { this.castK = 1; }

  attachLight(light) {
    this.light = light;
    light.color.set(this.wizard.lightTint);
  }

  setSnapshot(s) {
    if (!this.initialized || s.f !== this.floor) {
      this.x = s.x;
      this.z = s.z;
      this.yaw = s.yaw;
      this.initialized = true;
    }
    this.tx = s.x;
    this.tz = s.z;
    this.tyaw = s.yaw;
    this.tpitch = s.pitch;
    this.floor = s.f;
    this.state = s;
  }

  /** @param visibleFloors floors being drawn (the balcony and the Foyer see each other) */
  update(dt, t, camera, visibleFloors) {
    const k = 1 - Math.exp(-dt * 12);
    this.x += (this.tx - this.x) * k;
    this.z += (this.tz - this.z) * k;
    this.yaw = angleLerp(this.yaw, this.tyaw, k);
    this.pitch += (this.tpitch - this.pitch) * k;
    this.crouchK += ((this.state.cr ? 1 : 0) - this.crouchK) * k;

    const floors = Array.isArray(visibleFloors) ? visibleFloors : [visibleFloors];
    const onFloor = floors.includes(this.floor);
    this.group.visible = onFloor;
    const y = FLOOR_Y[this.floor];
    this.group.position.set(this.x, y, this.z);
    this.group.rotation.y = this.yaw + Math.PI; // models face +z; yaw 0 looks -z

    const moving = !!this.state.mv;
    if (moving) this.walk += dt * (this.state.sp ? 11 : 7);
    const sway = moving ? Math.sin(this.walk) : 0;
    this.body.position.y = Math.abs(sway) * 0.035;
    this.body.rotation.z = sway * 0.025;
    // Cloth: the cloak's skirt and the scarf tails trail and swing.
    this.skirt.rotation.x = moving ? 0.08 + Math.abs(sway) * 0.06 : Math.sin(t * 0.9) * 0.015;
    this.skirt.rotation.z = sway * 0.05;
    this.scarfTails.forEach((tail, i) => { tail.rotation.x = (moving ? 0.35 : 0.06) + Math.sin(t * 3 + i) * (moving ? 0.15 : 0.04); });
    if (this.hatTip) this.hatTip.rotation.z = Math.sin(t * 1.3) * 0.08 + sway * 0.1;
    this.boots.forEach((b, i) => { b.position.z = -0.02 + (moving ? Math.sin(this.walk + i * Math.PI) * 0.12 : 0); });
    const crouchScale = 1 - this.crouchK * (1 - CROUCH_EYE_HEIGHT / EYE_HEIGHT);
    this.body.scale.y = crouchScale;
    this.castK = Math.max(0, this.castK - dt * 3);
    // Wand arm follows the aim; the other swings.
    this.armR.sh.rotation.x = -1.15 - this.pitch * 0.9 - this.castK * 0.5;
    this.armR.el.rotation.x = -0.35;
    this.armL.sh.rotation.x = sway * 0.45;
    this.armL.el.rotation.x = -0.2;
    this.head.rotation.x = -this.pitch * 0.5;

    // Channelling makes the wand flare.
    const channel = this.state.ch !== null && this.state.ch !== undefined;
    const glow = (channel ? 1.6 + Math.sin(t * 30) * 0.4 : 1) + this.castK * 3;
    this.tip.scale.setScalar(glow);

    // The Disillusionment Charm: a glassy, barely-there shimmer.
    const invis = (this.state.bf ?? []).includes('invis');
    this.invisK += ((invis ? 1 : 0) - this.invisK) * Math.min(1, dt * 4);
    const alpha = 1 - this.invisK * (0.9 - Math.sin(t * 7) * 0.05);
    for (const m of this.mats) {
      m.transparent = this.invisK > 0.01 || m === this.crestMat;
      m.opacity = alpha;
      m.depthWrite = this.invisK < 0.5;
    }
    this.shadow.material.opacity = 1 - this.invisK;
    this.tipMat.opacity = alpha;
    this.tipMat.transparent = this.invisK > 0.01;

    const dist = camera.position.distanceTo(this.group.position);
    // Never render a teammate from the inside.
    const dx = camera.position.x - this.x, dz = camera.position.z - this.z;
    this.body.visible = Math.hypot(dx, dz) > 0.55;
    this.label.material.opacity = onFloor ? Math.max(0, Math.min(0.75, (8 - dist) / 4)) * (1 - this.invisK * 0.8) : 0;

    const lumos = !!this.state.li;
    this.tip.getWorldPosition(this._tipWorld);
    this.beam.visible = lumos && onFloor && this.invisK < 0.5;
    if (this.beam.visible) {
      this.beam.position.copy(this.group.worldToLocal(this._tipWorld.clone()));
      this.beam.rotation.set(-this.pitch, 0, 0);
      this.beam.material.uniforms.uOpacity.value = 0.09;
    }
    if (this.light) {
      const lit = onFloor && this.invisK < 0.5;
      this.light.position.copy(this._tipWorld);
      const fx = -Math.sin(this.yaw) * Math.cos(this.pitch);
      const fz = -Math.cos(this.yaw) * Math.cos(this.pitch);
      const fy = Math.sin(this.pitch);
      this.light.target.position.set(this._tipWorld.x + fx * 6, this._tipWorld.y + fy * 6, this._tipWorld.z + fz * 6);
      this.light.target.updateMatrixWorld();
      this.light.angle = lumos ? 0.85 : 0.44;
      this.light.distance = lumos ? 28 : 24;
      this.light.intensity = lit ? (lumos ? 130 : 45) * (channel ? 1.5 : 1) : 0;
    }
    this.tipMat.color.set(this.wizard.color).multiplyScalar(this.state.li ? 1.8 : 1);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        o.geometry?.dispose();
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    if (this.light) this.light.intensity = 0;
  }
}
