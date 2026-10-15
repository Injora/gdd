// Step 7: what the crosshair is on. Every frame a ray from the centre of the
// screen looks for an interactable within RANGE; the one it hits gets a white
// outline (an inverted hull: back faces pushed out along their normals) and a
// floating billboard over it: "[Hold E] <Action> (Progress X/3)".

import * as THREE from 'three';
import { lineOfSight } from '/shared/collision.js';
import { FLOOR_Y } from '/shared/constants.js';

export const RANGE = 6;

const OUTLINE_VERT = /* glsl */ `
  uniform float uThick;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normal);
    world.xyz += n * uThick;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const OUTLINE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() { gl_FragColor = vec4(uColor, uOpacity); }
`;

export class Interact {
  constructor(scene, camera, map, mansion) {
    this.scene = scene;
    this.camera = camera;
    this.map = map;
    this.mansion = mansion;
    this.ray = new THREE.Raycaster();
    this.ray.far = RANGE;
    this.center = new THREE.Vector2(0, 0);
    this.hits = [];
    this.hovered = null; // prop
    this.outlines = [];
    this.outlineMat = new THREE.ShaderMaterial({
      uniforms: { uThick: { value: 0.022 }, uColor: { value: new THREE.Color(0xffffff) }, uOpacity: { value: 0.9 } },
      vertexShader: OUTLINE_VERT, fragmentShader: OUTLINE_FRAG,
      side: THREE.BackSide, transparent: true, depthWrite: false,
    });
    // The billboard: a canvas sprite redrawn only when its text changes.
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 128;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.board = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
    this.board.renderOrder = 1002;
    this.board.visible = false;
    scene.add(this.board);
    this.text = '';
    this.tops = new Map(); // prop id -> local top height
    this.box = new THREE.Box3();
    this.eye = new THREE.Vector3();
  }

  /**
   * The interactable under the crosshair (within RANGE, on your floor, not behind a wall).
   * @param candidates props to consider; @param pos {x, z, floor}
   * @returns { prop, dist } or null
   */
  pick(candidates, pos) {
    const objs = [];
    for (const p of candidates) {
      if (p.floor !== pos.floor || Math.hypot(p.x - pos.x, p.z - pos.z) > RANGE + 1.5) continue;
      const obj = this.mansion.propObjects.get(p.id);
      if (obj?.visible) objs.push(obj);
    }
    if (!objs.length) return null;
    this.ray.setFromCamera(this.center, this.camera);
    this.hits.length = 0;
    this.ray.intersectObjects(objs, true, this.hits);
    for (const h of this.hits) {
      if (!h.object.visible || h.object.isSprite || h.object.userData.outline) continue;
      let o = h.object;
      while (o && !o.userData.prop) o = o.parent;
      const prop = o?.userData.prop;
      if (!prop) continue;
      // Through a wall? (the ray can slip between tiles; the plan can't)
      if (!lineOfSight(this.map, pos.floor, pos.x, pos.z, h.point.x, h.point.z)) continue;
      return { prop, dist: Math.hypot(prop.x - pos.x, prop.z - pos.z) };
    }
    return null;
  }

  /** Outline `prop` (or nothing) and show `text` over it. */
  hover(prop, text) {
    if (prop !== this.hovered) {
      this.clearOutline();
      this.hovered = prop;
      if (prop) this.addOutline(prop);
    }
    this.board.visible = !!prop && !!text;
    if (!prop || !text) return;
    if (text !== this.text) this.draw(text);
    const obj = this.mansion.propObjects.get(prop.id);
    this.board.position.set(prop.x, FLOOR_Y[prop.floor] + this.topOf(prop, obj) + 0.35, prop.z);
    // Roughly the same size on screen near or far.
    const d = this.camera.getWorldPosition(this.eye).distanceTo(this.board.position);
    const s = THREE.MathUtils.clamp(d * 0.55, 1.7, 3.2);
    this.board.scale.set(s, s / 8, 1);
  }

  addOutline(prop) {
    const obj = this.mansion.propObjects.get(prop.id);
    if (!obj) return;
    obj.traverse((o) => {
      if (!o.isMesh || o.userData.outline || !o.visible || o.isInstancedMesh) return;
      const m = o.material;
      if (m?.isMeshBasicMaterial || m?.isShaderMaterial || m?.transparent || !o.geometry.attributes.normal) return;
      const hull = new THREE.Mesh(o.geometry, this.outlineMat);
      hull.userData.outline = true;
      hull.castShadow = false;
      hull.receiveShadow = false;
      hull.raycast = () => {};
      o.add(hull);
      this.outlines.push(hull);
    });
  }

  clearOutline() {
    for (const h of this.outlines) h.parent?.remove(h);
    this.outlines.length = 0;
  }

  topOf(prop, obj) {
    if (!this.tops.has(prop.id)) {
      let top = 1.6;
      if (obj) {
        this.box.setFromObject(obj, true);
        top = Math.min(2.8, this.box.max.y - FLOOR_Y[prop.floor]);
      }
      this.tops.set(prop.id, top);
    }
    return this.tops.get(prop.id);
  }

  draw(text) {
    this.text = text;
    const ctx = this.ctx, c = this.canvas;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = '40px "IM Fell English", Georgia, serif';
    const hold = text.startsWith('[Hold E]');
    const body = hold ? text.slice(9) : text;
    const keyW = hold ? ctx.measureText('Hold E').width + 34 : 0;
    const w = Math.min(c.width - 8, keyW + ctx.measureText(body).width + 48);
    const x0 = (c.width - w) / 2;
    ctx.fillStyle = 'rgba(8, 6, 10, 0.78)';
    ctx.strokeStyle = 'rgba(246, 210, 106, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x0, 22, w, 84, 14);
    ctx.fill();
    ctx.stroke();
    ctx.textBaseline = 'middle';
    let x = x0 + 24;
    if (hold) {
      ctx.fillStyle = '#f6d26a';
      ctx.beginPath();
      ctx.roundRect(x - 6, 40, keyW - 16, 48, 8);
      ctx.fill();
      ctx.fillStyle = '#120c06';
      ctx.font = 'bold 32px Cinzel, Georgia, serif';
      ctx.fillText('Hold E', x + 4, 65);
      x += keyW;
      ctx.font = '40px "IM Fell English", Georgia, serif';
    }
    ctx.fillStyle = '#f2e8d4';
    ctx.fillText(body, x, 66, x0 + w - x - 18);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.clearOutline();
    this.scene.remove(this.board);
    this.tex.dispose();
    this.board.material.dispose();
    this.outlineMat.dispose();
  }
}
