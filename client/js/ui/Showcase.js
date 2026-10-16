// Step 9: the lobby's 3D hero showcase. The wizard you hover (or have chosen)
// stands on a slowly turning stone pedestal under three-point studio light (a
// warm key, a cool fill, a strong rim in their element's colour), with their
// element's motes rising round them, rendered with its own bloom.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildWizardModel } from '../entities/wizardModel.js';

export class Showcase {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07050a);
    this.scene.fog = new THREE.Fog(0x07050a, 5, 11);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
    this.camera.position.set(0, 1.3, 4.1);
    this.camera.lookAt(0, 1.15, 0);

    // Three-point studio lighting.
    const key = new THREE.SpotLight(0xffe2c0, 32, 12, 0.5, 0.5, 1.4);
    key.position.set(-2.2, 3.4, 2.8);
    key.target.position.set(0, 1, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key, key.target);
    const fill = new THREE.PointLight(0x7a8cff, 6, 10, 1.6);
    fill.position.set(2.6, 1.6, 2.4);
    this.scene.add(fill);
    this.rim = new THREE.SpotLight(0xffffff, 40, 10, 0.6, 0.4, 1.2);
    this.rim.position.set(0.4, 2.8, -2.8);
    this.rim.target.position.set(0, 1.3, 0);
    this.scene.add(this.rim, this.rim.target);
    this.scene.add(new THREE.HemisphereLight(0x1a1e33, 0x080406, 0.6));

    // The pedestal: carved stone, a gold ring, a glowing rune band.
    const stone = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.8 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8a848, roughness: 0.3, metalness: 1 });
    this.runeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2) });
    this.pedestal = new THREE.Group();
    const base = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.82, 0], [0.82, 0.06], [0.74, 0.1], [0.72, 0.2], [0.78, 0.24], [0, 0.24]].map(([r, y]) => new THREE.Vector2(r, y)), 64), stone);
    base.receiveShadow = true;
    this.pedestal.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.02, 8, 96), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.24;
    this.pedestal.add(ring);
    const runes = new THREE.Mesh(new THREE.TorusGeometry(0.73, 0.008, 6, 96), this.runeMat);
    runes.rotation.x = Math.PI / 2;
    runes.position.y = 0.15;
    this.pedestal.add(runes);
    this.scene.add(this.pedestal);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0c0a0e, roughness: 0.35, metalness: 0.2 }));
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Elemental motes rising round the hero.
    const n = 220;
    const pos = new Float32Array(n * 3);
    this.seeds = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.9;
      pos.set([Math.cos(a) * r, Math.random() * 2.4, Math.sin(a) * r], i * 3);
      this.seeds[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.035, color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.motes);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.3, 1.25);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.models = new Map();
    this.current = null;
    this.running = false;
    this.t = 0;
  }

  /** Show `wizard` (from shared/wizards.js). */
  show(wizard) {
    if (!wizard || this.current?.id === wizard.id) return;
    if (this.current) this.pedestal.remove(this.current.model.group);
    let model = this.models.get(wizard.id);
    if (!model) {
      model = buildWizardModel(wizard);
      model.group.position.y = 0.24;
      // A heroic stance: wand raised, the off hand at rest.
      model.armR.sh.rotation.set(-0.9, 0, -0.15);
      model.armR.el.rotation.x = -0.6;
      model.armL.sh.rotation.set(0.1, 0, 0.12);
      model.armL.el.rotation.x = -0.25;
      this.models.set(wizard.id, model);
    }
    this.pedestal.add(model.group);
    this.current = { id: wizard.id, model, wizard };
    const c = new THREE.Color(wizard.color);
    this.rim.color.copy(c).lerp(new THREE.Color(0xffffff), 0.25);
    this.runeMat.color.copy(c).multiplyScalar(2.2);
    this.motes.material.color.copy(c).lerp(new THREE.Color(0xffffff), 0.3);
    model.tipMat.color.copy(c).multiplyScalar(3);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.frame(Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  resize() {
    const w = this.canvas.clientWidth || 360, h = this.canvas.clientHeight || 420;
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame(dt) {
    this.resize();
    this.t += dt;
    const t = this.t;
    this.pedestal.rotation.y = t * 0.35;
    const m = this.current?.model;
    if (m) {
      // Idle: breathing, a stirring of hair and coattails.
      m.body.position.y = Math.sin(t * 1.6) * 0.006;
      m.hair.rotation.z = Math.sin(t * 1.3) * 0.025;
      m.coattails.forEach((c, i) => { c.rotation.x = -0.06 + Math.sin(t * 1.7 + i) * 0.05; });
      m.cravatTail.rotation.x = -0.12 + Math.sin(t * 2.3) * 0.06;
      m.tip.scale.setScalar(1 + Math.sin(t * 5) * 0.2);
      if (m.parts.halo) m.parts.halo.rotation.z = t * 0.4;
    }
    const p = this.motes.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + dt * (0.15 + this.seeds[i] * 0.3);
      if (y > 2.6) y = 0.2;
      p.setY(i, y);
    }
    p.needsUpdate = true;
    this.composer.render();
  }
}
