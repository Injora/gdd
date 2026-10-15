// Turns the generated map JSON into a Three.js scene: instanced walls,
// floors and ceilings per floor (PBR materials chosen by room), Gothic stone
// arches over doorways, the Balcony Gallery's balustrade and open void over
// the Foyer, spiral stairwells through the ceilings, the iron cage, every prop,
// and the few static candle lights. Also owns prop-level effects (heart tells,
// task states, heart destruction, the blood-rune barriers of a Sin's arena).

import * as THREE from 'three';
import { TILE, WALL_HEIGHT, TILE_WALL, TILE_DOOR, TILE_VOID, FLOOR, FLOOR_Y } from '/shared/constants.js';
import { createTextures } from './textures.js';
import { createPropKit } from './props.js';

const MAX_STATIC_LIGHTS = 3;
const LUMOS_REVEAL = 9; // Lumos picks out task runes this close

/** Floor finish by room type (default: oak parquet; corridors: velvet runner). */
const FLOOR_KIND = {
  foyer: 'marble', gallery: 'marble', ballroom: 'marble', observatory: 'marble', marble_bath: 'marble', banquet: 'marble',
  altar: 'flag', armory: 'flag', kitchen: 'flag', washroom: 'flag', pantry: 'flag', stairwell: 'flag', conservatory: 'flag',
  alchemy: 'flag', gun_room: 'flag', cloakroom: 'parquet',
};
/** Wall finish by the room it faces. */
const WALL_KIND = { altar: 'chapel', rose_bedroom: 'rose', conservatory: 'green', alchemy: 'green', armory: 'chapel', stairwell: 'chapel' };

function instanced(geometry, material, positions, { cast = true, receive = true, rotY } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, positions.length));
  const m = new THREE.Matrix4();
  const r = new THREE.Matrix4();
  positions.forEach(([x, y, z, rot], i) => {
    m.makeTranslation(x, y, z);
    if (rot ?? rotY) m.multiply(r.makeRotationY(rot ?? rotY));
    mesh.setMatrixAt(i, m);
  });
  mesh.count = positions.length;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** A Gothic pointed arch filling one wall-height doorway (opening along local z). */
function archGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-TILE / 2, 0); s.lineTo(TILE / 2, 0); s.lineTo(TILE / 2, WALL_HEIGHT); s.lineTo(-TILE / 2, WALL_HEIGHT); s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.8, 0); hole.lineTo(0.8, 0); hole.lineTo(0.8, 2.55);
  hole.quadraticCurveTo(0.8, 3.15, 0, 3.45); hole.quadraticCurveTo(-0.8, 3.15, -0.8, 2.55);
  hole.closePath();
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
  g.translate(0, 0, -0.21);
  return g;
}

