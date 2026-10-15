// Procedural models for every prop kind in shared/propdefs.js. Models face +Z
// (out into the room) with their origin on the floor at the prop's position.
//
// Heart-capable props ("curios") get a userData.fx(t, ctx) animator. It only
// shows the heart's tell once the Tome has revealed which props are hearts.

import * as THREE from 'three';
import { WALL_HEIGHT } from '/shared/constants.js';
import { portrait } from './textures.js';

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

  const portraits = new Map();
  const getPortrait = (seed, bleeding) => {
    const key = `${seed}:${bleeding}`;
    if (!portraits.has(key)) portraits.set(key, portrait(seed, bleeding));
    return portraits.get(key);
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
    sconce() {
      const g = G();
      box(g, 0.1, 0.25, 0.04, M.brass, 0, 2.2, -0.06);
      box(g, 0.04, 0.04, 0.18, M.brass, 0, 2.18, 0.03);
      candle(g, 0, 2.2, 0.1, false, 0.12);
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
    chandelier() {
      const g = G();
      cyl(g, 0.01, 0.01, 0.9, M.iron, 0, WALL_HEIGHT - 0.45, 0, 4);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.025, 6, 24), M.brass);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = WALL_HEIGHT - 0.9;
      g.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        candle(g, Math.cos(a) * 0.55, WALL_HEIGHT - 0.88, Math.sin(a) * 0.55, false, 0.12);
      }
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
      const mat = new THREE.MeshStandardMaterial({ map: getPortrait(seed, false), roughness: 0.7 });
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

  return { build, materials: M };
}

/** 0..1 "lub-dub" pulse at ~66 bpm. */
export function heartbeat(t) {
  const p = (t * 1.1) % 1;
  const lub = Math.exp(-((p - 0.05) ** 2) / 0.0012);
  const dub = 0.6 * Math.exp(-((p - 0.24) ** 2) / 0.0015);
  return Math.min(1, lub + dub);
}
