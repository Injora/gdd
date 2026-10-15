// Phase III visuals: the Soul Merge ribbons, the Archon's heptagram crown (in
// first person), the Chapel splitting with hellfire, the Unbound Amalgam's
// aura and ward, its orb volleys and floor shockwaves, the seven Masteries,
// and the Hell Portal (a swirling shader rift) + the sealing.

import * as THREE from 'three';
import { FLOOR_Y, TILE } from '/shared/constants.js';
import { MASTERIES } from '/shared/finale.js';

const ease = (k) => 1 - (1 - k) ** 3;
const rand = (a, b) => a + Math.random() * (b - a);
const C = (hex) => new THREE.Color(hex);
const EMBER = C(0xff5a10), CRIMSON = C(0xc0102a), GOLD = C(0xffd76a);

const PORTAL_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PORTAL_FRAG = /* glsl */`
  uniform float uTime; uniform float uOpen;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float a = atan(c.y, c.x);
    float swirl = sin(a * 5.0 + r * 14.0 - uTime * 4.0) * 0.5 + 0.5;
    float swirl2 = sin(a * 9.0 - r * 22.0 + uTime * 6.0) * 0.5 + 0.5;
    float edge = smoothstep(1.0, 0.82, r);
    float core = smoothstep(0.55, 0.0, r);
    vec3 fire = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.75, 0.25), swirl2);
    vec3 col = mix(fire * (0.6 + swirl * 0.9), vec3(0.0), core * 0.92);
    col += vec3(1.0, 0.4, 0.1) * smoothstep(0.86, 0.95, r) * smoothstep(1.0, 0.95, r) * 2.0;
    gl_FragColor = vec4(col, edge * uOpen);
  }`;

export class FinaleFX {
  constructor(fx, scene, map, hooks) {
    this.fx = fx;
    this.scene = scene;
    this.map = map;
    this.hooks = hooks;
    this.time = 0;
    this.orbMesh = null;
    this.waveMesh = null;
    this.cracks = null;
    this.portal = null;
    this.crown = null;
    this.bossAura = null;
  }

  // ---- the Forbidden Spell ------------------------------------------------------------

  /** While voices chant: motes of gold and violet spiral up out of the floor into the altar. */
  ritual(altar, rt, voices, dt) {
    if (!voices) return;
    const y0 = FLOOR_Y[altar.floor];
    const n = Math.min(6, (voices * 0.6 + rt * 4) * dt * 60);
    for (let i = 0; i < n; i++) {
      if (Math.random() > n - i) break;
      const a = Math.random() * Math.PI * 2, r = rand(1.6, 3.2);
      this.fx.glow.emit(altar.x + Math.cos(a) * r, y0 + 0.1, altar.z + Math.sin(a) * r,
        -Math.cos(a) * r * 0.45 - Math.sin(a) * 0.8, rand(1.2, 2.2) + rt * 1.5, -Math.sin(a) * r * 0.45 + Math.cos(a) * 0.8,
        1.4, Math.random() < 0.55 ? GOLD : C(0x8a3cff), 0, 0.4);
    }
  }

  // ---- the Soul Merge ------------------------------------------------------------

