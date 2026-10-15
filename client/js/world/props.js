// Procedural models for every prop kind in shared/propdefs.js. Models face +Z
// (out into the room) with their origin on the floor at the prop's position.
//
// Heart-capable props ("curios") get a userData.fx(t, ctx) animator. It only
// shows the heart's tell once the Tome has revealed which props are hearts.

import * as THREE from 'three';
import { WALL_HEIGHT, FLOOR_Y } from '/shared/constants.js';
import { portrait, stainedGlass } from './textures.js';

const std = (color, rough = 0.85, metal = 0, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

export function createPropKit(tex) {
  const M = {
    woodDark: std(0x24160e, 0.75),
    woodMid: std(0x3d2516, 0.8),
    woodRed: std(0x3a1510, 0.6),
    fabricRed: std(0x4a0c12, 1),
    fabricGreen: std(0x18261b, 1),
    fabricDark: std(0x161214, 1),
    velvet: std(0x2a0a10, 0.95),
    felt: std(0x0f2a18, 1),
    brass: std(0x8a6a2a, 0.35, 0.85),
    goldFrame: std(0x6a5020, 0.4, 0.7),
    iron: std(0x2b2b30, 0.45, 0.75),
    stone: std(0x5a5550, 0.95),
    stoneDark: std(0x3a3632, 0.95),
    porcelain: std(0xd8cfc2, 0.4),
    bone: std(0xc8bca0, 0.7),
    linen: std(0xb8b0a0, 0.95),
    black: std(0x070505, 1),
    glass: std(0x3a4450, 0.06, 1),
    clearGlass: new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.18 }),
    wax: std(0xe0d4b8, 0.6),
    deadPlant: std(0x2a2418, 1),
    keys: std(0xd8d0c0, 0.4),
    bloodWater: std(0x2a0204, 0.1, 0, { emissive: 0x100000 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffb050 }),
    ember: std(0x200000, 1, 0, { emissive: 0x6a1000, emissiveIntensity: 0.6 }),
    books: new THREE.MeshStandardMaterial({ map: tex.books, roughness: 0.9 }),
    clockFace: new THREE.MeshStandardMaterial({ map: tex.clockFace, roughness: 0.6 }),
    rug: new THREE.MeshStandardMaterial({ map: tex.rug, roughness: 1 }),
    ritual: new THREE.MeshStandardMaterial({
      map: tex.ritualCircle, transparent: true, depthWrite: false,
      emissive: 0xff1020, emissiveMap: tex.ritualCircle, emissiveIntensity: 0.35, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -2,
    }),
  };

  // Shared animated uniforms (the mansion builder ticks `time`).
  const uniforms = { time: { value: 0 } };

  // Additive glow sprite (flames, runes, magic).
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glowMats = new Map();
  const glowMat = (color) => {
    if (!glowMats.has(color)) {
      glowMats.set(color, new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
    }
    return glowMats.get(color);
  };
  const glow = (g, x, y, z, color, size, own = false) => {
    const sp = new THREE.Sprite(own ? glowMat(color).clone() : glowMat(color));
    sp.position.set(x, y, z);
    sp.scale.setScalar(size);
    g.add(sp);
    return sp;
  };

  // Light cones (moonlight through stained glass, wand beams): additive, fogged by distance.
  const coneMaterial = (color, opacity) => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDist;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uOpacity;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDist;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
        float along = smoothstep(0.0, 0.85, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y) * 0.5);
        float fog = exp(-vDist * 0.09);
        float a = uOpacity * edge * along * fog;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const moonCone = coneMaterial(0x9ab8ff, 0.16);

  const portraits = new Map();
  const getPortrait = (seed, bleeding) => {
    const key = `${seed}:${bleeding}`;
    if (!portraits.has(key)) portraits.set(key, portrait(seed, bleeding));
    return portraits.get(key);
  };

  /** The ancestors in the paintings breathe and sway, very slightly. */
  const movingCanvas = (mat, seed) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uPaintT = uniforms.time;
      shader.uniforms.uPaintSeed = { value: seed * 1.37 };
      shader.fragmentShader = 'uniform float uPaintT;\nuniform float uPaintSeed;\n' + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec2 muv = vMapUv;
          float k = smoothstep(0.3, 0.9, muv.y);
          muv.x += sin(uPaintT * 0.8 + muv.y * 6.0 + uPaintSeed) * 0.006 * k;
          muv.y += sin(uPaintT * 0.55 + uPaintSeed) * 0.004 * k;
          vec4 sampledDiffuseColor = texture2D(map, muv);
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      );
    };
    mat.customProgramCacheKey = () => 'moving-painting';
    return mat;
  };

  // ---- primitive helpers ---------------------------------------------------
  const G = () => new THREE.Group();
  const box = (g, w, h, d, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const cyl = (g, rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 12) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const sph = (g, r, mat, x = 0, y = 0, z = 0, seg = 12) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const legs = (g, w, d, h, t, mat) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, t, h, t, mat, sx * (w / 2 - t), h / 2, sz * (d / 2 - t));
  };
  const candle = (g, x, y, z, lit = true, h = 0.16) => {
    cyl(g, 0.025, 0.028, h, M.wax, x, y + h / 2, z, 8);
    if (lit) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 6), M.flame);
      f.position.set(x, y + h + 0.035, z);
      g.add(f);
      return f;
    }
    return null;
  };
  const sideTable = (g) => {
    cyl(g, 0.3, 0.3, 0.04, M.woodDark, 0, 0.72, 0, 16);
    cyl(g, 0.04, 0.05, 0.7, M.woodDark, 0, 0.36, 0, 8);
    cyl(g, 0.2, 0.22, 0.04, M.woodDark, 0, 0.02, 0, 12);
    return 0.74;
  };

  // ---- models --------------------------------------------------------------
  const builders = {
    bookshelf() {
      const g = G();
      box(g, 1.9, 3, 0.05, M.woodDark, 0, 1.5, -0.22);
      for (const sx of [-1, 1]) box(g, 0.06, 3, 0.5, M.woodDark, sx * 0.92, 1.5, 0);
      for (let i = 0; i <= 5; i++) box(g, 1.8, 0.05, 0.48, M.woodDark, 0, 0.05 + i * 0.58, 0);
      for (let i = 0; i < 5; i++) box(g, 1.76, 0.44, 0.34, M.books, 0, 0.3 + i * 0.58, -0.02);
      return g;
    },
    table() {
      const g = G();
      box(g, 1.5, 0.08, 1.0, M.woodDark, 0, 0.78, 0);
      legs(g, 1.4, 0.9, 0.76, 0.08, M.woodDark);
      return g;
    },
    longtable() {
      const g = G();
      box(g, 1.3, 0.08, 5.6, M.woodDark, 0, 0.78, 0);
      for (const z of [-2.6, 0, 2.6]) for (const sx of [-1, 1]) box(g, 0.1, 0.76, 0.1, M.woodDark, sx * 0.55, 0.38, z);
      box(g, 0.5, 0.01, 5.4, M.linen, 0, 0.825, 0);
      for (const z of [-1.8, 0, 1.8]) {
        cyl(g, 0.06, 0.09, 0.05, M.brass, 0, 0.85, z, 8);
        cyl(g, 0.015, 0.015, 0.3, M.brass, 0, 1.0, z, 6);
        candle(g, 0, 1.15, z, false);
      }
      for (const z of [-2.2, -1.1, 0, 1.1, 2.2]) {
        for (const sx of [-1, 1]) {
          const c = builders.chair();
          c.scale.setScalar(0.9);
          c.position.set(sx * 0.82, 0, z);
          c.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
          g.add(c);
        }
      }
      return g;
    },
    chair() {
      const g = G();
      box(g, 0.5, 0.06, 0.5, M.woodDark, 0, 0.45, 0);
      legs(g, 0.5, 0.5, 0.44, 0.05, M.woodDark);
      box(g, 0.5, 0.65, 0.05, M.woodDark, 0, 0.8, -0.23);
      box(g, 0.42, 0.04, 0.42, M.velvet, 0, 0.49, 0.01);
      return g;
    },
    armchair() {
      const g = G();
      box(g, 0.95, 0.42, 0.85, M.fabricRed, 0, 0.25, 0);
      box(g, 0.95, 0.75, 0.18, M.fabricRed, 0, 0.75, -0.34);
      for (const sx of [-1, 1]) box(g, 0.14, 0.25, 0.85, M.fabricRed, sx * 0.42, 0.55, 0);
      legs(g, 0.9, 0.8, 0.08, 0.06, M.woodDark);
      return g;
    },
    bed() {
      const g = G();
      box(g, 1.7, 1.3, 0.1, M.woodDark, 0, 0.65, -1.7);
      box(g, 1.7, 0.7, 0.1, M.woodDark, 0, 0.35, 1.7);
      box(g, 1.66, 0.3, 3.3, M.woodDark, 0, 0.25, 0);
      box(g, 1.58, 0.2, 3.2, M.linen, 0, 0.5, 0);
      box(g, 1.2, 0.12, 0.4, M.linen, 0, 0.66, -1.4);
      box(g, 1.62, 0.1, 2.2, M.fabricRed, 0, 0.62, 0.5);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.05, 0.05, 1.8, M.woodDark, sx * 0.8, 0.9, sz * 1.68, 8);
      return g;
    },
    wardrobe() {
      const g = G();
      box(g, 1.6, 2.4, 0.7, M.woodDark, 0, 1.2, 0);
      box(g, 1.7, 0.1, 0.78, M.woodMid, 0, 2.45, 0);
      box(g, 0.02, 2.2, 0.02, M.black, 0, 1.2, 0.36);
      for (const sx of [-1, 1]) sph(g, 0.03, M.brass, sx * 0.08, 1.2, 0.37, 8);
      return g;
    },
    cabinet() {
      const g = G();
      box(g, 1.4, 1.0, 0.55, M.woodDark, 0, 0.5, 0);
      box(g, 1.46, 0.05, 0.6, M.woodMid, 0, 1.02, 0);
      for (let i = 0; i < 3; i++) {
        box(g, 1.3, 0.01, 0.01, M.black, 0, 0.3 + i * 0.25, 0.28);
        sph(g, 0.025, M.brass, 0, 0.42 + i * 0.25, 0.29, 6);
      }
      return g;
    },
    desk() {
      const g = G();
      box(g, 1.6, 0.06, 0.8, M.woodRed, 0, 0.76, 0);
      for (const sx of [-1, 1]) box(g, 0.4, 0.73, 0.75, M.woodDark, sx * 0.58, 0.37, 0);
      box(g, 0.3, 0.005, 0.4, M.linen, 0.1, 0.795, 0.05);
      cyl(g, 0.04, 0.04, 0.06, M.black, -0.4, 0.82, -0.2, 8);
      return g;
    },
    piano() {
      const g = G();
      box(g, 1.7, 1.3, 0.6, M.black, 0, 0.65, -0.05);
      box(g, 1.6, 0.06, 0.28, M.black, 0, 0.75, 0.36);
      box(g, 1.5, 0.03, 0.16, M.keys, 0, 0.79, 0.4);
      for (let i = 0; i < 20; i++) box(g, 0.025, 0.03, 0.09, M.black, -0.7 + i * 0.075, 0.81, 0.36);
      box(g, 0.8, 0.06, 0.35, M.black, 0, 0.5, 0.75);
      return g;
    },
    pillar() {
      const g = G();
      box(g, 0.8, 0.2, 0.8, M.stone, 0, 0.1, 0);
      cyl(g, 0.3, 0.32, 3.6, M.stone, 0, 2.0, 0, 16);
      box(g, 0.8, 0.2, 0.8, M.stone, 0, WALL_HEIGHT - 0.1, 0);
      return g;
    },
    statue() {
      const g = G();
      box(g, 0.9, 0.9, 0.9, M.stone, 0, 0.45, 0);
      const robe = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.5, 10), M.stoneDark);
      robe.position.set(0, 1.65, 0);
      g.add(robe);
      sph(g, 0.15, M.stoneDark, 0, 2.5, 0);
      // Weeping: hands raised over the face
      for (const sx of [-1, 1]) sph(g, 0.07, M.stoneDark, sx * 0.07, 2.47, 0.13, 8);
      for (const sx of [-1, 1]) {
        const wing = box(g, 0.05, 1.2, 0.5, M.stoneDark, sx * 0.25, 2.0, -0.28);
        wing.rotation.z = sx * 0.35;
        wing.rotation.y = sx * 0.4;
      }
      return g;
    },
    fireplace() {
      const g = G();
      box(g, 1.9, 1.5, 0.5, M.stone, 0, 0.75, -0.05);
      box(g, 1.0, 0.85, 0.3, M.black, 0, 0.43, 0.08);
      box(g, 2.05, 0.08, 0.62, M.stoneDark, 0, 1.52, 0);
      box(g, 0.7, 0.06, 0.2, M.ember, 0, 0.05, 0.08);
      return g;
    },
    crib() {
      const g = G();
      box(g, 1.2, 0.05, 0.7, M.woodMid, 0, 0.35, 0);
      box(g, 1.1, 0.08, 0.6, M.linen, 0, 0.41, 0);
      for (const sz of [-1, 1]) {
        box(g, 1.24, 0.04, 0.04, M.woodMid, 0, 0.9, sz * 0.36);
        for (let i = 0; i < 9; i++) cyl(g, 0.012, 0.012, 0.55, M.woodMid, -0.56 + i * 0.14, 0.62, sz * 0.36, 5);
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.05, 0.95, 0.05, M.woodMid, sx * 0.6, 0.47, sz * 0.36);
      return g;
    },
    rockinghorse() {
      const g = G();
      box(g, 0.26, 0.26, 0.75, M.woodRed, 0, 0.6, 0);
      const head = box(g, 0.16, 0.36, 0.22, M.woodRed, 0, 0.85, 0.38);
      head.rotation.x = -0.3;
      for (const sx of [-1, 1]) {
        const rocker = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.025, 4, 16, 1.2), M.woodDark);
        rocker.rotation.set(0, Math.PI / 2, Math.PI + (Math.PI - 1.2) / 2);
        rocker.position.set(sx * 0.18, 0.78, 0);
        g.add(rocker);
        for (const sz of [-1, 1]) box(g, 0.04, 0.45, 0.04, M.woodDark, sx * 0.14, 0.3, sz * 0.25);
      }
      return g;
    },
    coffin() {
      const g = G();
      box(g, 0.7, 0.45, 1.85, M.woodDark, 0, 0.23, 0);
      const lid = box(g, 0.74, 0.06, 1.9, M.woodMid, 0.05, 0.49, 0.02);
      lid.rotation.z = -0.06;
      box(g, 0.08, 0.02, 0.5, M.brass, 0, 0.53, -0.3);
      box(g, 0.3, 0.02, 0.08, M.brass, 0, 0.53, -0.4);
      return g;
    },
    sarcophagus() {
      const g = G();
      box(g, 1.1, 0.8, 1.85, M.stone, 0, 0.4, 0);
      box(g, 1.16, 0.14, 1.92, M.stoneDark, 0, 0.87, 0);
      const effigy = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.1, 4, 8), M.stone);
      effigy.rotation.x = Math.PI / 2;
      effigy.position.set(0, 1.04, 0.05);
      g.add(effigy);
      sph(g, 0.13, M.stone, 0, 1.06, -0.7);
      return g;
    },
    barrel() {
      const g = G();
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push(new THREE.Vector2(0.34 + Math.sin(t * Math.PI) * 0.07, t * 1.0));
      }
      const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), M.woodMid);
      g.add(m);
      for (const y of [0.15, 0.85]) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.015, 4, 16), M.iron);
        band.rotation.x = Math.PI / 2;
        band.position.y = y;
        g.add(band);
      }
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.34, 14), M.woodDark);
      top.rotation.x = -Math.PI / 2;
      top.position.y = 1.0;
      g.add(top);
      return g;
    },
    crate() {
      const g = G();
      box(g, 0.92, 0.92, 0.92, M.woodMid, 0, 0.46, 0);
      for (const y of [0.08, 0.84]) box(g, 0.95, 0.08, 0.95, M.woodDark, 0, y, 0);
      return g;
    },
    pew() {
      const g = G();
      box(g, 1.8, 0.06, 0.45, M.woodDark, 0, 0.45, 0.02);
      box(g, 1.8, 0.6, 0.06, M.woodDark, 0, 0.8, -0.2);
      for (const sx of [-1, 1]) box(g, 0.06, 0.95, 0.55, M.woodDark, sx * 0.9, 0.47, 0);
      return g;
    },
    plant() {
      const g = G();
      cyl(g, 0.3, 0.18, 0.6, M.stone, 0, 0.3, 0, 12);
      for (let i = 0; i < 6; i++) {
        const b = cyl(g, 0.012, 0.02, 0.9, M.deadPlant, 0, 0.95, 0, 5);
        b.rotation.set(Math.sin(i * 2.1) * 0.6, i, Math.cos(i * 1.7) * 0.6);
      }
      return g;
    },
    billiard() {
      const g = G();
      box(g, 1.5, 0.16, 1.9, M.woodRed, 0, 0.78, 0);
      box(g, 1.3, 0.02, 1.7, M.felt, 0, 0.87, 0);
      legs(g, 1.4, 1.8, 0.72, 0.12, M.woodRed);
      sph(g, 0.03, M.linen, 0.2, 0.91, 0.3, 8);
      sph(g, 0.03, M.fabricRed, -0.3, 0.91, -0.2, 8);
      return g;
    },
    bathtub() {
      const g = G();
      box(g, 0.85, 0.5, 1.75, M.porcelain, 0, 0.38, 0);
      box(g, 0.7, 0.02, 1.6, M.bloodWater, 0, 0.6, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) sph(g, 0.06, M.brass, sx * 0.35, 0.06, sz * 0.75, 8);
      return g;
    },
    stove() {
      const g = G();
      box(g, 1.4, 0.9, 0.75, M.iron, 0, 0.45, 0);
      box(g, 1.45, 0.05, 0.8, M.black, 0, 0.92, 0);
      cyl(g, 0.1, 0.1, WALL_HEIGHT - 0.95, M.iron, 0.45, (WALL_HEIGHT + 0.95) / 2, -0.2, 10);
      cyl(g, 0.2, 0.18, 0.25, M.iron, -0.3, 1.07, 0.05, 12);
      return g;
    },
    antlers() {
      const g = G();
      box(g, 0.35, 0.45, 0.05, M.woodDark, 0, 2.6, -0.05);
      sph(g, 0.1, M.bone, 0, 2.62, 0.06, 8);
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const a = cyl(g, 0.015, 0.025, 0.45 - i * 0.08, M.bone, sx * (0.12 + i * 0.1), 2.8 + i * 0.06, 0.05, 5);
          a.rotation.z = -sx * (0.6 + i * 0.25);
        }
      }
      return g;
    },
    sconce(prop) {
      // A flickering wall sconce: brass bracket, a lit candle, a halo of light.
      const g = G();
      box(g, 0.12, 0.3, 0.04, M.brass, 0, 2.2, -0.06);
      const arm = cyl(g, 0.015, 0.015, 0.22, M.brass, 0, 2.16, 0.04, 6);
      arm.rotation.x = Math.PI / 2;
      cyl(g, 0.07, 0.04, 0.04, M.brass, 0, 2.18, 0.14, 10);
      const flame = candle(g, 0, 2.2, 0.14, true, 0.12);
      const halo = glow(g, 0, 2.39, 0.14, 0xffa848, 0.55, true);
      const seed = (prop?.variant ?? 0) * 0.37;
      g.userData.fx = (t) => {
        const n = Math.sin(t * 9 + seed) * 0.5 + Math.sin(t * 23.7 + seed * 2) * 0.3 + Math.sin(t * 3.1 + seed) * 0.2;
        flame.scale.set(1, 1 + n * 0.25, 1);
        halo.material.opacity = 0.55 + n * 0.25;
        halo.scale.setScalar(0.55 + n * 0.08);
      };
      return g;
    },
    shackles() {
      const g = G();
      box(g, 0.3, 0.12, 0.04, M.iron, 0, 2.0, -0.06);
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          const link = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 4, 8), M.iron);
          link.position.set(sx * 0.1, 1.92 - i * 0.055, -0.03);
          link.rotation.y = i % 2 ? Math.PI / 2 : 0;
          g.add(link);
        }
        const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12), M.iron);
        cuff.position.set(sx * 0.1, 1.6, -0.02);
        g.add(cuff);
      }
      return g;
    },
    rug() {
      const g = G();
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), M.rug);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.012;
      g.add(m);
      return g;
    },
    ritualcircle() {
      const g = G();
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), M.ritual);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.02;
      g.add(m);
      return g;
    },
    chandelier(prop) {
      // Ornate wrought-iron chandelier: two tiers of lit candles. Over the
      // Balcony Gallery's void it hangs low into the double-height Foyer.
      const g = G();
      const drop = prop?.overVoid ? 4.6 : 0;
      const top = WALL_HEIGHT;
      const y0 = top - 1.1 - drop;
      cyl(g, 0.012, 0.012, 1.1 + drop, M.iron, 0, top - (1.1 + drop) / 2, 0, 4);
      const flames = [];
      const halos = [];
      for (const [r, dy, n] of [[0.7, 0, 8], [0.38, 0.32, 5]]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 32), M.brass);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y0 + dy;
        g.add(ring);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
          cyl(g, 0.035, 0.02, 0.03, M.brass, cx, y0 + dy + 0.015, cz, 6);
          flames.push(candle(g, cx, y0 + dy + 0.03, cz, true, 0.12));
          if (i % 2 === 0) halos.push(glow(g, cx, y0 + dy + 0.22, cz, 0xffb060, 0.5, true));
        }
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const arm = cyl(g, 0.008, 0.008, 0.75, M.iron, Math.cos(a) * 0.35, y0 + 0.4, Math.sin(a) * 0.35, 4);
        arm.rotation.z = Math.cos(a) * 0.6;
        arm.rotation.x = -Math.sin(a) * 0.6;
      }
      sph(g, 0.09, M.brass, 0, y0 - 0.12, 0, 10);
      g.userData.fx = (t) => {
        halos.forEach((h, i) => { h.material.opacity = 0.5 + Math.sin(t * 8 + i * 1.7) * 0.15 + Math.sin(t * 21 + i) * 0.08; });
        flames.forEach((f, i) => { f.scale.y = 1 + Math.sin(t * 11 + i * 2.1) * 0.2; });
      };
      return g;
    },
    candles(prop) {
      const g = G();
      const flames = [];
      const n = 3 + (prop.variant % 3);
      for (let i = 0; i < n; i++) {
        const a = i * 2.4 + prop.variant;
        const r = 0.12 + (i % 2) * 0.12;
        flames.push(candle(g, Math.cos(a) * r, 0, Math.sin(a) * r, true, 0.12 + ((i * 37) % 10) * 0.025));
      }
      g.userData.flames = flames;
      return g;
    },
    tome() {
      const g = G();
      cyl(g, 0.06, 0.12, 1.0, M.woodDark, 0, 0.5, 0, 8);
      cyl(g, 0.25, 0.28, 0.06, M.woodDark, 0, 0.03, 0, 10);
      const top = G();
      top.position.set(0, 1.08, 0);
      top.rotation.x = 0.45;
      box(top, 0.7, 0.05, 0.5, M.woodDark);
      const pagesMat = std(0xc9b58c, 0.9, 0, { emissive: 0x500000, emissiveIntensity: 0.25 });
      box(top, 0.6, 0.04, 0.42, M.velvet, 0, 0.04, 0);
      const l = box(top, 0.28, 0.03, 0.38, pagesMat, -0.14, 0.075, 0);
      const r = box(top, 0.28, 0.03, 0.38, pagesMat, 0.14, 0.075, 0);
      l.rotation.z = 0.08;
      r.rotation.z = -0.08;
      g.add(top);
      g.userData.fx = (t) => { pagesMat.emissiveIntensity = 0.2 + Math.sin(t * 1.3) * 0.12; };
      return g;
    },
    altar() {
      const g = G();
      box(g, 2.2, 1.0, 1.3, M.stone, 0, 0.5, 0);
      box(g, 2.3, 0.1, 1.4, M.stoneDark, 0, 1.05, 0);
      box(g, 0.6, 0.02, 1.42, M.fabricRed, 0, 1.11, 0);
      box(g, 0.6, 0.7, 0.02, M.fabricRed, 0, 0.75, 0.71);
      cyl(g, 0.18, 0.1, 0.1, M.brass, 0, 1.16, 0, 14);
      sph(g, 0.11, M.bone, 0.6, 1.2, -0.2, 10);
      const runeMat = std(0x220a2a, 0.9, 0, { emissive: 0x6020a0, emissiveIntensity: 0.3 });
      for (let i = 0; i < 7; i++) box(g, 0.08, 0.3, 0.02, runeMat, -0.9 + i * 0.3, 0.5, 0.66);
      g.userData.fx = (t) => { runeMat.emissiveIntensity = 0.25 + Math.sin(t * 0.8) * 0.15; };
      return g;
    },
    stairs_down() {
      const g = G();
      const pit = new THREE.Mesh(new THREE.BoxGeometry(1.96, 3.2, 1.96), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
      pit.position.y = -1.6;
      g.add(pit);
      for (let i = 0; i < 6; i++) box(g, 1.7, 0.08, 0.32, M.woodDark, 0, -0.35 - i * 0.42, 0.8 - i * 0.32);
      for (const sx of [-1, 1]) {
        box(g, 0.06, 0.06, 1.9, M.woodDark, sx * 0.93, 0.95, 0);
        for (const sz of [-0.9, 0, 0.9]) box(g, 0.06, 0.95, 0.06, M.woodDark, sx * 0.93, 0.47, sz);
      }
      return g;
    },
    stairs_up() {
      const g = G();
      for (let i = 0; i < 8; i++) {
        const h = 0.45 * (i + 1);
        box(g, 1.7, h, 0.24, M.stoneDark, 0, h / 2, 0.85 - i * 0.24);
      }
      for (const sx of [-1, 1]) box(g, 0.12, WALL_HEIGHT, 1.96, M.stone, sx * 0.92, WALL_HEIGHT / 2, 0);
      return g;
    },
    gate() {
      const g = G();
      const door = G();
      door.position.x = -0.95; // hinge on the left
      for (let i = 0; i < 10; i++) cyl(door, 0.022, 0.022, 3.2, M.iron, 0.1 + i * 0.19, 1.6, 0, 6);
      for (const y of [0.25, 1.6, 2.95]) box(door, 1.9, 0.06, 0.06, M.iron, 0.95, y, 0);
      const lockMat = std(0x8a6a2a, 0.35, 0.85, { emissive: 0xff1020, emissiveIntensity: 0.4 });
      box(door, 0.16, 0.2, 0.1, lockMat, 1.75, 1.4, 0.06);
      g.add(door);
      box(g, 2.0, 0.15, 0.2, M.iron, 0, WALL_HEIGHT - 0.6, 0);
      g.userData.door = door;
      g.userData.fx = (t) => { lockMat.emissiveIntensity = 0.3 + Math.sin(t * 2) * 0.2; };
      return g;
    },

    // ---- Step 6: stairs between Floors 1 and 2 ----------------------------------
    grand_stair() {
      // An iron-and-oak spiral staircase rising through the ceiling to Floor 2.
      const g = G();
      const rise = FLOOR_Y[2];
      cyl(g, 0.12, 0.14, rise, M.stoneDark, 0, rise / 2, 0, 12);
      const steps = 15;
      const pts = [];
      for (let i = 0; i < steps; i++) {
        const k = i / (steps - 1);
        const a = Math.PI * 0.5 + k * Math.PI * 1.75;
        const y = 0.25 + k * (rise - 0.3);
        const step = G();
        step.position.y = y;
        step.rotation.y = -a;
        box(step, 0.82, 0.07, 0.34, M.woodMid, 0.5, 0, 0);
        box(step, 0.82, 0.02, 0.36, M.velvet, 0.5, 0.045, 0);
        g.add(step);
        const rx = Math.cos(a) * 0.9, rz = -Math.sin(a) * 0.9;
        if (i % 2 === 0) cyl(g, 0.012, 0.012, 0.85, M.iron, rx, y + 0.42, rz, 5);
        pts.push(new THREE.Vector3(rx, y + 0.86, rz));
      }
      const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.025, 6, false), M.brass);
      g.add(rail);
      // Newel post with a brass finial at the foot.
      cyl(g, 0.06, 0.07, 1.1, M.woodDark, pts[0].x, 0.55, pts[0].z, 8);
      sph(g, 0.07, M.brass, pts[0].x, 1.15, pts[0].z, 10);
      return g;
    },
    stairs_landing() {
      // The head of a spiral stair on Floor 2: a balustrade round the stairwell.
      const g = G();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.03, 6, 32, Math.PI * 1.5), M.brass);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = Math.PI * 0.75;
      ring.position.y = 0.95;
      g.add(ring);
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
        cyl(g, 0.018, 0.018, 0.95, M.iron, Math.cos(a) * 0.92, 0.475, -Math.sin(a) * 0.92, 5);
      }
      // The hole's rim (the floor tile itself is left open by the builder).
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.0, 32).rotateX(-Math.PI / 2), M.woodDark);
      rim.position.y = 0.01;
      g.add(rim);
      return g;
    },

    // ---- Step 6: furniture of the new rooms ------------------------------------
    armor(prop) {
      // An empty suit of armour on a plinth, halberd in hand.
      const g = G();
      box(g, 0.7, 0.12, 0.55, M.stoneDark, 0, 0.06, 0);
      const steel = M.iron;
      for (const sx of [-1, 1]) {
        cyl(g, 0.07, 0.08, 0.75, steel, sx * 0.12, 0.5, 0, 8);
        box(g, 0.13, 0.08, 0.22, steel, sx * 0.12, 0.16, 0.04);
        sph(g, 0.065, steel, sx * 0.12, 0.88, 0.02, 8);
      }
      const torso = cyl(g, 0.2, 0.17, 0.62, steel, 0, 1.28, 0, 12);
      torso.scale.z = 0.7;
      cyl(g, 0.17, 0.2, 0.18, steel, 0, 0.95, 0, 12).scale.z = 0.75;
      for (const sx of [-1, 1]) {
        sph(g, 0.1, steel, sx * 0.28, 1.55, 0, 10);
        cyl(g, 0.05, 0.05, 0.55, steel, sx * 0.3, 1.25, 0.02, 8);
      }
      const helm = sph(g, 0.15, steel, 0, 1.78, 0, 14);
      helm.scale.set(0.9, 1.15, 1);
      box(g, 0.18, 0.025, 0.02, M.black, 0, 1.79, 0.13);
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.3, 6), M.fabricRed);
      plume.position.set(0, 2.0, -0.04);
      plume.rotation.x = -0.4;
      g.add(plume);
      const pole = cyl(g, 0.018, 0.018, 2.3, M.woodDark, (prop?.variant % 2 ? 1 : -1) * 0.36, 1.25, 0.12, 6);
      pole.rotation.z = 0.04;
      const blade = box(g, 0.02, 0.32, 0.18, steel, (prop?.variant % 2 ? 1 : -1) * 0.36, 2.35, 0.18);
      blade.rotation.y = 0.2;
      return g;
    },
    weaponrack() {
      const g = G();
      box(g, 1.6, 0.08, 0.35, M.woodDark, 0, 0.3, 0);
      box(g, 1.6, 0.08, 0.2, M.woodDark, 0, 1.6, -0.08);
      for (const sx of [-1, 1]) box(g, 0.08, 1.8, 0.35, M.woodDark, sx * 0.76, 0.9, 0);
      for (let i = 0; i < 5; i++) {
        const x = -0.56 + i * 0.28;
        if (i % 2) {
          cyl(g, 0.014, 0.014, 1.9, M.woodMid, x, 1.25, 0, 5);
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 4), M.iron);
          tip.position.set(x, 2.3, 0);
          g.add(tip);
        } else {
          box(g, 0.05, 1.05, 0.012, M.iron, x, 1.05, 0.02);
          box(g, 0.18, 0.03, 0.04, M.brass, x, 0.5, 0.02);
          cyl(g, 0.016, 0.016, 0.2, M.fabricDark, x, 0.36, 0.02, 6);
        }
      }
      return g;
    },
    telescope() {
      const g = G();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const leg = cyl(g, 0.02, 0.025, 1.3, M.woodDark, Math.cos(a) * 0.28, 0.62, Math.sin(a) * 0.28, 6);
        leg.rotation.z = Math.cos(a) * 0.25;
        leg.rotation.x = -Math.sin(a) * 0.25;
      }
      const tube = G();
      tube.position.set(0, 1.3, 0);
      tube.rotation.x = -0.7;
      cyl(tube, 0.07, 0.09, 1.3, M.brass, 0, 0.3, 0, 14);
      cyl(tube, 0.1, 0.1, 0.12, M.brass, 0, 0.95, 0, 14);
      cyl(tube, 0.035, 0.035, 0.2, M.brass, 0, -0.4, 0, 8);
      g.add(tube);
      sph(g, 0.06, M.brass, 0, 1.3, 0, 8);
      return g;
    },
    globe() {
      const g = G();
      cyl(g, 0.22, 0.26, 0.05, M.woodDark, 0, 0.03, 0, 12);
      cyl(g, 0.03, 0.04, 0.75, M.woodDark, 0, 0.42, 0, 8);
      const sea = std(0x1a3048, 0.6);
      const ball = sph(g, 0.3, sea, 0, 1.05, 0, 20);
      ball.rotation.z = 0.4;
      for (let i = 0; i < 6; i++) {
        const land = sph(g, 0.09 + (i % 3) * 0.03, std(0x6a5a30, 0.8), 0, 0, 0, 8);
        const a = i * 1.3, e = (i % 3 - 1) * 0.5;
        land.position.set(Math.cos(a) * Math.cos(e) * 0.24, 1.05 + Math.sin(e) * 0.24, Math.sin(a) * Math.cos(e) * 0.24);
        land.scale.set(1, 0.35, 1);
        land.lookAt(0, 1.05, 0);
      }
      const meridian = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.012, 6, 32), M.brass);
      meridian.position.y = 1.05;
      meridian.rotation.z = 0.4;
      g.add(meridian);
      return g;
    },
    cauldron() {
      const g = G();
      const pot = new THREE.Mesh(new THREE.LatheGeometry([[0.05, 0], [0.38, 0.08], [0.48, 0.35], [0.44, 0.62], [0.47, 0.66]].map(([r, y]) => new THREE.Vector2(r, y)), 18), M.iron);
      pot.position.y = 0.12;
      g.add(pot);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        cyl(g, 0.03, 0.02, 0.2, M.iron, Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3, 5);
      }
      const brewMat = std(0x0a2a08, 0.3, 0, { emissive: 0x3aff40, emissiveIntensity: 0.6 });
      const brew = cyl(g, 0.42, 0.42, 0.02, brewMat, 0, 0.7, 0, 18);
      const halo = glow(g, 0, 0.95, 0, 0x5aff60, 1.1, true);
      const bubbles = [];
      for (let i = 0; i < 5; i++) bubbles.push(sph(g, 0.04, brewMat, 0, 0.72, 0, 6));
      g.userData.fx = (t) => {
        brewMat.emissiveIntensity = 0.5 + Math.sin(t * 2.3) * 0.15;
        halo.material.opacity = 0.35 + Math.sin(t * 1.7) * 0.1;
        bubbles.forEach((b, i) => {
          const k = (t * 0.6 + i * 0.21) % 1;
          b.position.set(Math.cos(i * 2.4) * 0.22, 0.71 + k * 0.08, Math.sin(i * 2.4) * 0.22);
          b.scale.setScalar(Math.sin(k * Math.PI));
        });
        brew.rotation.y = t * 0.2;
      };
      return g;
    },
    alembic() {
      const g = G();
      box(g, 1.5, 0.06, 0.75, M.woodDark, 0, 0.82, 0);
      legs(g, 1.4, 0.65, 0.8, 0.06, M.woodDark);
      const potions = [0xff3a5a, 0x5affc8, 0xffc23a, 0x9a5aff];
      const lit = [];
      for (let i = 0; i < 4; i++) {
        const c = potions[i];
        const liq = std(c, 0.2, 0, { emissive: c, emissiveIntensity: 0.45 });
        lit.push(liq);
        const x = -0.55 + i * 0.36;
        const flask = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), M.clearGlass);
        flask.position.set(x, 0.96, (i % 2) * 0.12 - 0.06);
        g.add(flask);
        sph(g, 0.075, liq, x, 0.94, (i % 2) * 0.12 - 0.06, 10).scale.y = 0.7;
        cyl(g, 0.02, 0.02, 0.18, M.clearGlass, x, 1.12, (i % 2) * 0.12 - 0.06, 6);
      }
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 6, 24), M.brass);
      coil.position.set(0.55, 1.15, -0.2);
      g.add(coil);
      cyl(g, 0.012, 0.012, 0.8, M.brass, 0.1, 1.25, -0.2, 6).rotation.z = 1.2;
      g.userData.fx = (t) => { lit.forEach((m, i) => { m.emissiveIntensity = 0.35 + Math.sin(t * 1.5 + i) * 0.15; }); };
      return g;
    },
    window(prop) {
      // A pointed Gothic window of stained glass, moonlight pouring through it.
      const g = G();
      const y = 2.35;
      const shape = new THREE.Shape();
      shape.moveTo(-0.62, -1.1); shape.lineTo(0.62, -1.1); shape.lineTo(0.62, 0.55);
      shape.quadraticCurveTo(0.62, 1.15, 0, 1.3); shape.quadraticCurveTo(-0.62, 1.15, -0.62, 0.55);
      shape.closePath();
      const hole = new THREE.Path();
      hole.moveTo(-0.5, -1.0); hole.lineTo(0.5, -1.0); hole.lineTo(0.5, 0.5);
      hole.quadraticCurveTo(0.5, 1.02, 0, 1.15); hole.quadraticCurveTo(-0.5, 1.02, -0.5, 0.5);
      hole.closePath();
      shape.holes.push(hole);
      const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }), M.stone);
      frame.position.set(0, y, -0.06);
      g.add(frame);
      const glassMat = new THREE.MeshBasicMaterial({ map: stainedGlass(prop?.variant ?? 1), transparent: true, fog: true });
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.15), glassMat);
      glass.position.set(0, y + 0.07, 0);
      g.add(glass);
      box(g, 1.3, 0.1, 0.25, M.stone, 0, y - 1.15, 0.06); // sill
      // The moonbeam: a cone sloping down into the room.
      const len = 4.2;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.25, len, 20, 1, true), moonCone);
      beam.geometry.translate(0, -len / 2, 0);
      beam.position.set(0, y + 0.3, 0.1);
      beam.rotation.x = 1.05;
      g.add(beam);
      g.userData.windowBeam = beam;
      return g;
    },

    // ---- Step 6: the room tasks (three per Heart room) ------------------------
    brazier(prop) {
      const g = G();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const leg = cyl(g, 0.02, 0.03, 0.95, M.iron, Math.cos(a) * 0.22, 0.45, Math.sin(a) * 0.22, 5);
        leg.rotation.z = Math.cos(a) * 0.2;
        leg.rotation.x = -Math.sin(a) * 0.2;
      }
      const bowl = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.18, 0.02], [0.32, 0.14], [0.34, 0.2]].map(([r, y2]) => new THREE.Vector2(r, y2)), 16), M.iron);
      bowl.position.y = 0.88;
      g.add(bowl);
      const runeMat = std(0x10080a, 0.6, 0.3, { emissive: 0xff7a20, emissiveIntensity: 0.05 });
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.03, 6, 24), runeMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = 1.06;
      g.add(band);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        box(g, 0.05, 0.08, 0.01, runeMat, Math.cos(a) * 0.335, 0.98, Math.sin(a) * 0.335).rotation.y = -a + Math.PI / 2;
      }
      const fire = G();
      fire.position.y = 1.1;
      const fireMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a });
      for (let i = 0; i < 5; i++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.07 + (i % 2) * 0.04, 0.35 + (i % 3) * 0.12, 6), fireMat);
        f.position.set(Math.cos(i * 1.3) * 0.12 * (i ? 1 : 0), 0.15, Math.sin(i * 1.3) * 0.12 * (i ? 1 : 0));
        fire.add(f);
      }
      const halo = glow(fire, 0, 0.3, 0, 0xff8a30, 1.4, true);
      fire.visible = false;
      g.add(fire);
      g.userData.setState = (st) => { g.userData.done = !!st?.done; fire.visible = g.userData.done; };
      g.userData.fx = (t, ctx) => {
        if (g.userData.done) {
          fire.children.forEach((f, i) => { if (f.isMesh) f.scale.y = 1 + Math.sin(t * 13 + i * 1.9) * 0.25; });
          halo.material.opacity = 0.7 + Math.sin(t * 9) * 0.2;
          runeMat.emissiveIntensity = 1.2;
        } else {
          runeMat.emissiveIntensity = ctx.lumosNear ? 0.35 + Math.sin(t * 3) * 0.2 : 0.05; // Lumos picks out the runes
        }
      };
      return g;
    },
    rune_mirror(prop) {
      const g = G();
      const y = 1.75;
      const frame = G();
      frame.position.set(0, y, 0);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 8, 32), M.brass);
      rim.scale.y = 1.4;
      frame.add(rim);
      const glassMat = M.glass.clone();
      glassMat.emissive = new THREE.Color(0x40c8ff);
      glassMat.emissiveIntensity = 0;
      const glassM = new THREE.Mesh(new THREE.CircleGeometry(0.38, 32), glassMat);
      glassM.scale.y = 1.4;
      glassM.position.z = 0.01;
      frame.add(glassM);
      const runeMat = std(0x101018, 0.5, 0.5, { emissive: 0x60d0ff, emissiveIntensity: 0.05 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        box(frame, 0.05, 0.05, 0.02, runeMat, Math.cos(a) * 0.46, Math.sin(a) * 0.64, 0.03);
      }
      const arrow = box(frame, 0.04, 0.16, 0.02, runeMat, 0, 0.66, 0.04); // aligned when this points up
      g.add(frame);
      g.userData.target = (prop?.turns ?? 0) * 0.55;
      g.userData.setState = (st) => {
        g.userData.done = !!st?.done;
        const turns = st?.done ? 0 : (st?.turns ?? prop?.turns ?? 0);
        g.userData.target = turns * 0.55;
      };
      g.userData.fx = (t, ctx) => {
        frame.rotation.z += (g.userData.target - frame.rotation.z) * 0.08;
        glassMat.emissiveIntensity = g.userData.done ? 0.35 + Math.sin(t * 2) * 0.1 : 0;
        runeMat.emissiveIntensity = g.userData.done ? 1 : ctx.lumosNear ? 0.4 + Math.sin(t * 3) * 0.2 : 0.05;
        arrow.visible = true;
      };
      g.userData.setState({ turns: prop?.turns });
      return g;
    },
    pedestal() {
      const g = G();
      cyl(g, 0.24, 0.3, 0.1, M.stoneDark, 0, 0.05, 0, 10);
      cyl(g, 0.14, 0.18, 0.85, M.stone, 0, 0.5, 0, 10);
      box(g, 0.5, 0.08, 0.5, M.stoneDark, 0, 0.96, 0);
      const glowMat2 = std(0x1a1006, 0.4, 0.8, { emissive: 0xffb040, emissiveIntensity: 0 });
      const gears = [];
      for (const [x, r, n] of [[-0.08, 0.15, 10], [0.13, 0.09, 7]]) {
        const gear = G();
        gear.position.set(x, 1.12, 0);
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 20), glowMat2);
        gear.add(wheel);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          box(gear, 0.04, 0.04, 0.03, glowMat2, Math.cos(a) * (r + 0.03), Math.sin(a) * (r + 0.03), 0).rotation.z = a;
        }
        box(gear, r * 1.8, 0.02, 0.02, glowMat2);
        g.add(gear);
        gears.push({ gear, r });
      }
      const key = G();
      key.position.set(0, 1.12, 0.12);
      box(key, 0.03, 0.03, 0.12, M.brass, 0, 0, 0.04);
      box(key, 0.16, 0.05, 0.02, M.brass, 0, 0, 0.1);
      g.add(key);
      g.userData.setState = (st) => { g.userData.done = !!st?.done; };
      g.userData.fx = (t, ctx) => {
        if (g.userData.done) {
          gears.forEach(({ gear, r }, i) => { gear.rotation.z = t * (i ? -1.6 : 1) * (0.15 / r); });
          key.rotation.z = t * 2;
          glowMat2.emissiveIntensity = 0.6;
        } else {
          glowMat2.emissiveIntensity = ctx.lumosNear ? 0.25 + Math.sin(t * 3) * 0.15 : 0;
        }
      };
      return g;
    },
    chalice() {
      const g = G();
      cyl(g, 0.22, 0.26, 0.6, M.stoneDark, 0, 0.3, 0, 10);
      const gold = std(0xc8a040, 0.25, 0.9);
      const cup = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.11, 0.01], [0.03, 0.05], [0.025, 0.2], [0.05, 0.24], [0.13, 0.32], [0.14, 0.42]].map(([r, y2]) => new THREE.Vector2(r, y2)), 16), gold);
      cup.position.y = 0.6;
      g.add(cup);
      const inner = std(0x200204, 0.3, 0, { emissive: 0xff2030, emissiveIntensity: 0.05 });
      cyl(g, 0.12, 0.12, 0.01, inner, 0, 0.99, 0, 14);
      const coin = cyl(g, 0.05, 0.05, 0.012, gold, 0.02, 1.0, 0.01, 12);
      coin.rotation.x = 0.3;
      coin.visible = false;
      const halo = glow(g, 0, 1.08, 0, 0xff3040, 0.6, true);
      halo.visible = false;
      g.userData.setState = (st) => { g.userData.done = !!st?.done; coin.visible = halo.visible = g.userData.done; };
      g.userData.fx = (t, ctx) => {
        inner.emissiveIntensity = g.userData.done ? 0.8 + Math.sin(t * 4) * 0.2 : ctx.lumosNear ? 0.3 + Math.sin(t * 3) * 0.2 : 0.05;
        if (g.userData.done) halo.material.opacity = 0.5 + Math.sin(t * 4) * 0.2;
      };
      return g;
    },

    // ---- curios (may be a Heart) -------------------------------------------
    mirror(prop) {
      const g = G();
      const y = 1.7;
      box(g, 1.0, 1.6, 0.08, M.goldFrame, 0, y, 0);
      const glassMat = M.glass.clone();
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 1.42), glassMat);
      glass.position.set(0, y, 0.045);
      g.add(glass);
      g.userData.fx = (t, ctx) => {
        if (!ctx.isHeart) return;
        const pulse = heartbeat(t);
        glassMat.emissive.setRGB(0.35 * pulse, 0.01, 0.02);
        glassMat.color.setRGB(0.18 + 0.1 * pulse, 0.12, 0.13);
      };
      return g;
    },
    painting(prop) {
      const g = G();
      const y = 1.9;
      box(g, 1.2, 1.5, 0.08, M.goldFrame, 0, y, 0);
      const seed = prop.variant % 8;
      const mat = movingCanvas(new THREE.MeshStandardMaterial({ map: getPortrait(seed, false), roughness: 0.7 }), seed);
      const canvas = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.25), mat);
      canvas.position.set(0, y, 0.045);
      g.add(canvas);
      let swapped = false;
      g.userData.fx = (t, ctx) => {
        if (!ctx.isHeart) return;
        if (!swapped) {
          mat.map = getPortrait(seed, true);
          mat.emissive = new THREE.Color(0xff0000);
          mat.emissiveMap = mat.map;
          mat.needsUpdate = true;
          swapped = true;
        }
        mat.emissiveIntensity = 0.06 + heartbeat(t) * 0.18;
      };
      return g;
    },
    clock(prop) {
      const g = G();
      box(g, 0.7, 0.05, 0.45, M.woodDark, 0, 0.03, 0);
      box(g, 0.7, 2.1, 0.04, M.woodDark, 0, 1.05, -0.2);
      for (const sx of [-1, 1]) box(g, 0.05, 2.1, 0.45, M.woodDark, sx * 0.33, 1.05, 0);
      box(g, 0.7, 0.75, 0.05, M.woodDark, 0, 0.38, 0.2);
      box(g, 0.7, 0.15, 0.05, M.woodDark, 0, 2.0, 0.2);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.2), M.clearGlass);
      glass.position.set(0, 1.35, 0.215);
      g.add(glass);
      box(g, 0.78, 0.5, 0.5, M.woodDark, 0, 2.33, 0);
      box(g, 0.84, 0.08, 0.56, M.woodMid, 0, 2.62, 0);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), M.clockFace);
      face.position.set(0, 2.33, 0.255);
      g.add(face);
      const pendulum = G();
      pendulum.position.set(0, 1.95, 0.05);
      cyl(pendulum, 0.008, 0.008, 0.85, M.brass, 0, -0.42, 0, 4);
      const bobMat = M.brass.clone();
      const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 16), bobMat);
      bob.rotation.x = Math.PI / 2;
      bob.position.y = -0.85;
      pendulum.add(bob);
      g.add(pendulum);
      const phase = (prop.variant % 100) / 10;
      g.userData.fx = (t, ctx) => {
        if (ctx.isHeart) {
          const beat = heartbeat(t);
          pendulum.rotation.z = (beat - 0.4) * 0.5;
          bobMat.emissive.setRGB(beat * 0.7, 0, 0);
        } else {
          pendulum.rotation.z = Math.sin(t * Math.PI + phase) * 0.18;
        }
      };
      return g;
    },
    doll(prop) {
      const g = G();
      const top = sideTable(g);
      const dressMat = std([0x6a5a6a, 0x3a1a20, 0x8a8070][prop.variant % 3], 0.95);
      const dress = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 10), dressMat);
      dress.position.set(0, top + 0.13, 0);
      g.add(dress);
      const head = G();
      head.position.set(0, top + 0.34, 0);
      sph(head, 0.085, M.porcelain);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), M.black);
      hair.rotation.x = -0.3;
      head.add(hair);
      const eyeMat = std(0x050505, 0.3);
      for (const sx of [-1, 1]) sph(head, 0.014, eyeMat, sx * 0.03, 0.01, 0.075, 6);
      const tears = [];
      for (const sx of [-1, 1]) {
        const tear = box(head, 0.006, 0.07, 0.004, std(0x400000, 0.2, 0, { emissive: 0x500000 }), sx * 0.03, -0.035, 0.08);
        tear.visible = false;
        tears.push(tear);
      }
      g.add(head);
      for (const sx of [-1, 1]) {
        const arm = cyl(g, 0.018, 0.018, 0.16, M.porcelain, sx * 0.1, top + 0.18, 0.02, 6);
        arm.rotation.z = sx * 0.4;
      }
      const tmp = new THREE.Vector3();
      g.userData.fx = (t, ctx) => {
        if (!ctx.isHeart) return;
        for (const tear of tears) tear.visible = true;
        eyeMat.emissive.setRGB(0.6 * heartbeat(t), 0, 0);
        // The head turns to follow you.
        const local = g.worldToLocal(ctx.camera.getWorldPosition(tmp));
        const yaw = Math.atan2(local.x, local.z);
        head.rotation.y += (Math.max(-1.4, Math.min(1.4, yaw)) - head.rotation.y) * 0.03;
      };
      return g;
    },
    musicbox(prop) {
      const g = G();
      const top = sideTable(g);
      box(g, 0.3, 0.14, 0.22, M.woodRed, 0, top + 0.07, 0);
      const lid = G();
      lid.position.set(0, top + 0.14, -0.11);
      box(lid, 0.3, 0.02, 0.22, M.woodRed, 0, 0, 0.11);
      lid.rotation.x = -1.1;
      g.add(lid);
      const glowMat = std(0x200000, 0.6, 0, { emissive: 0xff2020, emissiveIntensity: 0 });
      box(g, 0.26, 0.005, 0.18, glowMat, 0, top + 0.141, 0);
      const dancer = G();
      dancer.position.set(0, top + 0.145, 0);
      const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.05, 8), M.porcelain);
      skirt.position.y = 0.04;
      dancer.add(skirt);
      sph(dancer, 0.012, M.porcelain, 0, 0.09, 0, 6);
      cyl(dancer, 0.004, 0.004, 0.03, M.porcelain, 0, 0.012, 0, 4);
      g.add(dancer);
      g.userData.fx = (t, ctx) => {
        if (!ctx.isHeart) return;
        dancer.rotation.y = t * 1.6;
        glowMat.emissiveIntensity = 0.3 + heartbeat(t) * 0.9;
      };
      return g;
    },
    candelabra(prop) {
      const g = G();
      const top = sideTable(g);
      cyl(g, 0.07, 0.09, 0.03, M.brass, 0, top + 0.015, 0, 10);
      cyl(g, 0.015, 0.02, 0.3, M.brass, 0, top + 0.17, 0, 6);
      box(g, 0.36, 0.015, 0.015, M.brass, 0, top + 0.3, 0);
      const flameMat = new THREE.MeshBasicMaterial({ color: 0x1a0018 });
      const flames = [];
      for (let i = -2; i <= 2; i++) {
        const y = top + 0.3 + (i === 0 ? 0.08 : 0);
        candle(g, i * 0.085, y, 0, false, 0.12);
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.09, 6), flameMat);
        f.position.set(i * 0.085, y + 0.17, 0);
        f.visible = false;
        g.add(f);
        flames.push(f);
      }
      g.userData.fx = (t, ctx) => {
        if (!ctx.isHeart) return;
        flames.forEach((f, i) => {
          f.visible = true;
          f.scale.y = 0.8 + Math.sin(t * 13 + i * 1.7) * 0.25 + heartbeat(t) * 0.3;
        });
        flameMat.color.setRGB(0.12 + heartbeat(t) * 0.25, 0, 0.1);
      };
      return g;
    },
  };

  builders.skull = (prop) => {
    // The Grinning Skull: a yellowed skull on a velvet stand. As a Heart its jaw chews.
    const g = G();
    const top = sideTable(g);
    box(g, 0.24, 0.05, 0.24, M.velvet, 0, top + 0.025, 0);
    const head = G();
    head.position.set(0, top + 0.17, 0);
    const cranium = sph(head, 0.11, M.bone, 0, 0.02, 0, 14);
    cranium.scale.set(0.9, 1, 1.1);
    const eyeMat = std(0x030202, 0.5, 0, { emissive: 0xff2010, emissiveIntensity: 0 });
    for (const sx of [-1, 1]) sph(head, 0.026, eyeMat, sx * 0.04, 0.01, 0.085, 8);
    box(head, 0.02, 0.03, 0.01, M.black, 0, -0.025, 0.1);
    const jaw = G();
    jaw.position.set(0, -0.05, 0.02);
    const mandible = box(jaw, 0.13, 0.04, 0.1, M.bone, 0, -0.02, 0.03);
    mandible.scale.x = 0.9;
    for (let i = -2; i <= 2; i++) box(jaw, 0.012, 0.018, 0.01, M.porcelain, i * 0.022, 0.005, 0.08);
    for (let i = -2; i <= 2; i++) box(head, 0.012, 0.018, 0.01, M.porcelain, i * 0.022, -0.045, 0.098);
    head.add(jaw);
    g.add(head);
    g.userData.fx = (t, ctx) => {
      if (!ctx.isHeart) return;
      jaw.rotation.x = Math.max(0, Math.sin(t * 9)) * 0.35; // chewing on nothing
      eyeMat.emissiveIntensity = 0.3 + heartbeat(t) * 0.9;
    };
    return g;
  };

  function build(prop) {
    const make = builders[prop.kind];
    if (!make) throw new Error(`No model for prop kind "${prop.kind}"`);
    const obj = make(prop);
    obj.traverse((o) => {
      if (o.isMesh) {
        const mat = o.material;
        const decal = mat === M.ritual || mat === M.rug || mat?.isMeshBasicMaterial;
        o.castShadow = !decal && !mat?.transparent;
        o.receiveShadow = !mat?.isMeshBasicMaterial;
      }
    });
    return obj;
  }

  return { build, materials: M, uniforms, glow, coneMaterial };
}

/** 0..1 "lub-dub" pulse at ~66 bpm. */
export function heartbeat(t) {
  const p = (t * 1.1) % 1;
  const lub = Math.exp(-((p - 0.05) ** 2) / 0.0012);
  const dub = 0.6 * Math.exp(-((p - 0.24) ** 2) / 0.0015);
  return Math.min(1, lub + dub);
}
