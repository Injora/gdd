// Step 7: pulsing magical tethers from each Heart to the three things that
// seal it (and, for Greed and Gluttony, to the scale / the furnace). Light
// flows from the Heart out to every task still to do; a finished task glows
// steady; once the Heart is unsealed its tethers fade away.

import * as THREE from 'three';
import { SINS } from '/shared/sins.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime, uDone, uAlpha, uSeed;
  varying vec2 vUv;
  void main() {
    float flow = fract(vUv.x * 2.5 - uTime * 0.7 + uSeed);
    float pulse = smoothstep(0.0, 0.12, flow) * smoothstep(0.45, 0.12, flow);
    float k = mix(0.16 + 0.75 * pulse, 0.5 + 0.12 * sin(uTime * 2.0 + uSeed * 6.0), uDone);
    float ends = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
    gl_FragColor = vec4(uColor * k * ends * uAlpha, 1.0);
  }
`;

export class Tethers {
  constructor(mansion) {
    this.mansion = mansion;
    this.time = { value: 0 };
    this.list = []; // { mesh, heart, taskId, mat, fade }
    this.built = false;
  }

  /** The Tome names the Hearts: string up every Heart's tethers. */
  build(hearts) {
    if (this.built) return;
    this.built = true;
    const box = new THREE.Box3();
    const anchor = (id, k) => {
      const obj = this.mansion.propObjects.get(id);
      if (!obj) return null;
      obj.updateWorldMatrix(true, true);
      box.setFromObject(obj);
      const local = obj.parent.worldToLocal(new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + (box.max.y - box.min.y) * k, (box.min.z + box.max.z) / 2));
      return { v: local, parent: obj.parent };
    };
    hearts.forEach((h, hi) => {
      const from = anchor(h.propId, 0.7);
      if (!from) return;
      const color = new THREE.Color(SINS[h.sin].color);
      const ids = [...h.tasks, ...(h.sink !== null && h.sink !== undefined ? [h.sink] : [])];
      ids.forEach((taskId, ti) => {
        const to = anchor(taskId, 0.8);
        if (!to) return;
        const a = from.v, b = to.v;
        const mid = a.clone().add(b).multiplyScalar(0.5);
        mid.y = Math.max(a.y, b.y) + 0.8 + a.distanceTo(b) * 0.12;
        const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
        const mat = new THREE.ShaderMaterial({
          uniforms: { uColor: { value: color }, uTime: this.time, uDone: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: (hi * 7 + ti) * 0.37 } },
          vertexShader: VERT, fragmentShader: FRAG,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.02, 5, false), mat);
        mesh.frustumCulled = true;
        mesh.renderOrder = 3;
        from.parent.add(mesh);
        this.list.push({ mesh, heart: h, taskId, mat, sink: taskId === h.sink });
      });
    });
  }

  /** Per frame: finished tasks glow steady; unsealed or slain Hearts let go. */
  update(dt, t, propState, destroyed) {
    this.time.value = t;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const L = this.list[i];
      const gone = destroyed.has(L.heart.propId) || !!propState[L.heart.propId]?.unsealed;
      const done = L.sink ? (propState[L.taskId]?.count ?? 0) >= L.heart.tasks.length : !!propState[L.taskId]?.done;
      const u = L.mat.uniforms;
      u.uDone.value += ((done ? 1 : 0) - u.uDone.value) * Math.min(1, dt * 3);
      u.uAlpha.value += ((gone ? 0 : 1) - u.uAlpha.value) * Math.min(1, dt * (gone ? 1.2 : 2));
      if (gone && u.uAlpha.value < 0.02) {
        L.mesh.parent?.remove(L.mesh);
        L.mesh.geometry.dispose();
        L.mat.dispose();
        this.list.splice(i, 1);
      }
    }
  }
}