/** Glowing blood-rune texture for a Sin's barriers. */
function runeTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = 'rgba(255,40,30,0.95)';
  ctx.font = '34px Georgia, serif';
  ctx.textAlign = 'center';
  const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
  for (let i = 0; i < 18; i++) ctx.fillText(runes[i % runes.length], 20 + (i % 3) * 44, 30 + Math.floor(i / 3) * 42);
  ctx.strokeStyle = 'rgba(255,30,20,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, 116, 244);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildMansion(map) {
  const tex = createTextures(map.seed);
  const kit = createPropKit(tex);
  const root = new THREE.Group();
  root.name = 'mansion';

  const pbr = (t, extra = {}) => new THREE.MeshStandardMaterial({
    map: t.map, normalMap: t.normalMap ?? null, roughnessMap: t.roughnessMap ?? null, roughness: 1, ...extra,
  });
  const mats = {
    floor: {
      marble: pbr(tex.marble, { roughness: 0.55, normalScale: new THREE.Vector2(0.5, 0.5) }),
      parquet: pbr(tex.parquet, { roughness: 0.9 }),
      flag: pbr(tex.flagstones),
      velvet: pbr(tex.velvet, { normalScale: new THREE.Vector2(0.4, 0.4) }),
    },
    wall: {
      wall: pbr(tex.wall),
      rose: pbr(tex.roseWall),
      green: pbr(tex.greenWall),
      chapel: pbr(tex.chapelStone),
      stone: pbr(tex.stone),
    },
    ceiling: pbr(tex.coffered),
    ceilingStone: pbr(tex.flagstones),
    arch: pbr(tex.stone, { color: 0xb8b0a4 }),
    rail: kit.materials.woodDark,
    brass: kit.materials.brass,
    iron: kit.materials.iron,
    frame: kit.materials.woodDark,
  };
  // Stone and the arches repeat at a sensible scale.
  const archTex = mats.arch.map.clone();
  archTex.repeat.set(0.5, 0.25);
  archTex.needsUpdate = true;
  mats.arch.map = archTex;

  const wallGeo = new THREE.BoxGeometry(TILE, WALL_HEIGHT, TILE).translate(0, WALL_HEIGHT / 2, 0);
  const floorGeo = new THREE.PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2);
  const ceilGeo = new THREE.PlaneGeometry(TILE, TILE).rotateX(Math.PI / 2).translate(0, WALL_HEIGHT, 0);
  const arch = archGeometry();

  // Holes: the basement stair's pit, and each spiral stair's column (a ceiling
  // hole on Floor 1 and a floor hole on Floor 2).
  const floorHoles = new Set(map.props.filter((p) => p.kind === 'stairs_down' || p.kind === 'stairs_landing').map((p) => `${p.floor}:${p.tx}:${p.ty}`));
  const ceilHoles = new Set(map.props.filter((p) => p.kind === 'grand_stair').map((p) => `${p.floor}:${p.tx}:${p.ty}`));
  const upper = map.floors[FLOOR.UPPER];
  const voidAbove = (x, y) => upper && upper.tiles[y * upper.w + x] === TILE_VOID;

  const floorGroups = [];
  for (const f of map.floors) {
    const g = new THREE.Group();
    g.name = f.name;
    g.position.y = f.y;
    const basement = f.id === FLOOR.BASEMENT;
    const tile = (x, y) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? TILE_WALL : f.tiles[y * f.w + x]);
    const roomOf = (x, y) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? null : map.rooms[f.roomIds[y * f.w + x]] ?? null);
    const walls = {}, floors = {}, ceil = [], ceilStone = [];
    const archNS = [], archEW = [];
    const railX = [], railZ = [], posts = [], slabX = [], slabZ = [];

    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const t = tile(x, y);
        const cx = (x + 0.5) * TILE, cz = (y + 0.5) * TILE;
        if (t === TILE_WALL) {
          let exposed = false;
          for (let oy = -1; oy <= 1 && !exposed; oy++) for (let ox = -1; ox <= 1; ox++) if (tile(x + ox, y + oy) !== TILE_WALL) { exposed = true; break; }
          if (!exposed) continue;
          let kind = basement ? 'stone' : 'wall';
          if (!basement) {
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const r = roomOf(x + dx, y + dy);
              if (r && WALL_KIND[r.type]) { kind = WALL_KIND[r.type]; break; }
            }
          }
          (walls[kind] ??= []).push([cx, 0, cz]);
          continue;
        }
        if (t === TILE_VOID) {
          // The balcony's edge: a balustrade (rail + balusters) and the slab's face.
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = tile(x + dx, y + dy);
            if (n === TILE_VOID || n === TILE_WALL) continue;
            const ex = cx + dx * TILE / 2, ez = cz + dy * TILE / 2;
            if (dx) {
              railZ.push([ex - dx * 0.06, 1.0, ez]);
              slabZ.push([ex, -0.3, ez]);
              for (let k = -2; k <= 2; k++) posts.push([ex - dx * 0.06, 0.5, ez + k * 0.4]);
            } else {
              railX.push([ex, 1.0, ez - dy * 0.06]);
              slabX.push([ex, -0.3, ez]);
              for (let k = -2; k <= 2; k++) posts.push([ex + k * 0.4, 0.5, ez - dy * 0.06]);
            }
          }
          continue;
        }
        const key = `${f.id}:${x}:${y}`;
        if (!ceilHoles.has(key) && !(f.id === FLOOR.GROUND && voidAbove(x, y))) (basement ? ceilStone : ceil).push([cx, 0, cz]);
        if (!floorHoles.has(key)) {
          const r = roomOf(x, y);
          const kind = basement ? 'flag' : r ? (FLOOR_KIND[r.type] ?? 'parquet') : 'velvet';
          (floors[kind] ??= []).push([cx, 0, cz]);
        }
        // Frame single-width doorways with a Gothic stone arch.
        if (t === TILE_DOOR) {
          const wallsEW = tile(x - 1, y) === TILE_WALL && tile(x + 1, y) === TILE_WALL;
          const wallsNS = tile(x, y - 1) === TILE_WALL && tile(x, y + 1) === TILE_WALL;
          if (wallsEW) archNS.push([cx, 0, cz]);
          else if (wallsNS) archEW.push([cx, 0, cz, Math.PI / 2]);
        }
      }
    }

    for (const [kind, list] of Object.entries(walls)) g.add(instanced(wallGeo, mats.wall[kind], list));
    for (const [kind, list] of Object.entries(floors)) g.add(instanced(floorGeo, mats.floor[kind], list, { cast: false }));
    if (ceil.length) g.add(instanced(ceilGeo, mats.ceiling, ceil, { cast: false }));
    if (ceilStone.length) g.add(instanced(ceilGeo, mats.ceilingStone, ceilStone, { cast: false }));
    if (archNS.length) g.add(instanced(arch, mats.arch, archNS));
    if (archEW.length) g.add(instanced(arch, mats.arch, archEW));
    if (railX.length) g.add(instanced(new THREE.BoxGeometry(TILE, 0.08, 0.12), mats.rail, railX));
    if (railZ.length) g.add(instanced(new THREE.BoxGeometry(0.12, 0.08, TILE), mats.rail, railZ));
    if (posts.length) g.add(instanced(new THREE.CylinderGeometry(0.03, 0.04, 1.0, 6), mats.rail, posts, { cast: false }));
    if (slabX.length) g.add(instanced(new THREE.BoxGeometry(TILE, 0.6, 0.1), mats.frame, slabX, { cast: false }));
    if (slabZ.length) g.add(instanced(new THREE.BoxGeometry(0.1, 0.6, TILE), mats.frame, slabZ, { cast: false }));

    root.add(g);
    floorGroups[f.id] = g;
  }

  // The Underground Iron Cage: bars all round the prison room.
  {
    const cell = map.rooms[map.cell.roomId];
    const f = map.floors[cell.floor];
    const bars = [];
    const x0 = cell.x * TILE + 0.18, x1 = (cell.x + cell.w) * TILE - 0.18;
    const z0 = cell.y * TILE + 0.18, z1 = (cell.y + cell.h) * TILE - 0.18;
    const gate = map.props[map.ids.gate];
    for (let x = x0; x <= x1 + 1e-6; x += 0.4) { bars.push([x, WALL_HEIGHT / 2, z0]); bars.push([x, WALL_HEIGHT / 2, z1]); }
    for (let z = z0 + 0.4; z < z1; z += 0.4) {
      if (Math.abs(z - gate.z) > 1.05) bars.push([x0, WALL_HEIGHT / 2, z]); // (the cage door is the gate)
      bars.push([x1, WALL_HEIGHT / 2, z]);
    }
    const g = floorGroups[cell.floor];
    g.add(instanced(new THREE.CylinderGeometry(0.025, 0.025, WALL_HEIGHT, 6), mats.iron, bars));
    const hoops = [];
    for (const y of [0.15, WALL_HEIGHT * 0.55, WALL_HEIGHT - 0.1]) {
      hoops.push([(x0 + x1) / 2, y, z0], [(x0 + x1) / 2, y, z1]);
    }
    g.add(instanced(new THREE.BoxGeometry(x1 - x0, 0.06, 0.06), mats.iron, hoops));
    void f;
  }

  // ---- props --------------------------------------------------------------
  const propObjects = new Map();
  const animated = [];
  const flickers = [];
  const windowBeams = [];
  let staticLights = 0;

  for (const p of map.props) {
    if (p.kind === 'chandelier' && p.floor === FLOOR.UPPER && upper.tiles[p.ty * upper.w + p.tx] === TILE_VOID) p.overVoid = true;
    const obj = kit.build(p);
    obj.position.set(p.x, 0, p.z);
    obj.rotation.y = p.rot;
    obj.userData.prop = p;
    floorGroups[p.floor].add(obj);
    propObjects.set(p.id, obj);
    if (obj.userData.fx) animated.push(obj);
    if (obj.userData.windowBeam) windowBeams.push(obj.userData.windowBeam);

    if (p.light && staticLights < MAX_STATIC_LIGHTS) {
      staticLights++;
      // Lights live on the root (never hidden) so the light count stays constant
      // and switching floors doesn't trigger a shader recompile.
      const light = new THREE.PointLight(p.light, 4, 9, 1.8);
      light.position.set(p.x, map.floors[p.floor].y + 0.9, p.z);
      root.add(light);
      flickers.push({ light, floor: p.floor, base: 4, seed: p.id * 13.7 });
    }
  }

  let activeFloor = 0;
  let dread = 0; // 0..1: the Amalgam is near (Lights Out flicker)
  const flash = new THREE.PointLight(0xff2010, 0, 12, 1.5);
  root.add(flash);

  // ---- effects --------------------------------------------------------------
  const revealed = new Set();
  const destroyed = new Set();
  const unsealed = new Set();
  const transients = [];
  const heartAuras = new Map();

  const emberSprite = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();

  function burst(floor, x, z, color = 0xff2a1a) {
    const n = 160;
    const positions = new Float32Array(n * 3);
    const velocities = [];
    for (let i = 0; i < n; i++) {
      positions.set([x, 1.4, z], i * 3);
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2, s = 1.5 + Math.random() * 4;
      velocities.push([Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 1, Math.sin(a) * Math.cos(e) * s]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.06, map: emberSprite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    floorGroups[floor].add(points);
    flash.position.set(x, map.floors[floor].y + 1.5, z);
    transients.push({
      age: 0,
      life: 2.2,
      update(dt) {
        this.age += dt;
        const pos = geo.attributes.position.array;
        for (let i = 0; i < n; i++) {
          const v = velocities[i];
          v[1] -= 6 * dt;
          v[0] *= 0.97; v[2] *= 0.97;
          pos[i * 3] += v[0] * dt;
          pos[i * 3 + 1] = Math.max(0.02, pos[i * 3 + 1] + v[1] * dt);
          pos[i * 3 + 2] += v[2] * dt;
        }
        geo.attributes.position.needsUpdate = true;
        const k = 1 - this.age / this.life;
        mat.opacity = Math.max(0, k);
        flash.intensity = 30 * Math.max(0, 1 - this.age * 2.5);
      },
      dispose() {
        floorGroups[floor].remove(points);
        geo.dispose();
        mat.dispose();
        flash.intensity = 0;
      },
    });
  }

  function shrinkAway(obj) {
    const start = obj.scale.clone();
    transients.push({
      age: 0,
      life: 0.7,
      update(dt) {
        this.age += dt;
        const k = Math.max(0, 1 - this.age / this.life);
        obj.scale.set(start.x * (1 + (1 - k) * 0.3), start.y * k, start.z * (1 + (1 - k) * 0.3));
        obj.rotation.z = (Math.random() - 0.5) * 0.1 * k;
      },
      dispose() { obj.visible = false; },
    });
  }

  // ---- a Sin's arena: blood-rune barriers over every doorway --------------------
  const runeTex = runeTexture();
  const arenas = new Map(); // barrierId -> { group, mat, age, closing }
  function addArena(info) {
    if (arenas.has(info.barrierId)) return;
    const f = map.floors[info.floor];
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      map: runeTex, color: 0xff2a1a, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const veil = new THREE.MeshBasicMaterial({ color: 0x5a0004, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.PlaneGeometry(TILE, WALL_HEIGHT);
    for (const [tx, ty] of info.tiles) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h || f.roomIds[ny * f.w + nx] !== info.roomId) continue;
        // The barrier stands on the threshold between this tile and the room.
        const x = (tx + 0.5 + dx * 0.5) * TILE, z = (ty + 0.5 + dy * 0.5) * TILE;
        for (const m of [veil, mat]) {
          const mesh = new THREE.Mesh(plane, m);
          mesh.position.set(x, WALL_HEIGHT / 2, z);
          mesh.rotation.y = dx ? Math.PI / 2 : 0;
          mesh.renderOrder = 5;
          group.add(mesh);
        }
        const halo = kit.glow(group, x, 1.6, z, 0xff2010, 2.6, true);
        halo.userData.halo = true;
      }
    }
    floorGroups[info.floor].add(group);
    arenas.set(info.barrierId, { group, mat, veil, age: 0, closing: false, floor: info.floor });
  }
  function removeArena(barrierId) {
    const a = arenas.get(barrierId);
    if (a) a.closing = true;
  }

  return {
    group: root,
    floorGroups,
    propObjects,
    kit,

    setDread(k) { dread = k; },

    /**
     * Which floors to draw from `floor`: the basement alone, or Floors 1 and 2
     * together (the balcony looks down into the Foyer, and up from it). The
     * other story only shows its overlook room's props.
     */
    setActiveFloor(floor) {
      activeFloor = floor;
      this._overlook = true;
      const both = floor !== FLOOR.BASEMENT;
      floorGroups.forEach((g, i) => { g.visible = i === floor || (both && i !== FLOOR.BASEMENT); });
      const overlook = floor === FLOOR.GROUND ? map.ids.gallery : map.ids.foyer;
      for (const obj of propObjects.values()) {
        const p = obj.userData.prop;
        if (p.floor === FLOOR.BASEMENT) continue;
        const gone = destroyed.has(p.id) && obj.userData.prop.interact === 'curio';
        obj.visible = !gone && (p.floor === floor || p.room === overlook || p.kind === 'grand_stair' || p.kind === 'stairs_landing');
      }
      for (const a of arenas.values()) a.group.visible = a.floor === floor;
    },

    /** Draw the other story only when it can be seen (through the Foyer's void). */
    setOverlook(on) {
      if (on === this._overlook || activeFloor === FLOOR.BASEMENT) return;
      this._overlook = on;
      const other = activeFloor === FLOOR.GROUND ? FLOOR.UPPER : FLOOR.GROUND;
      floorGroups[other].visible = on;
    },

    visibleFloors(floor) {
      return floor === FLOOR.BASEMENT ? [FLOOR.BASEMENT] : [FLOOR.GROUND, FLOOR.UPPER];
    },

    revealHearts(propIds) {
      for (const id of propIds) revealed.add(id);
    },

    /** The room task is broken: the Heart glows in its true colours. */
    unsealHeart(propId) {
      revealed.add(propId);
      unsealed.add(propId);
      const obj = propObjects.get(propId);
      if (!obj || heartAuras.has(propId)) return;
      const aura = kit.glow(obj, 0, 1.4, 0.3, 0xff1828, 2.2, true);
      heartAuras.set(propId, aura);
    },

    setPropState(propId, state) {
      propObjects.get(propId)?.userData.setState?.(state);
    },

    destroyHeart(propId, instant = false) {
      if (destroyed.has(propId)) return;
      destroyed.add(propId);
      const obj = propObjects.get(propId);
      if (!obj) return;
      const aura = heartAuras.get(propId);
      if (aura) aura.visible = false;
      if (instant) {
        obj.visible = false;
        return;
      }
      const p = obj.userData.prop;
      burst(p.floor, p.x, p.z);
      shrinkAway(obj);
    },

    setGateOpen(propId, open) {
      const door = propObjects.get(propId)?.userData.door;
      if (door) door.userData.targetOpen = open ? 1 : 0;
    },

    addArena,
    removeArena,

    update(t, dt, camera, lumos = false) {
      kit.uniforms.time.value = t;
      const ctx = { camera, isHeart: false, lumosNear: false };
      const cam = camera.getWorldPosition(this._cam ??= new THREE.Vector3());
      for (const obj of animated) {
        if (!obj.visible || !obj.parent.visible) continue;
        const p = obj.userData.prop;
        const id = p.id;
        ctx.isHeart = revealed.has(id) && !destroyed.has(id);
        if (lumos && p.interact === 'task') {
          const wy = FLOOR_Y[p.floor];
          ctx.lumosNear = Math.hypot(p.x - cam.x, p.z - cam.z) < LUMOS_REVEAL && Math.abs(cam.y - wy) < 4;
        } else {
          ctx.lumosNear = false;
        }
        obj.userData.fx(t, ctx);
        const door = obj.userData.door;
        if (door) {
          const target = (door.userData.targetOpen ?? 0) * -1.9;
          door.rotation.y += (target - door.rotation.y) * Math.min(1, dt * 3);
        }
      }
      for (const [id, aura] of heartAuras) {
        if (!aura.visible) continue;
        const k = heartbeatLocal(t);
        aura.material.opacity = 0.35 + k * 0.5;
        aura.scale.setScalar(1.8 + k * 0.8);
        void id;
      }
      for (const f of flickers) {
        const n = Math.sin(t * 9 + f.seed) * 0.5 + Math.sin(t * 23.7 + f.seed * 2) * 0.3 + Math.sin(t * 3.1) * 0.2;
        // Near the Amalgam, candles gutter and drop out erratically.
        const gutter = dread > 0 ? (Math.random() < dread * 0.2 ? 0.04 : 1 - dread * 0.5 * Math.random()) : 1;
        f.light.intensity = f.floor === activeFloor ? f.base * (0.8 + n * 0.18) * gutter : 0;
      }
      // Moonbeams drift with passing clouds.
      for (const [i, beam] of windowBeams.entries()) beam.material.uniforms.uOpacity.value = 0.13 + Math.sin(t * 0.21 + i) * 0.04;
      for (const [id, a] of arenas) {
        a.age += dt;
        const target = a.closing ? 0 : 0.85 + Math.sin(t * 6) * 0.15;
        a.mat.opacity += (target - a.mat.opacity) * Math.min(1, dt * (a.closing ? 2.5 : 6));
        a.veil.opacity = a.mat.opacity * 0.45;
        runeTex.offset.y = -t * 0.15;
        for (const c of a.group.children) if (c.userData.halo) c.material.opacity = a.mat.opacity * 0.6;
        if (a.closing && a.mat.opacity < 0.02) {
          a.group.parent?.remove(a.group);
          a.mat.dispose();
          a.veil.dispose();
          arenas.delete(id);
        }
      }
      for (let i = transients.length - 1; i >= 0; i--) {
        const fx = transients[i];
        fx.update(dt);
        if (fx.age >= fx.life) {
          fx.dispose();
          transients.splice(i, 1);
        }
      }
    },

    burst,
  };
}

function heartbeatLocal(t) {
  const p = (t * 1.1) % 1;
  return Math.min(1, Math.exp(-((p - 0.05) ** 2) / 0.0012) + 0.6 * Math.exp(-((p - 0.24) ** 2) / 0.0015));
}
