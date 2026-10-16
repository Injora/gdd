// A teammate (human or bot) as everyone else sees them (and you, in the vanity
// camera): Step 9's sculpted dark-fantasy mage (wizardModel.js), animated:
// striding legs, coattails that swing with each step and stream with speed, a
// fluttering cravat, swaying hair, the wand arm following their aim, a contact
// shadow underfoot, a faint name, a visible Lumos beam, and the glassy shimmer
// of the Disillusionment Charm.

import * as THREE from 'three';
import { FLOOR_Y, CROUCH_EYE_HEIGHT, EYE_HEIGHT } from '/shared/constants.js';
import { buildWizardModel } from './wizardModel.js';

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
  /** @param makeCarry (kind) => Object3D for a carried ingot / platter (optional) */
  constructor(info, wizard, makeCarry = null) {
    this.id = info.id;
    this.makeCarry = makeCarry;
    this.wizard = wizard;
    // Step 9: the sculpted, tailored model (shared with the lobby showcase and the vanity camera).
    const model = buildWizardModel(wizard);
    this.model = model;
    this.mats = model.mats;
    this.tipMat = model.tipMat;
    this.group = new THREE.Group();
    this.body = model.body;
    this.group.add(model.group);
    this.group.add(this.shadow = contactShadow());
    this.head = model.head;
    this.hair = model.hair;
    this.legs = model.legs;
    this.coattails = model.coattails;
    this.cravatTail = model.cravatTail;
    this.armL = model.armL;
    this.armR = model.armR;
    this.wand = model.wand;
    this.tip = model.tip;
    this.halo = model.parts.halo ?? null;

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
    // Speed (from how far they moved this frame) streams the coattails out behind.
    const speed = this.lastPos ? Math.min(8, Math.hypot(this.x - this.lastPos.x, this.z - this.lastPos.z) / Math.max(dt, 1e-3)) : 0;
    this.lastPos = { x: this.x, z: this.z };
    this.speedK = (this.speedK ?? 0) + (speed / 6 - (this.speedK ?? 0)) * Math.min(1, dt * 5);
    this.body.position.y = Math.abs(sway) * 0.03;
    this.body.rotation.z = sway * 0.02;
    // Striding legs: hip swing, knee bend on the back-swing.
    this.legs.forEach((l, i) => {
      const ph = Math.sin(this.walk + i * Math.PI);
      l.hip.rotation.x = moving ? ph * (this.state.sp ? 0.75 : 0.5) : 0;
      l.knee.rotation.x = moving ? Math.max(0, -Math.cos(this.walk + i * Math.PI)) * 0.7 : 0;
    });
    // Coattails: they swing with each step and stream back with speed.
    this.coattails.forEach((c, i) => {
      c.rotation.x = -0.05 - this.speedK * 0.75 - Math.abs(sway) * 0.08 + Math.sin(t * 2.1 + i * 1.3) * 0.03;
      c.rotation.z = (i ? 1 : -1) * (0.03 + this.speedK * 0.08) + sway * 0.06;
    });
    this.cravatTail.rotation.x = -0.1 - this.speedK * 0.5 + Math.sin(t * 3.1) * 0.06;
    // Hair: a living sway, more when they run.
    this.hair.rotation.z = Math.sin(t * 1.4) * 0.02 + sway * 0.03;
    this.hair.rotation.x = -this.speedK * 0.08 + Math.sin(t * 1.1) * 0.015;
    if (this.halo) this.halo.rotation.z = t * 0.4;
    const crouchScale = 1 - this.crouchK * (1 - CROUCH_EYE_HEIGHT / EYE_HEIGHT);
    this.body.scale.y = crouchScale;
    this.castK = Math.max(0, this.castK - dt * 3);
    // Wand arm follows the aim; the other swings.
    this.armR.sh.rotation.x = -1.15 - this.pitch * 0.9 - this.castK * 0.5;
    this.armR.el.rotation.x = -0.35;
    // Carrying an ingot or a platter (Step 7): the off hand holds it out in front.
    const cy = this.state.cy ?? null;
    if (cy !== this.carryKind) this.setCarry(cy);
    this.armL.sh.rotation.x = this.carry ? -0.9 : sway * 0.45;
    this.armL.el.rotation.x = this.carry ? -0.5 : -0.2;
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
      m.transparent = this.invisK > 0.01 || !!m.userData.alwaysTransparent;
      m.opacity = alpha;
      m.depthWrite = this.invisK < 0.5;
    }
    this.shadow.material.opacity = 1 - this.invisK;
    if (this.carry) this.carry.visible = this.invisK < 0.5;
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
    this.tipMat.color.set(this.wizard.color).multiplyScalar(this.state.li ? 3.6 : 2.8); // HDR: it blooms
  }

  /** Show (or drop) the carried item; its model and materials belong to the prop kit. */
  setCarry(kind) {
    this.carryKind = kind;
    if (this.carry) this.armL.el.remove(this.carry);
    this.carry = kind ? this.makeCarry?.(kind) ?? null : null;
    if (!this.carry) return;
    this.carry.position.set(0, -0.4, 0.06);
    this.carry.rotation.x = Math.PI / 2;
    this.carry.scale.setScalar(kind === 'platter' ? 0.9 : 1.2);
    this.armL.el.add(this.carry);
  }

  dispose() {
    if (this.carry) this.armL.el.remove(this.carry); // shared with the mansion's props
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