  /** Ribbons of dark and gold spiral out of every wizard into the altar. */
  merge(ev, sources) {
    const y0 = FLOOR_Y[ev.floor];
    const center = new THREE.Vector3(ev.x, y0 + 2.2, ev.z);
    const ribbons = [];
    sources.forEach((src, i) => {
      for (let k = 0; k < 2; k++) {
        const start = new THREE.Vector3(src.x, y0 + 1.3, src.z);
        const pts = [];
        for (let s = 0; s <= 30; s++) {
          const u = s / 30;
          const ang = u * Math.PI * 4 + i + k * Math.PI;
          const p = start.clone().lerp(center, ease(u));
          p.x += Math.cos(ang) * (1 - u) * 1.2;
          p.z += Math.sin(ang) * (1 - u) * 1.2;
          p.y += Math.sin(u * Math.PI) * 1.6;
          pts.push(p);
        }
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.05, 5), this.fx.additive(k ? 0xffd76a : 0x6a1cff, 0.9));
        this.scene.add(mesh);
        ribbons.push(mesh);
      }
    });
    const core = this.fx.glowSprite(0xfff0d0, 1);
    core.position.copy(center);
    const light = this.fx.takeLight('merge', 0xfff0d0);
    if (light) { light.position.copy(center); light.distance = 22; }
    this.fx.timed(ev.duration, (k, dt, age) => {
      for (const r of ribbons) {
        const count = r.geometry.index.count;
        r.geometry.setDrawRange(0, Math.floor((count * Math.min(1, age / 1.4)) / 3) * 3);
        r.material.opacity = 0.9 * (1 - Math.max(0, (k - 0.75) / 0.25));
      }
      core.scale.setScalar(0.5 + ease(k) * 7);
      core.material.opacity = k < 0.8 ? 0.6 + k * 0.4 : (1 - k) * 5;
      if (light) light.intensity = 40 + k * 260;
      if (Math.random() < 0.9) {
        const ang = Math.random() * Math.PI * 2, r = rand(1, 5);
        this.fx.glow.emit(center.x + Math.cos(ang) * r, center.y + rand(-1.5, 1.5), center.z + Math.sin(ang) * r,
          -Math.cos(ang) * r * 1.2, 0, -Math.sin(ang) * r * 1.2, 0.8, Math.random() < 0.5 ? GOLD : C(0x8a3cff), 0, 0);
      }
    }, () => {
      this.fx.releaseLight(light);
      ribbons.forEach((r) => this.fx.disposeObject(r));
      this.fx.disposeObject(core);
    });
    this.hooks.shake(1.2);
  }

  /** The seven elemental orbs orbiting your sight (attached to the camera). */
  attachCrown(camera) {
    if (this.crown) return;
    const g = new THREE.Group();
    g.position.set(0, 0.5, -1.25); // a halo at the top of your sight, under the boss bar
    g.scale.setScalar(0.62);
    MASTERIES.forEach((M, i) => {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshBasicMaterial({ color: M.color }));
      const glow = this.fx.glowSprite(M.color, 0.8);
      this.scene.remove(glow);
      glow.scale.setScalar(0.22);
      orb.add(glow);
      orb.userData.phase = (i / 7) * Math.PI * 2;
      orb.userData.id = M.id;
      g.add(orb);
    });
    // the heptagram the orbs trace
    const pts = [];
    for (let i = 0; i <= 7; i++) {
      const a = ((i * 3) / 7) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.38, Math.sin(a) * 0.12, Math.sin(a) * 0.05));
    }
    const star = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.35 }));
    g.add(star);
    camera.add(g);
    this.crown = g;
  }

  updateCrown(t, readyMap) {
    if (!this.crown) return;
    this.crown.children.forEach((o) => {
      if (!o.isMesh) return;
      const a = o.userData.phase + t * 0.6;
      o.position.set(Math.cos(a) * 0.38, Math.sin(a * 2) * 0.03 + Math.sin(a) * 0.12, Math.sin(a) * 0.05);
      const cooling = (readyMap?.[o.userData.id] ?? 0) > 0;
      o.scale.setScalar(cooling ? 0.55 : 1 + Math.sin(t * 6 + a) * 0.12);
    });
  }

  // ---- the Chapel splits with hellfire --------------------------------------------

  hellfire(floor) {
    if (this.cracks) return;
    const room = this.map.rooms[this.map.ids.altarRoom];
    const y0 = FLOOR_Y[floor];
    const tex = (() => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      const ctx = c.getContext('2d');
      ctx.strokeStyle = '#ffb040';
      ctx.shadowColor = '#ff4000';
      ctx.shadowBlur = 12;
      for (let k = 0; k < 3; k++) {
        ctx.lineWidth = 6 - k * 2;
        ctx.beginPath();
        let x = 64, y = 256;
        ctx.moveTo(x, y);
        while (y > 0) {
          x += rand(-18, 18);
          y -= rand(12, 30);
          ctx.lineTo(x, y);
          if (Math.random() < 0.25) { ctx.moveTo(x, y); }
        }
        ctx.stroke();
      }
      return new THREE.CanvasTexture(c);
    })();
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const g = new THREE.Group();
    const x0 = room.x * TILE, x1 = (room.x + room.w) * TILE, z0 = room.y * TILE, z1 = (room.y + room.h) * TILE;
    const walls = [
      (u) => [x0 + u * (x1 - x0), z0 + 0.03, 0], (u) => [x0 + u * (x1 - x0), z1 - 0.03, Math.PI],
      (u) => [x0 + 0.03, z0 + u * (z1 - z0), Math.PI / 2], (u) => [x1 - 0.03, z0 + u * (z1 - z0), -Math.PI / 2],
    ];
    for (let i = 0; i < 14; i++) {
      const [x, z, rot] = walls[i % 4](rand(0.1, 0.9));
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(rand(0.8, 1.6), rand(2.2, 3.8)), mat);
      crack.position.set(x, y0 + 1.8, z);
      crack.rotation.y = rot;
      g.add(crack);
    }
    // floor fissures
    for (let i = 0; i < 8; i++) {
      const fis = new THREE.Mesh(new THREE.PlaneGeometry(0.6, rand(2, 4)), mat);
      fis.rotation.x = -Math.PI / 2;
      fis.rotation.z = rand(0, Math.PI);
      fis.position.set(rand(x0 + 1, x1 - 1), y0 + 0.04, rand(z0 + 1, z1 - 1));
      g.add(fis);
    }
    this.scene.add(g);
    this.cracks = { g, mat, room, y0, x0, x1, z0, z1, light: this.fx.takeLight('hellfire', 0xff3a10) };
    this.hooks.shake(1);
  }

  // ---- the Unbound Amalgam ----------------------------------------------------------

  bossDecor(av, ward, t, seal = 0) {
    if (!av) return;
    if (seal > 0) av.group.position.y = FLOOR_Y[av.floor] - seal * 5.5; // dragged down through the rift
    if (!this.bossAura) {
      const ward3 = new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 20), this.fx.additive(0xc0102a, 0.0));
      ward3.position.y = 1.8;
      av.group.add(ward3);
      this.bossAura = { ward: ward3 };
      av.group.scale.setScalar(1.45); // Unbound: towering
    }
    this.bossAura.ward.material.opacity += ((ward ? 0.32 + Math.sin(t * 9) * 0.08 : 0) - this.bossAura.ward.material.opacity) * 0.2;
    this.bossAura.ward.rotation.y += 0.02;
    if (av.group.visible && Math.random() < 0.9) {
      this.fx.glow.emit(av.x + rand(-0.6, 0.6), av.group.position.y + rand(0.2, 4.4), av.z + rand(-0.6, 0.6), rand(-0.5, 0.5), rand(0.8, 2), rand(-0.5, 0.5), 0.8, Math.random() < 0.5 ? EMBER : CRIMSON, -1, 1);
    }
  }

  orbs(list, floor) {
    const n = 64;
    if (!this.orbMesh) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x1a0008 });
      this.orbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 12, 8), mat, n);
      this.orbMesh.frustumCulled = false;
      this.orbGlow = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 12, 8), this.fx.additive(0xc0102a, 0.45), n);
      this.orbGlow.frustumCulled = false;
      this.scene.add(this.orbMesh, this.orbGlow);
    }
    const m4 = new THREE.Matrix4();
    const y = FLOOR_Y[floor] + 1.4;
    const count = Math.min(n, list.length);
    for (let i = 0; i < count; i++) {
      m4.makeTranslation(list[i][0], y, list[i][1]);
      this.orbMesh.setMatrixAt(i, m4);
      this.orbGlow.setMatrixAt(i, m4);
    }
    this.orbMesh.count = this.orbGlow.count = count;
    this.orbMesh.instanceMatrix.needsUpdate = this.orbGlow.instanceMatrix.needsUpdate = true;
  }

  wave(w, floor) {
    if (!this.waveMesh) {
      this.waveMesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2), this.fx.additive(0xff3010, 0.85));
      this.scene.add(this.waveMesh);
    }
    this.waveMesh.visible = !!w;
    if (!w) return;
    this.waveMesh.position.set(w.x, FLOOR_Y[floor] + 0.08, w.z);
    this.waveMesh.scale.setScalar(Math.max(0.1, w.r));
    if (Math.random() < 0.8) {
      const a = Math.random() * Math.PI * 2;
      this.fx.dust.emit(w.x + Math.cos(a) * w.r, FLOOR_Y[floor] + 0.2, w.z + Math.sin(a) * w.r, 0, 1, 0, 0.8, C(0x200606), 0, 1);
    }
  }

  // ---- the seven Masteries ---------------------------------------------------------------

  mastery(ev, gfx) {
    const M = MASTERIES.find((x) => x.id === ev.id);
    const y0 = FLOOR_Y[ev.floor];
    const from = new THREE.Vector3(ev.x, y0 + 2.4, ev.z);
    const to = new THREE.Vector3(ev.to.x, y0 + 2, ev.to.z);
    const col = C(M.color);
    // A beam of the element from the Archon to the boss.
    const len = from.distanceTo(to);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, len, 10, 1, true).rotateX(Math.PI / 2), this.fx.additive(col, 0.8));
    beam.position.copy(from).lerp(to, 0.5);
    beam.lookAt(to);
    this.scene.add(beam);
    this.fx.timed(0.4, (k) => { beam.material.opacity = 0.8 * (1 - k); beam.scale.set(1 + k * 2, 1 + k * 2, 1); }, () => this.fx.disposeObject(beam));
    if (ev.hit) gfx.explosion(ev.floor, to.x, to.z, 1.6, col);
    switch (ev.id) {
      case 'm_earth_pillars':
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          gfx.fx.dust.burst(6, to.x + Math.cos(a) * 1.6, y0 + 0.2, to.z + Math.sin(a) * 1.6, { speed: 2, up: 2, life: 1, color: C(0x6a5a48), drag: 2 });
        }
        this.pillarRing(to.x, to.z, y0);
        break;
      case 'm_water_deluge':
        this.fx.glow.burst(160, to.x, y0 + 1, to.z, { speed: 7, up: 3, life: 1.2, color: C(0x5ac8ff), colorVar: 0.04, gravity: 6, drag: 1 });
        break;
      case 'm_white_chains':
        this.fx.glow.burst(120, to.x, y0 + 2, to.z, { speed: 4, life: 1.4, color: GOLD, drag: 2 });
        this.hooks.screen('white', 0.35);
        break;
      case 'm_black_torment':
        this.hooks.screen('torment', 0.6);
        break;
      case 'm_wind_dragon':
        for (let n = 0; n < 120; n++) {
          const s = Math.random() * len;
          const p = from.clone().lerp(to, s / len);
          this.fx.glow.emit(p.x + rand(-1, 1), p.y + rand(-1, 1), p.z + rand(-1, 1), (to.x - from.x) / len * 14, 0, (to.z - from.z) / len * 14, 0.6, C(0x9ef0e0), 0, 1);
        }
        break;
      case 'm_antimagic_slash':
        this.fx.glow.burst(100, from.x, from.y, from.z, { speed: 9, life: 0.5, color: CRIMSON, drag: 3 });
        break;
    }
    this.hooks.shake(0.35);
  }

  pillarRing(x, z, y0) {
    const g = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const h = rand(2.5, 4);
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.4, h, 5).translate(0, h / 2, 0), this.fx.stoneMat);
      m.position.set(x + Math.cos(a) * 1.7, 0, z + Math.sin(a) * 1.7);
      m.rotation.z = Math.cos(a) * -0.35;
      m.rotation.x = Math.sin(a) * 0.35;
      g.add(m);
    }
    g.position.y = y0 - 4;
    this.scene.add(g);
    this.fx.timed(2.4, (k, dt, age) => {
      g.position.y = y0 - 4 * (1 - ease(Math.min(1, age / 0.25))) - Math.max(0, (age - 1.8) / 0.6) * 4;
    }, () => this.fx.disposeObject(g));
  }

  // ---- the Hell Portal --------------------------------------------------------------------

  openPortal(ev) {
    if (this.portal) return;
    const y0 = FLOOR_Y[ev.floor];
    const mat = new THREE.ShaderMaterial({
      vertexShader: PORTAL_VERT, fragmentShader: PORTAL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uOpen: { value: 0 } },
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.4, 64).rotateX(-Math.PI / 2), mat);
    disc.position.set(ev.x, y0 + 1.25, ev.z); // over the altar stone
    disc.renderOrder = 4;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 6, 32, 1, true), this.fx.additive(0xff3a10, 0.0));
    column.position.set(ev.x, y0 + 3, ev.z);
    this.scene.add(disc, column);
    this.portal = { disc, column, mat, x: ev.x, z: ev.z, y0, light: this.fx.takeLight('portal', 0xff4a10) };
    this.hooks.shake(1.4);
  }

  sealing(ev) {
    if (!this.portal) return;
    this.portal.sealing = { start: this.time, duration: ev.duration };
  }

  // ---- per frame ------------------------------------------------------------------

  update(dt, t, activeFloor) {
    this.time = t;
    if (this.cracks) {
      const c = this.cracks;
      c.mat.opacity = 0.65 + Math.sin(t * 7) * 0.2 + Math.random() * 0.15;
      if (c.light) {
        c.light.position.set((c.x0 + c.x1) / 2, c.y0 + 3, (c.z0 + c.z1) / 2);
        c.light.distance = 30;
        c.light.intensity = 14 + Math.sin(t * 11) * 4 + Math.random() * 4;
      }
      if (Math.random() < 0.9) {
        this.fx.glow.emit(rand(c.x0, c.x1), c.y0 + 0.1, rand(c.z0, c.z1), 0, rand(0.6, 1.8), 0, 1.6, Math.random() < 0.6 ? EMBER : C(0xffb040), -0.3, 0.3);
      }
    }
    if (this.portal) {
      const p = this.portal;
      p.mat.uniforms.uTime.value = t;
      p.mat.uniforms.uOpen.value = Math.min(1, p.mat.uniforms.uOpen.value + dt * 0.8);
      p.disc.rotation.y += dt * 0.6;
      p.column.material.opacity = 0.12 + Math.sin(t * 3) * 0.04;
      if (p.light) {
        p.light.position.set(p.x, p.y0 + 2, p.z);
        p.light.distance = 26;
        p.light.intensity = 60 + Math.sin(t * 9) * 15;
      }
      for (let n = 0; n < 3; n++) {
        const a = Math.random() * Math.PI * 2, r = rand(2, 5);
        this.fx.glow.emit(p.x + Math.cos(a) * r, p.y0 + 1.3, p.z + Math.sin(a) * r, -Math.cos(a) * r * 0.8, rand(0.3, 1.5), -Math.sin(a) * r * 0.8, 1, Math.random() < 0.5 ? EMBER : CRIMSON, 0, 0);
      }
      if (p.sealing) {
        const k = Math.min(1, (t - p.sealing.start) / p.sealing.duration);
        p.disc.scale.setScalar(1 + k * 0.6);
        if (p.light) p.light.intensity = 60 + k * 400;
      }
    }
  }

  dispose() {
    for (const o of [this.orbMesh, this.orbGlow, this.waveMesh, this.cracks?.g, this.portal?.disc, this.portal?.column]) if (o) this.fx.disposeObject(o);
  }
}
