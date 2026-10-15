// A teammate (human or bot) as seen by everyone else: a hooded robed figure
// with a glowing wand, a faint name, and (if one is free) a wand spotlight.

import * as THREE from 'three';
import { FLOOR_Y, CROUCH_EYE_HEIGHT, EYE_HEIGHT } from '/shared/constants.js';

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

const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class WizardAvatar {
  constructor(info, wizard) {
    this.id = info.id;
    this.wizard = wizard;
    const color = new THREE.Color(wizard.color);
    const robeColor = color.clone().multiplyScalar(0.18).lerp(new THREE.Color(0x0a0808), 0.4);

    const robeMat = new THREE.MeshStandardMaterial({ color: robeColor, roughness: 1 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x6a5020, roughness: 0.4, metalness: 0.7 });
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.tipMat = new THREE.MeshBasicMaterial({ color });

    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);

    const profile = [
      [0.46, 0], [0.42, 0.25], [0.33, 0.8], [0.25, 1.2], [0.23, 1.4], [0.12, 1.5], [0, 1.52],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const robe = new THREE.Mesh(new THREE.LatheGeometry(profile, 16), robeMat);
    this.body.add(robe);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.02, 4, 16), trimMat);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.95;
    this.body.add(belt);

    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 12), robeMat);
    hood.position.set(0, 1.72, 0.03);
    hood.rotation.x = -0.12;
    this.body.add(hood);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), voidMat);
    face.position.set(0, 1.6, -0.08);
    this.body.add(face);
    const eyeMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.6) });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), eyeMat);
      eye.position.set(sx * 0.045, 1.62, -0.2);
      this.body.add(eye);
    }

    // Wand arm (pivots with pitch)
    this.arm = new THREE.Group();
    this.arm.position.set(0.24, 1.25, -0.05);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.45, 8), robeMat);
    sleeve.rotation.x = Math.PI / 2;
    sleeve.position.z = -0.2;
    this.arm.add(sleeve);
    const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.38, 6), new THREE.MeshStandardMaterial({ color: 0x1a0f08 }));
    wand.rotation.x = Math.PI / 2;
    wand.position.z = -0.6;
    this.arm.add(wand);
    this.tip = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), this.tipMat);
    this.tip.position.z = -0.8;
    this.arm.add(this.tip);
    this.body.add(this.arm);

    this.label = nameSprite(info.name, wizard.color);
    this.label.position.y = 2.25;
    this.group.add(this.label);

    this.group.traverse((o) => {
      if (o.isMesh && !o.material.isMeshBasicMaterial) {
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
    this.initialized = false;
    this._tipWorld = new THREE.Vector3();
  }

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

  update(dt, t, camera, visibleFloor) {
    const k = 1 - Math.exp(-dt * 12);
    this.x += (this.tx - this.x) * k;
    this.z += (this.tz - this.z) * k;
    this.yaw = angleLerp(this.yaw, this.tyaw, k);
    this.pitch += (this.tpitch - this.pitch) * k;
    this.crouchK += ((this.state.cr ? 1 : 0) - this.crouchK) * k;

    const onFloor = this.floor === visibleFloor;
    this.group.visible = onFloor;
    const y = FLOOR_Y[this.floor];
    this.group.position.set(this.x, y, this.z);
    this.group.rotation.y = this.yaw;

    if (this.state.mv) this.walk += dt * (this.state.sp ? 11 : 7);
    const sway = this.state.mv ? Math.sin(this.walk) : 0;
    this.body.position.y = Math.abs(sway) * 0.04;
    this.body.rotation.z = sway * 0.03;
    const crouchScale = 1 - this.crouchK * (1 - CROUCH_EYE_HEIGHT / EYE_HEIGHT);
    this.body.scale.y = crouchScale;
    this.arm.rotation.x = this.pitch;

    // Channelling makes the wand flare.
    const channel = this.state.ch !== null && this.state.ch !== undefined;
    const glow = channel ? 1.6 + Math.sin(t * 30) * 0.4 : 1;
    this.tip.scale.setScalar(glow);

    const dist = camera.position.distanceTo(this.group.position);
    // Never render a teammate from the inside.
    const dx = camera.position.x - this.x, dz = camera.position.z - this.z;
    this.body.visible = Math.hypot(dx, dz) > 0.55;
    this.label.material.opacity = onFloor ? Math.max(0, Math.min(0.75, (8 - dist) / 4)) : 0;

    if (this.light) {
      const lit = onFloor && this.state.li !== false;
      this.tip.getWorldPosition(this._tipWorld);
      this.light.position.copy(this._tipWorld);
      const fx = -Math.sin(this.yaw) * Math.cos(this.pitch);
      const fz = -Math.cos(this.yaw) * Math.cos(this.pitch);
      const fy = Math.sin(this.pitch);
      this.light.target.position.set(this._tipWorld.x + fx * 6, this._tipWorld.y + fy * 6, this._tipWorld.z + fz * 6);
      this.light.target.updateMatrixWorld();
      this.light.intensity = lit ? 45 * (channel ? 1.5 : 1) : 0;
    }
    this.tipMat.color.set(this.wizard.color).multiplyScalar(this.state.li === false ? 0.15 : 1);
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
