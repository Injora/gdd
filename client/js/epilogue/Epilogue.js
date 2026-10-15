// Phase IV: "The Mansion Reclaimed & Families in Peace".
//
//   whiteout → Scene 1a: the Grand Foyer (the real mansion) relit by morning
//   sun: light shafts, dust motes, ivy, flowers → Scene 1b: the estate gardens
//   in sunlight (manor facade, fountain, trees, flower beds, birds) →
//   Scene 2: each coven wizard's family, safe and happy, with the wizard's
//   spirit watching over them and their personal epilogue → the final card.
//
// Everything is procedural; music is a major-key harp/pad synth with birdsong.

import * as THREE from 'three';
import { FLOOR_Y, TILE, TILE_WALL } from '/shared/constants.js';
import { WIZARD_BY_ID } from '/shared/wizards.js';

const $ = (id) => document.getElementById(id);
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const rand = (a, b) => a + Math.random() * (b - a);

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  return t;
}

const grassTex = () => canvasTex(256, 256, (ctx) => {
  ctx.fillStyle = '#4f8a3a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `hsl(${rand(85, 115)}, ${rand(35, 55)}%, ${rand(25, 45)}%)`;
    ctx.fillRect(rand(0, 256), rand(0, 256), 1.5, rand(3, 7));
  }
}, 40);

const stoneTex = () => canvasTex(256, 256, (ctx) => {
  ctx.fillStyle = '#b8a888';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) {
    for (let x = (y / 32) % 2 ? -32 : 0; x < 256; x += 64) {
      ctx.fillStyle = `hsl(38, 20%, ${rand(58, 72)}%)`;
      ctx.fillRect(x + 2, y + 2, 60, 28);
    }
  }
}, 4);

const shaftTex = () => canvasTex(64, 256, (ctx) => {
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,230,170,0)');
  g.addColorStop(0.5, 'rgba(255,236,190,0.9)');
  g.addColorStop(1, 'rgba(255,230,170,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  const v = ctx.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.2, 'rgba(0,0,0,1)');
  v.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 64, 256);
});

