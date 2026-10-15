// Procedural VFX for all seven spells, driven entirely by server events
// (`cast`, `impact`, `barrier:end`) plus the per-player shield flag in
// snapshots. Uses a fixed pool of point lights (the scene's light count
// never changes, so no shader recompiles mid-fight).

import * as THREE from 'three';
import { FLOOR_Y, TILE } from '/shared/constants.js';
import { ABILITY_BY_ID } from '/shared/wizards.js';

const WAND_HEIGHT = 1.35;
const LIGHT_POOL = 5; // fixed: fireballs, scorches, flashes, auras, dragons, the Tree
const ease = (k) => 1 - (1 - k) ** 3;

function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function scorchTextures() {
  const make = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const char = make((ctx) => {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 30;
      const x = 64 + Math.cos(a) * r * 0.5, y = 64 + Math.sin(a) * r * 0.5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(8,4,2,0.85)');
      g.addColorStop(1, 'rgba(8,4,2,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
  });
  const glow = make((ctx) => {
    const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
    g.addColorStop(0, 'rgba(255,200,80,0.9)');
    g.addColorStop(0.35, 'rgba(255,90,20,0.6)');
    g.addColorStop(1, 'rgba(120,10,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  return { char, glow };
}

/** Jagged stone spike: a cone with jittered vertices, base at y = 0. */
export function jaggedSpike(radius, height) {
  const g = new THREE.ConeGeometry(radius, height, 5, 3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < height / 2 - 1e-3) {
      p.setX(i, p.getX(i) * (0.75 + Math.random() * 0.5));
      p.setZ(i, p.getZ(i) * (0.75 + Math.random() * 0.5));
      p.setY(i, y + (Math.random() - 0.5) * height * 0.08);
    }
  }
  g.translate(0, height / 2, 0);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Particles: one Points object with a ring buffer of fading, falling motes.

export class Particles {
  constructor(scene, capacity, { blending, size, texture, opacity = 1 }) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3).fill(-9999);
    this.col = new Float32Array(capacity * 3);
    this.base = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    const mat = new THREE.PointsMaterial({
      size, map: texture, vertexColors: true, transparent: true, opacity, depthWrite: false, blending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, color, gravity = 0, drag = 0) {
    const i = this.next;
    this.next = (i + 1) % this.cap;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.base[j] = color.r; this.base[j + 1] = color.g; this.base[j + 2] = color.b;
    this.life[i] = this.max[i] = life;
    this.grav[i] = gravity;
    this.drag[i] = drag;
  }

  /** Spherical burst around a point. */
  burst(n, x, y, z, { speed = 3, up = 0, life = 0.8, color, colorVar = 0, gravity = 0, drag = 1.5, spread = 1 }) {
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() * 2 - 1) * spread;
      const s = speed * (0.4 + Math.random() * 0.6);
      c.copy(color).offsetHSL((Math.random() - 0.5) * colorVar, 0, (Math.random() - 0.5) * colorVar);
      this.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + up, Math.sin(a) * Math.cos(e) * s,
        life * (0.6 + Math.random() * 0.4), c, gravity, drag);
    }
  }

  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      const j = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -9999;
        this.col[j] = this.col[j + 1] = this.col[j + 2] = 0;
        continue;
      }
      const drag = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[j] *= drag; this.vel[j + 2] *= drag;
      this.vel[j + 1] = this.vel[j + 1] * drag - this.grav[i] * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const k = this.life[i] / this.max[i];
      this.col[j] = this.base[j] * k;
      this.col[j + 1] = this.base[j + 1] * k;
      this.col[j + 2] = this.base[j + 2] * k;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Iridescent black-and-silver hexagonal energy shell (Aegis of the Void).

const HEX_VERT = /* glsl */`
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const HEX_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uAlpha;
  uniform float uHit;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, normalize(vec2(1.0, 1.732))), p.x);
  }
  void main() {
    vec2 uv = vec2(atan(vLocal.z, vLocal.x) * 5.0, vLocal.y * 9.0 + uTime * 0.15);
    vec2 r = vec2(1.0, 1.732);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    float edge = smoothstep(0.40, 0.48, hexDist(gv));
    float fres = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewW))), 2.0);
    vec3 irid = 0.5 + 0.5 * cos(6.2831 * (fres * 1.3 + uTime * 0.25 + vLocal.y * 0.4 + vec3(0.0, 0.33, 0.67)));
    vec3 silver = vec3(0.85, 0.88, 0.92);
    vec3 col = mix(vec3(0.01, 0.01, 0.02), mix(silver, irid, 0.3), clamp(edge + fres * 0.8, 0.0, 1.0));
    col += uHit * vec3(0.9, 0.95, 1.0) * (0.4 + edge);
    float alpha = uAlpha * (0.14 + edge * 0.5 + fres * 0.4 + uHit * 0.5);
    // Seen from inside (your own shield) it should frame the view, not fill it.
    if (!gl_FrontFacing) alpha *= 0.35;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }`;

export function hexMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: HEX_VERT,
    fragmentShader: HEX_FRAG,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uHit: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------

export class SpellFX {
  /**
   * @param scene  THREE.Scene
   * @param hooks  { screen(kind, strength), shake(amount), localId }
   */
  constructor(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks;
    this.effects = [];
    this.projectiles = new Map();
    this.barriers = new Map();
    this.domes = new Map();
    this.time = 0;

    const soft = softTexture();
    this.glow = new Particles(scene, 1400, { blending: THREE.AdditiveBlending, size: 0.13, texture: soft });
    this.dust = new Particles(scene, 600, { blending: THREE.NormalBlending, size: 0.22, texture: soft, opacity: 0.55 });
    this.scorchTex = scorchTextures();
    this.softTex = soft;
    this.stoneMat = new THREE.MeshStandardMaterial({ color: 0x5d5246, roughness: 0.95, flatShading: true });
    this.domeGeo = new THREE.SphereGeometry(1.05, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);

    this.lights = [];
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 9, 1.6);
      l.userData.owner = null;
      scene.add(l);
      this.lights.push(l);
    }
  }

  /**
   * Compile every spell material up front so the first cast of each spell
   * doesn't hitch while the GPU builds its shader program.
   */
  prewarm(renderer, camera) {
    const group = new THREE.Group();
    group.position.set(0, -500, 0);
    const meshes = [
      new THREE.Mesh(new THREE.BoxGeometry(), this.additive(0xffffff)),
      new THREE.Mesh(new THREE.BoxGeometry(), this.stoneMat),
      new THREE.Mesh(this.domeGeo, hexMaterial()),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ transparent: true, map: this.scorchTex.char, depthWrite: false })),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false })),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ color: 0x2a0638, transparent: true, side: THREE.DoubleSide, depthWrite: false })),
      new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })),
    ];
    for (const m of meshes) group.add(m);
    this.scene.add(group);
    renderer.compile(this.scene, camera);
    this.scene.remove(group);
    for (const m of meshes) m.material.dispose();
  }

  // ---- helpers ------------------------------------------------------------------

  takeLight(owner, color) {
    const l = this.lights.find((x) => !x.userData.owner);
    if (!l) return null;
    l.userData.owner = owner;
    l.color.set(color);
    return l;
  }

  releaseLight(l) {
    if (!l) return;
    l.intensity = 0;
    l.userData.owner = null;
  }

  add(effect) { this.effects.push(effect); }

  origin(ev) {
    const y = FLOOR_Y[ev.floor] + WAND_HEIGHT;
    const dir = new THREE.Vector3(-Math.sin(ev.yaw), 0, -Math.cos(ev.yaw));
    return { o: new THREE.Vector3(ev.x + dir.x * 0.5, y, ev.z + dir.z * 0.5), dir, y };
  }

  additive(color, opacity = 1) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  }

  /** Soft additive glow billboard (reads as light, not as a solid ball). */
  glowSprite(color, opacity = 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.softTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.scene.add(s);
    return s;
  }

  /** Timed effect wrapper: update(k, dt) gets 0..1 progress. */
  timed(life, update, dispose) {
    let age = 0;
    this.add({
      update: (dt) => {
        age += dt;
        update(Math.min(1, age / life), dt, age);
        return age < life;
      },
      dispose,
    });
  }

  disposeObject(obj) {
    this.scene.remove(obj);
    obj.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (o.material !== this.stoneMat) o.material.dispose?.();
      }
    });
  }

  // ---- event entry points ---------------------------------------------------------

  onCast(ev, localPos) {
    const fn = this[`cast_${ev.ability}`];
    if (fn) fn.call(this, ev, ABILITY_BY_ID[ev.ability], localPos);
  }

  onImpact(ev) {
    const pr = this.projectiles.get(ev.id);
    if (pr) pr.finish();
    this.fireExplosion(ev);
  }

  onBarrierEnd(id) {
    this.barriers.get(id)?.crumble();
  }

  /** Called every frame for each wizard: show/hide their Void dome. */
  shield(id, active, x, y, z) {
    let d = this.domes.get(id);
    if (active && !d) {
      const mesh = new THREE.Mesh(this.domeGeo, hexMaterial());
      mesh.renderOrder = 5;
      this.scene.add(mesh);
      d = { mesh, alpha: 0, hit: 0, active: true };
      this.domes.set(id, d);
    }
    if (!d) return;
    d.active = active;
    d.mesh.position.set(x, y, z);
  }

  shieldHit(id) {
    const d = this.domes.get(id);
    if (d) d.hit = 1;
  }

  // ---- 1. Black: Psychic Torment ----------------------------------------------------

  cast_psychic_torment(ev, a, localPos) {
    const { o, dir, y } = this.origin(ev);
    const end = new THREE.Vector3(ev.to.x, y, ev.to.z);
    const dist = Math.max(2, o.distanceTo(end));
    const group = new THREE.Group();
    group.position.copy(o);
    group.rotation.y = ev.yaw;
    this.scene.add(group);

    const coneGeo = new THREE.ConeGeometry(Math.tan(a.cone) * dist * 0.6, dist, 32, 1, true).rotateX(Math.PI / 2).translate(0, 0, -dist / 2);
    const haze = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0x2a0638, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
    group.add(haze);
    const rings = [0, 1, 2].map((i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.04, 6, 48), this.additive(i % 2 ? 0xc0102a : 0x8a3cff, 0.9));
      group.add(m);
      return m;
    });
    const crimson = new THREE.Color(0xc0102a), violet = new THREE.Color(0x8a3cff);
    this.timed(0.75, (k, dt) => {
      haze.material.opacity = Math.sin(k * Math.PI) * 0.45;
      rings.forEach((r, i) => {
        const rk = Math.min(1, Math.max(0, (k - i * 0.1) / 0.6));
        r.position.z = -dist * ease(rk);
        r.scale.setScalar(0.2 + rk * (Math.tan(a.cone) * dist * 0.6));
        r.material.opacity = (1 - rk) * 0.9;
        r.rotation.z += dt * 6;
      });
      for (let n = 0; n < 4; n++) {
        const s = Math.random() * dist * k;
        this.glow.emit(o.x + dir.x * s, y + (Math.random() - 0.5) * 0.8, o.z + dir.z * s,
          dir.x * 6, (Math.random() - 0.5) * 2, dir.z * 6, 0.5, Math.random() < 0.5 ? crimson : violet, 0, 2);
      }
    }, () => this.disposeObject(group));

    if (ev.hit) {
      const implode = this.glowSprite(0x8a2cff, 0.9);
      implode.position.set(ev.to.x, y + 0.6, ev.to.z);
      this.timed(0.6, (k) => {
        implode.scale.setScalar(4.5 * (1 - ease(k)) + 0.1);
        implode.material.opacity = 0.9 * (1 - k * 0.6);
      }, () => this.disposeObject(implode));
      this.glow.burst(60, ev.to.x, y, ev.to.z, { speed: 5, life: 0.7, color: crimson, colorVar: 0.1, drag: 3 });
    }
    if (this.near(ev, localPos, 10)) this.hooks.screen('torment', ev.caster === this.hooks.localId ? 1 : 0.6);
  }

  // ---- 2. Fire: Ignis Blast -----------------------------------------------------------

  cast_ignis_blast(ev, a) {
    const { dir, y } = this.origin(ev);
    const pos = new THREE.Vector3(ev.from.x, y, ev.from.z);
    const group = new THREE.Group();
    group.position.copy(pos);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }));
    group.add(core);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softTex, color: 0xff7a20, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.scale.setScalar(1.1);
    group.add(halo);
    const outer = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softTex, color: 0xb02000, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }));
    outer.scale.setScalar(1.9);
    group.add(outer);
    this.scene.add(group);
    const light = this.takeLight(`fire${ev.id}`, 0xff7a30);
    const ember = new THREE.Color(0xff6a10), spark = new THREE.Color(0xffc060);
    let traveled = 0, done = false, t = 0;
    const pr = {
      finish: () => { done = true; },
    };
    this.projectiles.set(ev.id, pr);
    this.add({
      update: (dt) => {
        if (done || traveled > a.range + 1.5) return false;
        t += dt;
        const step = a.projectileSpeed * dt;
        traveled += step;
        pos.addScaledVector(dir, step);
        group.position.copy(pos);
        halo.scale.setScalar(1.0 + Math.sin(t * 40) * 0.15);
        if (light) {
          light.position.copy(pos);
          light.intensity = 28 + Math.sin(t * 31) * 6;
          light.distance = 10;
        }
        for (let n = 0; n < 6; n++) {
          this.glow.emit(pos.x + (Math.random() - 0.5) * 0.15, pos.y + (Math.random() - 0.5) * 0.15, pos.z + (Math.random() - 0.5) * 0.15,
            (Math.random() - 0.5) * 1.2 - dir.x, Math.random() * 1.2, (Math.random() - 0.5) * 1.2 - dir.z,
            0.35 + Math.random() * 0.35, Math.random() < 0.3 ? spark : ember, -1.5, 1);
        }
        return true;
      },
      dispose: () => {
        this.projectiles.delete(ev.id);
        this.releaseLight(light);
        this.disposeObject(group);
      },
    });
  }

  fireExplosion(ev) {
    const y = FLOOR_Y[ev.floor];
    const h = y + WAND_HEIGHT;
    const flash = this.glowSprite(0xff9a40, 0.9);
    flash.position.set(ev.x, h, ev.z);
    this.timed(0.4, (k) => {
      flash.scale.setScalar(0.6 + ease(k) * 2.6);
      flash.material.opacity = 0.9 * (1 - k) ** 2;
    }, () => this.disposeObject(flash));
    this.glow.burst(90, ev.x, h, ev.z, { speed: 6, up: 1, life: 0.9, color: new THREE.Color(0xff7a20), colorVar: 0.08, gravity: 6, drag: 1.2 });
    this.dust.burst(20, ev.x, h, ev.z, { speed: 1.2, up: 0.8, life: 1.6, color: new THREE.Color(0x2a2422), drag: 1.5 });

    // Scorch: dark char + glowing embers on the floor, with a dim light while it smoulders.
    const duration = ev.scorch ?? 4;
    const plane = new THREE.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2);
    const charMesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: this.scorchTex.char, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    const glowMesh = new THREE.Mesh(plane.clone(), new THREE.MeshBasicMaterial({ map: this.scorchTex.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 }));
    charMesh.position.set(ev.x, y + 0.03, ev.z);
    glowMesh.position.set(ev.x, y + 0.035, ev.z);
    this.scene.add(charMesh, glowMesh);
    const light = this.takeLight(`scorch${ev.id}`, 0xff6a20);
    if (light) light.position.set(ev.x, y + 0.6, ev.z);
    this.timed(duration, (k, dt, age) => {
      const smoulder = (1 - k) * (0.75 + Math.sin(age * 9) * 0.15 + Math.random() * 0.1);
      glowMesh.material.opacity = smoulder;
      charMesh.material.opacity = k < 0.8 ? 1 : (1 - k) / 0.2;
      if (light) {
        light.intensity = age < 0.25 ? 60 * (1 - age / 0.25) + 6 : 6 * smoulder;
        light.distance = 7;
      }
      if (Math.random() < 0.3 * (1 - k)) {
        this.glow.emit(ev.x + (Math.random() - 0.5) * 1.2, y + 0.05, ev.z + (Math.random() - 0.5) * 1.2, 0, 0.6 + Math.random(), 0, 0.8, new THREE.Color(0xff5010), -0.5, 0.5);
      }
    }, () => {
      this.releaseLight(light);
      this.disposeObject(charMesh);
      this.disposeObject(glowMesh);
    });
  }

  // ---- 3. Water: Tidal Surge ------------------------------------------------------------

  cast_tidal_surge(ev, a) {
    const { dir } = this.origin(ev);
    const y0 = FLOOR_Y[ev.floor];
    const theta = Math.atan2(dir.x, dir.z);
    const waveMat = new THREE.MeshStandardMaterial({
      color: 0x1d8fd0, emissive: 0x0a3a5a, emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.2,
      transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true, theta - a.cone, a.cone * 2).translate(0, 0.5, 0), waveMat);
    const foam = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 4, 40, a.cone * 2), this.additive(0xd8f6ff, 0.8));
    foam.rotation.x = Math.PI / 2;
    // Torus arcs start on +x in the XY plane; after tipping it flat, angle φ maps
    // to (cos φ, sin φ) in (x, z). Rotate so the arc spans the aim cone.
    foam.rotation.z = Math.PI / 2 - theta - a.cone;
    const group = new THREE.Group();
    group.position.set(ev.x, y0 + 0.02, ev.z);
    group.add(wall, foam);
    this.scene.add(group);
    const spray = new THREE.Color(0x9fe0ff);
    this.timed(0.6, (k) => {
      const r = 0.6 + ease(k) * a.range;
      const height = 1.1 * (1 - k * 0.8);
      wall.scale.set(r, height, r);
      foam.scale.set(r, r, 1);
      foam.position.y = height;
      waveMat.opacity = 0.6 * (1 - k * 0.7);
      foam.material.opacity = 0.8 * (1 - k);
      for (let n = 0; n < 5; n++) {
        const ang = theta - a.cone + Math.random() * a.cone * 2;
        this.glow.emit(ev.x + Math.sin(ang) * r, y0 + height, ev.z + Math.cos(ang) * r,
          Math.sin(ang) * 2, 1.5 + Math.random() * 2, Math.cos(ang) * 2, 0.6, spray, 7, 0.5);
      }
    }, () => this.disposeObject(group));
    if (ev.puddle) this.puddle(ev.floor, ev.puddle);
  }

  puddle(floor, p) {
    const y = FLOOR_Y[floor] + 0.025;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x06283a, emissive: 0x04304a, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.06,
      transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(p.r, 40).rotateX(-Math.PI / 2), mat);
    pool.position.set(p.x, y, p.z);
    this.scene.add(pool);
    const ripples = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2), this.additive(0x7fd8ff, 0));
      m.position.set(p.x + (Math.random() - 0.5) * p.r, y + 0.005, p.z + (Math.random() - 0.5) * p.r);
      m.userData.phase = Math.random();
      this.scene.add(m);
      return m;
    });
    this.timed(p.duration, (k, dt, age) => {
      const fade = Math.min(1, age / 0.3) * Math.min(1, (p.duration - age) / 0.6);
      mat.opacity = 0.62 * fade;
      mat.emissiveIntensity = 0.5 + Math.sin(age * 3) * 0.2;
      for (const r of ripples) {
        const rk = (age * 0.8 + r.userData.phase) % 1;
        if (rk < 0.02) r.position.set(p.x + (Math.random() - 0.5) * p.r, y + 0.005, p.z + (Math.random() - 0.5) * p.r);
        r.scale.setScalar(0.1 + rk * p.r * 0.5);
        r.material.opacity = (1 - rk) * 0.35 * fade;
      }
    }, () => {
      this.disposeObject(pool);
      ripples.forEach((r) => this.disposeObject(r));
    });
  }

  // ---- 4. Earth: Terra Spike ---------------------------------------------------------------

  cast_terra_spike(ev, a) {
    const { dir } = this.origin(ev);
    const y0 = FLOOR_Y[ev.floor];
    const dustColor = new THREE.Color(0x6a5a48);
    // A line of spikes racing out in front of the caster.
    const spikes = [];
    for (let s = 1.2; s <= a.range; s += 0.7) {
      const h = 0.8 + Math.random() * 0.9;
      const m = new THREE.Mesh(jaggedSpike(0.22 + Math.random() * 0.15, h), this.stoneMat);
      const side = (Math.random() - 0.5) * 0.8;
      m.position.set(ev.x + dir.x * s - dir.z * side, y0 - h, ev.z + dir.z * s + dir.x * side);
      m.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * 6, (Math.random() - 0.5) * 0.5);
      m.castShadow = true;
      m.userData = { delay: s * 0.035, h };
      this.scene.add(m);
      spikes.push(m);
    }
    this.timed(1.1, (k, dt, age) => {
      for (const m of spikes) {
        const t = age - m.userData.delay;
        if (t < 0) continue;
        const up = Math.min(1, t / 0.08), down = Math.max(0, (t - 0.45) / 0.4);
        m.position.y = y0 - m.userData.h * (1 - ease(up)) - m.userData.h * down;
        if (t < 0.03) this.dust.burst(4, m.position.x, y0 + 0.1, m.position.z, { speed: 1.5, up: 1, life: 1, color: dustColor, drag: 2 });
      }
    }, () => spikes.forEach((m) => this.disposeObject(m)));
    if (ev.wall) this.barricade(ev.id, ev.floor, ev.wall.tiles, ev.wall.duration);
    this.hooks.shake(0.25);
  }

  /** Jagged stone wall over whole tiles. Server events decide when it crumbles. */
  barricade(id, floor, tiles, duration) {
    if (this.barriers.has(id)) return;
    const y0 = FLOOR_Y[floor];
    const group = new THREE.Group();
    const dustColor = new THREE.Color(0x6a5a48);
    for (const [tx, ty] of tiles) {
      const cx = (tx + 0.5) * TILE, cz = (ty + 0.5) * TILE;
      for (let n = 0; n < 7; n++) {
        const h = 2.4 + Math.random() * 1.3;
        const m = new THREE.Mesh(jaggedSpike(0.45 + Math.random() * 0.35, h), this.stoneMat);
        m.position.set(cx + (Math.random() - 0.5) * 1.3, 0, cz + (Math.random() - 0.5) * 1.3);
        m.rotation.set((Math.random() - 0.5) * 0.35, Math.random() * 6, (Math.random() - 0.5) * 0.35);
        m.castShadow = m.receiveShadow = true;
        group.add(m);
      }
      this.dust.burst(26, cx, y0 + 0.2, cz, { speed: 3, up: 1.5, life: 1.4, color: dustColor, drag: 2.5, gravity: 1 });
    }
    group.position.y = y0 - 3.8;
    this.scene.add(group);
    let age = 0, crumbling = -1;
    const b = {
      crumble: () => { if (crumbling < 0) crumbling = 0; },
    };
    this.barriers.set(id, b);
    this.add({
      update: (dt) => {
        age += dt;
        if (crumbling < 0 && age > duration + 1) crumbling = 0; // safety if the event was missed
        if (crumbling >= 0) {
          crumbling += dt;
          group.position.y = y0 - 3.8 * ease(Math.min(1, crumbling / 0.7));
          group.position.x = (Math.random() - 0.5) * 0.05;
          if (Math.random() < 0.6) {
            const [tx, ty] = tiles[Math.floor(Math.random() * tiles.length)];
            this.dust.burst(3, (tx + 0.5) * TILE, y0 + 0.3, (ty + 0.5) * TILE, { speed: 1.5, up: 1, life: 1.2, color: dustColor, drag: 2 });
          }
          return crumbling < 0.7;
        }
        const k = Math.min(1, age / 0.25);
        group.position.y = y0 - 3.8 * (1 - ease(k));
        group.position.x = k < 1 ? (Math.random() - 0.5) * 0.12 : 0;
        return true;
      },
      dispose: () => {
        this.barriers.delete(id);
        this.disposeObject(group);
      },
    });
  }

  // ---- 5. Wind: Gale Force ------------------------------------------------------------------

  cast_gale_force(ev, a) {
    const { o, dir } = this.origin(ev);
    const group = new THREE.Group();
    group.position.copy(o);
    group.rotation.order = 'YXZ';
    group.rotation.y = ev.yaw;
    this.scene.add(group);
    const ribbons = [];
    for (let i = 0; i < 6; i++) {
      const phase = (i / 6) * Math.PI * 2;
      const pts = [];
      for (let s = 0; s <= 24; s++) {
        const u = s / 24;
        const r = 0.55 + u * 1.3;
        const ang = phase + u * Math.PI * 3.2;
        // Starts a metre out so the ribbons spiral around the view instead of through it.
        pts.push(new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r * 0.65, -1 - u * (a.range - 1)));
      }
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.012 + Math.random() * 0.01, 3, false);
      const m = new THREE.Mesh(geo, this.additive(i % 2 ? 0xe8fffb : 0x6ff0d8, 0.6));
      group.add(m);
      ribbons.push(m);
    }
    const streak = new THREE.Color(0xc8fff4);
    this.timed(0.75, (k, dt) => {
      group.rotation.z += dt * 9;
      const reveal = Math.min(1, k / 0.35);
      for (const m of ribbons) {
        const count = m.geometry.index.count;
        m.geometry.setDrawRange(0, Math.floor((count * reveal) / 3) * 3);
        m.material.opacity = 0.6 * (k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55);
      }
      for (let n = 0; n < 6; n++) {
        const s = Math.random() * 1.5;
        this.glow.emit(o.x + dir.x * s + (Math.random() - 0.5), o.y + (Math.random() - 0.5) * 1.2, o.z + dir.z * s + (Math.random() - 0.5),
          dir.x * 16, (Math.random() - 0.5), dir.z * 16, 0.45, streak, 0, 1.5);
      }
    }, () => this.disposeObject(group));
    this.hooks.shake(0.15);
  }

  // ---- 6. White: Sacred Bind ------------------------------------------------------------------

  cast_sacred_bind(ev, a, localPos) {
    const { o, y } = this.origin(ev);
    const to = new THREE.Vector3(ev.to.x, y, ev.to.z);
    const len = o.distanceTo(to);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 8, 1, true).rotateX(Math.PI / 2), this.additive(0xffe6a0, 1));
    beam.position.copy(o).lerp(to, 0.5);
    beam.lookAt(to);
    const flash = this.glowSprite(0xfff2c8, 1);
    flash.position.copy(to);
    this.scene.add(beam);
    const light = this.takeLight(`white${ev.id}`, 0xfff0c0);
    if (light) {
      light.position.copy(to);
      light.distance = 16;
    }
    this.timed(0.7, (k) => {
      beam.material.opacity = 1 - k;
      beam.scale.set(1 + k * 3, 1 + k * 3, 1);
      flash.scale.setScalar(0.8 + ease(k) * 6);
      flash.material.opacity = (1 - k) ** 1.5;
      if (light) light.intensity = 160 * (1 - ease(k));
    }, () => {
      this.releaseLight(light);
      this.disposeObject(beam);
      this.disposeObject(flash);
    });
    this.glow.burst(80, to.x, to.y, to.z, { speed: 4, up: 0.5, life: 1.2, color: new THREE.Color(0xffe08a), colorVar: 0.05, drag: 2.5, gravity: -0.3 });
    if (this.near(ev, localPos, a.range)) this.hooks.screen('white', ev.caster === this.hooks.localId ? 0.7 : 0.4);
  }

  // ---- 7. Anti-magic: Aegis of the Void ----------------------------------------------------------

  cast_aegis_void(ev, a) {
    const y0 = FLOOR_Y[ev.floor];
    const wave = new THREE.Mesh(this.domeGeo, hexMaterial());
    wave.position.set(ev.x, y0, ev.z);
    wave.renderOrder = 6;
    this.scene.add(wave);
    this.timed(0.5, (k) => {
      wave.scale.setScalar(0.4 + ease(k) * a.shieldRadius);
      wave.material.uniforms.uAlpha.value = 1 - k;
      wave.material.uniforms.uTime.value = this.time;
    }, () => {
      this.scene.remove(wave);
      wave.material.dispose();
    });
    this.glow.burst(70, ev.x, y0 + 1, ev.z, { speed: 4, life: 0.8, color: new THREE.Color(0xd8e0ea), colorVar: 0.02, drag: 3 });
  }

  near(ev, localPos, r) {
    return localPos && localPos.floor === ev.floor && Math.hypot(localPos.x - ev.x, localPos.z - ev.z) <= r;
  }

  // ---- per frame -------------------------------------------------------------------------------

  update(dt, t) {
    this.time = t;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      if (!fx.update(dt)) {
        fx.dispose?.();
        this.effects.splice(i, 1);
      }
    }
    for (const [id, d] of this.domes) {
      d.alpha += ((d.active ? 1 : 0) - d.alpha) * Math.min(1, dt * 8);
      d.hit = Math.max(0, d.hit - dt * 2.5);
      const u = d.mesh.material.uniforms;
      u.uAlpha.value = d.alpha;
      u.uHit.value = d.hit;
      u.uTime.value = t;
      d.mesh.scale.setScalar(1 + Math.sin(t * 5) * 0.015 + d.hit * 0.15);
      if (!d.active && d.alpha < 0.01) {
        this.scene.remove(d.mesh);
        d.mesh.material.dispose();
        this.domes.delete(id);
      }
    }
    this.glow.update(dt);
    this.dust.update(dt);
  }
}