export class Epilogue {
  /**
   * @param ctx { renderer, gameScene, camera, map, mansion, coven, isHost, audio, onPlayAgain, onReturn, hideHorror() }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.renderer = ctx.renderer;
    ctx.camera.far = 600; // the sky dome and the long view down the estate
    ctx.camera.updateProjectionMatrix();
    this.camera = ctx.camera;
    this.t = 0;
    this.scenes = [];
    this.stage = 'white';
    this.coven = ctx.coven.map((m) => ({ ...m, wizard: WIZARD_BY_ID[m.wizardId] })).filter((m) => m.wizard);
    this.familySpots = [];
    this.timeline = this.buildTimeline();
    ctx.audio?.epilogueMusic?.();
    this.setupDom();
    this.buildFoyer();
    this.buildGarden();
  }

  buildTimeline() {
    const tl = [];
    let t = 0;
    const add = (name, dur) => { tl.push({ name, start: t, end: t + dur }); t += dur; };
    add('white', 1.6);
    add('foyer', 8.5);
    add('garden', 8.5);
    this.coven.forEach((_, i) => add(`family${i}`, 5));
    add('final', Infinity);
    return tl;
  }

  setupDom() {
    $('epilogue').classList.remove('hidden');
    $('ep-final').classList.add('hidden');
    $('ep-card').classList.remove('show');
    $('ep-fade').style.opacity = '1';
    $('btn-again').disabled = !this.ctx.isHost;
    $('btn-ep-lobby').disabled = !this.ctx.isHost;
    $('ep-wait').textContent = this.ctx.isHost ? '' : 'The host will choose what comes next…';
    $('btn-again').onclick = () => this.ctx.onPlayAgain();
    $('btn-ep-lobby').onclick = () => this.ctx.onReturn();
  }

  // ---- Scene 1a: the Grand Foyer, restored --------------------------------------------

  buildFoyer() {
    const { map } = this.ctx;
    const scene = this.ctx.gameScene;
    this.ctx.hideHorror();
    const room = map.rooms[map.ids.foyer];
    const y0 = FLOOR_Y[room.floor];
    const x0 = room.x * TILE, x1 = (room.x + room.w) * TILE, z0 = room.y * TILE, z1 = (room.y + room.h) * TILE;
    this.foyer = { room, x0, x1, z0, z1, y0 };
    const g = new THREE.Group();
    // Light shafts through high windows
    const mat = new THREE.MeshBasicMaterial({ map: shaftTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) {
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 5.2), mat);
      shaft.position.set(rand(x0 + 1, x1 - 1), y0 + 2.2, rand(z0 + 1, z1 - 1));
      shaft.rotation.set(0, rand(0, Math.PI), 0.45);
      g.add(shaft);
    }
    // Morning sun pouring in, and the room's own warmth
    const sun = new THREE.DirectionalLight(0xffe2b0, 2.4);
    sun.position.set((x0 + x1) / 2 - 6, y0 + 9, (z0 + z1) / 2 + 4);
    sun.target.position.set((x0 + x1) / 2, y0, (z0 + z1) / 2);
    g.add(sun, sun.target);
    for (let i = 0; i < 3; i++) {
      const warm = new THREE.PointLight(0xffd29a, 26, 16, 1.4);
      warm.position.set(x0 + ((i + 0.5) / 3) * (x1 - x0), y0 + 3.2, (z0 + z1) / 2);
      g.add(warm);
    }
    // Ivy climbing the real walls: faces of floor tiles that border a wall tile
    const floor = map.floors[room.floor];
    const faces = [];
    for (let ty = room.y; ty < room.y + room.h; ty++) {
      for (let tx = room.x; tx < room.x + room.w; tx++) {
        if (floor.tiles[ty * floor.w + tx] === TILE_WALL) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = tx + dx, ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= floor.w || ny >= floor.h || floor.tiles[ny * floor.w + nx] !== TILE_WALL) continue;
          faces.push({ x: (tx + 0.5 + dx * 0.49) * TILE, z: (ty + 0.5 + dy * 0.49) * TILE, dx, dy });
        }
      }
    }
    // Vines: strands that climb from the floor and wander up the wall, leaves along each.
    const STRANDS = faces.length ? Math.min(90, faces.length * 2) : 0;
    const PER = 26;
    const leaf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, 0.1), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.85 }), Math.max(1, STRANDS * PER));
    leaf.count = STRANDS * PER;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const tint = new THREE.Color();
    let n = 0;
    for (let sIdx = 0; sIdx < STRANDS; sIdx++) {
      const f = faces[Math.floor(Math.random() * faces.length)];
      const u0 = rand(-0.45, 0.45) * TILE, top = rand(1.2, 3.6), phase = rand(0, 6), sway = rand(0.15, 0.35);
      for (let k = 0; k < PER; k++) {
        const v = k / (PER - 1);
        const h = v * top;
        const u = u0 + Math.sin(phase + v * 5) * sway + rand(-0.06, 0.06);
        const px = f.x + (f.dy ? u : 0) - f.dx * 0.03, pz = f.z + (f.dx ? u : 0) - f.dy * 0.03;
        m4.compose(new THREE.Vector3(px, y0 + 0.05 + h, pz), q.setFromEuler(e.set(0, f.dx ? Math.PI / 2 : 0, rand(-0.9, 0.9))),
          new THREE.Vector3(1, 1, 1).multiplyScalar(rand(0.8, 1.3) * (1.15 - v * 0.45)));
        leaf.setMatrixAt(n, m4);
        leaf.setColorAt(n++, tint.setHSL(rand(0.24, 0.32), 0.5, rand(0.14, 0.26)));
      }
    }
    g.add(leaf);
    // Flowers in the corners
    this.addFlowers(g, 180, () => {
      const cx = Math.random() < 0.5 ? x0 + rand(0.4, 1.6) : x1 - rand(0.4, 1.6);
      const cz = Math.random() < 0.5 ? z0 + rand(0.4, 1.6) : z1 - rand(0.4, 1.6);
      return [cx, y0, cz];
    });
    // Dust motes
    this.motes = this.makeMotes(500, x0, x1, z0, z1, y0 + 0.3, y0 + 3.8);
    g.add(this.motes);
    scene.add(g);
    this.foyerGroup = g;
  }

  addFlowers(group, n, at) {
    const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.01, 0.012, 0.35, 4).translate(0, 0.175, 0), new THREE.MeshStandardMaterial({ color: 0x3a7a28 }), n);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.6 }), n);
    const palette = [0xff7aa8, 0xffd84a, 0xf4f4ff, 0xc77dff, 0xff9a3a, 0x8ad4ff];
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const [x, y, z] = at(i);
      const s = rand(0.7, 1.3);
      m4.makeScale(1, s, 1).setPosition(x, y, z);
      stems.setMatrixAt(i, m4);
      m4.makeScale(s, s, s).setPosition(x, y + 0.35 * s, z);
      heads.setMatrixAt(i, m4);
      heads.setColorAt(i, col.set(palette[i % palette.length]));
    }
    group.add(stems, heads);
  }

  makeMotes(n, x0, x1, z0, z1, ya, yb) {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([rand(x0, x1), rand(ya, yb), rand(z0, z1)], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const cx = c.getContext('2d');
    const gr = cx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,240,200,1)');
    gr.addColorStop(1, 'rgba(255,240,200,0)');
    cx.fillStyle = gr;
    cx.fillRect(0, 0, 32, 32);
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.06, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0c8 }));
    pts.userData = { n, x0, x1, z0, z1, ya, yb };
    return pts;
  }

  driftMotes(pts, dt, t) {
    const a = pts.geometry.attributes.position.array;
    const { n, ya, yb } = pts.userData;
    for (let i = 0; i < n; i++) {
      a[i * 3] += Math.sin(t * 0.3 + i) * 0.002;
      a[i * 3 + 1] += dt * 0.05 * (0.5 + (i % 5) * 0.2);
      if (a[i * 3 + 1] > yb) a[i * 3 + 1] = ya;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  }

  // ---- Scene 1b + 2: the estate in the sun ------------------------------------------------

  buildGarden() {
    const scene = new THREE.Scene();
    this.garden = scene;
    scene.fog = new THREE.Fog(0xf3dcb2, 40, 140);
    scene.background = new THREE.Color(0xa8c8ec);
    // Sky dome
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 top = vec3(0.42,0.64,0.92); vec3 hor = vec3(1.0,0.86,0.66); gl_FragColor = vec4(mix(hor, top, smoothstep(-0.05, 0.5, h)), 1.0); }',
    })));
    const sun = new THREE.DirectionalLight(0xfff0d0, 3.2);
    sun.position.set(-40, 50, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 160 });
    scene.add(sun, new THREE.HemisphereLight(0xcfe4ff, 0x6a5a30, 1.2));
    const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xfff6e0, fog: false }));
    sunDisc.position.set(-80, 100, 60);
    sunDisc.scale.setScalar(18);
    scene.add(sunDisc);

    // Lawn + path
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 1 }));
    ground.receiveShadow = true;
    scene.add(ground);
    const stone = stoneTex();
    const path = new THREE.Mesh(new THREE.PlaneGeometry(4, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: stone, roughness: 0.9 }));
    path.position.set(0, 0.02, 10);
    path.receiveShadow = true;
    scene.add(path);

    // The manor
    const wall = new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3440, roughness: 0.8 });
    const manor = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 12), wall);
    body.position.y = 6;
    manor.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(18, 6, 4).rotateY(Math.PI / 4), roofMat);
    roof.scale.set(1.2, 1, 0.5);
    roof.position.y = 15;
    manor.add(roof);
    for (const sx of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 16, 16), wall);
      tower.position.set(sx * 16, 8, 0);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(3.6, 6, 16), roofMat);
      cap.position.set(sx * 16, 19, 0);
      manor.add(tower, cap);
    }
    const winMat = new THREE.MeshStandardMaterial({ color: 0xffe6a8, emissive: 0xffc860, emissiveIntensity: 0.8 });
    for (let row = 0; row < 2; row++) {
      for (let i = -3; i <= 3; i++) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4), winMat);
        w.position.set(i * 3.8, 3.5 + row * 4.5, 6.02);
        manor.add(w);
      }
    }
    const door = new THREE.Mesh(new THREE.PlaneGeometry(3, 4.5), new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffd080, emissiveIntensity: 1 }));
    door.position.set(0, 2.25, 6.03);
    manor.add(door);
    manor.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // Ivy on the facade
    const ivy = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.45, 0.35), new THREE.MeshStandardMaterial({ color: 0x3f8a32, side: THREE.DoubleSide }), 1400);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 1400; i++) {
      const x = rand(-15, 15), y = Math.random() ** 1.8 * 11;
      if (Math.abs(x) < 2 && y < 5) continue;
      m4.compose(new THREE.Vector3(x, y + 0.2, 6.06), q.setFromEuler(e.set(0, 0, rand(0, 6))), new THREE.Vector3(1, 1, 1).multiplyScalar(rand(0.6, 1.3)));
      ivy.setMatrixAt(i, m4);
    }
    manor.add(ivy);
    manor.position.set(0, 0, -26);
    scene.add(manor);

    // Fountain
    const fountain = new THREE.Group();
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 0.8, 32), wall);
    basin.position.y = 0.4;
    const water = new THREE.Mesh(new THREE.CircleGeometry(3, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6ac0e8, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85 }));
    water.position.y = 0.75;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 2.4, 12), wall);
    column.position.y = 1.4;
    fountain.add(basin, water, column);
    fountain.position.set(0, 0, 2);
    fountain.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(fountain);
    this.fountainSpray = this.makeMotes(220, -0.4, 0.4, 1.6, 2.4, 2.6, 3.4);
    this.fountainSpray.material.color.set(0xcff0ff);
    this.fountainSpray.material.size = 0.09;
    scene.add(this.fountainSpray);

    // Trees + hedges
    const bark = new THREE.MeshStandardMaterial({ color: 0x5a4028 });
    const leaves = [0x3f7a2a, 0x4f8e34, 0x6a9a3a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
    for (let i = 0; i < 22; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * rand(12, 40), z = rand(-20, 40);
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 4, 8), bark);
      trunk.position.y = 2;
      tree.add(trunk);
      for (let k = 0; k < 3; k++) {
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(1.8, 2.8), 1), leaves[k % 3]);
        crown.position.set(rand(-1, 1), 4.5 + k * 1.1, rand(-1, 1));
        tree.add(crown);
      }
      tree.position.set(x, 0, z);
      tree.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      scene.add(tree);
    }
    // Flower beds along the path
    const beds = new THREE.Group();
    this.addFlowers(beds, 1400, () => {
      const side = Math.random() < 0.5 ? -1 : 1;
      return [side * rand(2.4, 6), 0, rand(-18, 38)];
    });
    scene.add(beds);
    this.gardenMotes = this.makeMotes(700, -25, 25, -20, 40, 0.5, 9);
    scene.add(this.gardenMotes);

    // Birds
    this.birds = [];
    for (let i = 0; i < 9; i++) {
      const bird = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0x3a3030, side: THREE.DoubleSide });
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.18).translate(s * 0.35, 0, 0), mat);
        bird.add(wing);
      }
      bird.userData = { r: rand(20, 45), h: rand(14, 24), speed: rand(0.08, 0.16), phase: rand(0, 6) };
      scene.add(bird);
      this.birds.push(bird);
    }

    // The families
    this.coven.forEach((member, i) => {
      const ang = -0.9 + (i / Math.max(1, this.coven.length - 1)) * 1.8;
      const spot = new THREE.Vector3(Math.sin(ang) * 13, 0, 14 + Math.cos(ang) * 6);
      scene.add(this.makeFamily(member, spot, i));
      this.familySpots.push(spot);
    });
  }

  /** A family picnicking on the lawn, the wizard's spirit watching over them. */
  makeFamily(member, spot, index) {
    const g = new THREE.Group();
    g.position.copy(spot);
    const w = member.wizard;
    const accent = new THREE.Color(w.color);
    const blanket = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
      map: canvasTex(64, 64, (ctx) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#f4ecd8' : w.color;
          ctx.fillRect(x * 8, y * 8, 8, 8);
        }
      }),
    }));
    blanket.position.y = 0.03;
    blanket.receiveShadow = true;
    g.add(blanket);
    const skin = [0xe8c4a0, 0xc69070, 0x8a5a3c, 0xf0d0b0][index % 4];
    const person = (h, cloth, x, z, child) => {
      const p = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(child ? 0.16 : 0.24, h * 0.45, 4, 10), new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.8 }));
      body.position.y = h * 0.42;
      const head = new THREE.Mesh(new THREE.SphereGeometry(child ? 0.16 : 0.2, 14, 10), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }));
      head.position.y = h * 0.85;
      const hair = new THREE.Mesh(new THREE.SphereGeometry(child ? 0.17 : 0.21, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: [0x2a1a10, 0x6a4a20, 0x1a1210][index % 3] }));
      hair.position.y = h * 0.86;
      p.add(body, head, hair);
      p.position.set(x, 0, z);
      p.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      p.userData = { child, phase: Math.random() * 6, baseX: x, baseZ: z };
      g.add(p);
      return p;
    };
    this.people ??= [];
    this.people.push(
      person(1.75, accent.clone().lerp(new THREE.Color(0xf4ecd8), 0.4).getHex(), -0.7, -0.4, false),
      person(1.65, 0xf2e8d0, 0.6, -0.5, false),
      person(1.05, accent.clone().lerp(new THREE.Color(0xffffff), 0.5).getHex(), -1.8, 1.4, true),
      person(0.95, 0xffd2a8, 1.9, 1.2, true),
    );
    // A basket and a lantern in the wizard's colour
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.25, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0x9a6a3a }));
    basket.position.set(0, 0.15, 0.6);
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshBasicMaterial({ color: w.color }));
    lantern.position.set(1.4, 1.6, -0.9);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0x3a2a1a }));
    pole.position.set(1.4, 0.8, -0.9);
    g.add(basket, lantern, pole);
    // The wizard's spirit, translucent and at peace, watching over them.
    const spirit = new THREE.Group();
    const glowMat = new THREE.MeshBasicMaterial({ color: w.color, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.8, 16, 1, true), glowMat);
    robe.position.y = 0.9;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), glowMat);
    head.position.y = 1.95;
    spirit.add(robe, head);
    spirit.position.set(0, 0.4, -2.2);
    spirit.userData.spirit = true;
    g.add(spirit);
    g.userData.spirit = spirit;
    return g;
  }

  // ---- per frame ------------------------------------------------------------------

  current() {
    return this.timeline.find((s) => this.t >= s.start && this.t < s.end) ?? this.timeline.at(-1);
  }

  update(dt) {
    this.t += dt;
    const seg = this.current();
    const k = seg.end === Infinity ? 0 : (this.t - seg.start) / (seg.end - seg.start);
    const fade = $('ep-fade');
    const cam = this.camera;

    if (seg.name !== this.stage) this.enter(seg.name);

    if (seg.name === 'white') {
      fade.style.background = '#fffaf0';
      fade.style.opacity = '1';
      this.renderFoyerFrame(0);
      return;
    }
    if (seg.name === 'foyer') {
      fade.style.opacity = String(Math.max(0, 1 - k * 4, (k - 0.88) / 0.12));
      this.renderFoyerFrame(k);
      this.driftMotes(this.motes, dt, this.t);
      this.renderer.render(this.ctx.gameScene, cam);
      return;
    }
    // Garden / families / final
    if (seg.name === 'garden') {
      fade.style.opacity = String(Math.max(0, 1 - k * 4));
      const p = ease(k);
      cam.position.set(Math.sin(k * 0.6) * 2, 2.2 + p * 1.5, 40 - p * 22);
      cam.lookAt(0, 4 - p * 1.5, -10);
    } else if (seg.name.startsWith('family')) {
      const i = Number(seg.name.slice(6));
      const spot = this.familySpots[i];
      const a = -0.6 + k * 0.9;
      cam.position.set(spot.x + Math.sin(a) * 5, 2.3, spot.z + Math.cos(a) * 5);
      cam.lookAt(spot.x, 0.9, spot.z);
      fade.style.opacity = String(Math.max(0, 1 - k * 6));
    } else if (seg.name === 'final') {
      const kk = Math.min(1, (this.t - seg.start) / 8);
      const p = ease(kk);
      cam.position.set(Math.sin(this.t * 0.05) * 30, 8 + p * 22, 50 + p * 10);
      cam.lookAt(0, 4, -10);
      fade.style.opacity = '0';
    }
    this.animateGarden(dt);
    this.renderer.render(this.garden, cam);
  }

  renderFoyerFrame(k) {
    const f = this.foyer;
    const cam = this.camera;
    const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
    const r = Math.min(f.x1 - f.x0, f.z1 - f.z0) * 0.32;
    const a = -0.8 + ease(k) * 1.8;
    cam.position.set(cx + Math.sin(a) * r, f.y0 + 1.7 + k * 0.6, cz + Math.cos(a) * r);
    cam.lookAt(cx - Math.sin(a) * r * 0.5, f.y0 + 1.9, cz - Math.cos(a) * r * 0.5);
  }

  animateGarden(dt) {
    const t = this.t;
    for (const b of this.birds) {
      const u = b.userData;
      const a = u.phase + t * u.speed;
      b.position.set(Math.cos(a) * u.r, u.h + Math.sin(t + u.phase) * 0.8, Math.sin(a) * u.r - 5);
      b.rotation.y = -a;
      const flap = Math.sin(t * 9 + u.phase) * 0.7;
      b.children[0].rotation.z = flap;
      b.children[1].rotation.z = -flap;
    }
    for (const p of this.people ?? []) {
      const u = p.userData;
      if (u.child) {
        p.position.y = Math.abs(Math.sin(t * 3 + u.phase)) * 0.25; // children play
        p.position.x = u.baseX + Math.sin(t * 0.8 + u.phase) * 0.6;
      } else {
        p.rotation.z = Math.sin(t * 1.2 + u.phase) * 0.04;
      }
    }
    this.garden.traverse((o) => {
      if (o.userData?.spirit === true) {
        o.position.y = 0.4 + Math.sin(t * 1.3) * 0.12;
        o.traverse((c) => { if (c.material?.transparent) c.material.opacity = 0.28 + Math.sin(t * 2) * 0.06; });
      }
    });
    this.driftMotes(this.gardenMotes, dt, t);
    this.driftMotes(this.fountainSpray, dt * 6, t);
  }

  enter(name) {
    this.stage = name;
    const card = $('ep-card');
    card.classList.remove('show');
    if (name === 'foyer') this.showCard('The Mansion Reclaimed', 'Morning', 'Sunlight finds the Grand Foyer for the first time in a hundred years. The whispering has stopped.');
    if (name === 'garden') this.showCard('The Estate', 'Spring', 'Ivy climbs the old stone. The fountain runs clear. Nothing watches from the windows any more.');
    if (name.startsWith('family')) {
      const m = this.coven[Number(name.slice(6))];
      this.showCard(m.wizard.name, m.wizard.title, `${m.wizard.epilogue} ${m.name === m.wizard.name ? '' : `— for ${m.name}, who gave their soul to the Convergence.`}`);
    }
    if (name === 'final') {
      $('ep-final').classList.remove('hidden');
    }
  }

  showCard(title, sub, text) {
    const card = $('ep-card');
    card.querySelector('h2').textContent = title;
    card.querySelector('h3').textContent = sub;
    card.querySelector('p').textContent = text;
    void card.offsetWidth;
    card.classList.add('show');
  }

  dispose() {
    $('epilogue').classList.add('hidden');
    this.ctx.audio?.stopEpilogueMusic?.();
    this.ctx.gameScene.remove(this.foyerGroup);
    this.garden.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose(); m.dispose(); });
    });
  }
}
