// Turns the generated map JSON into a Three.js scene: instanced walls,
// floors and ceilings per floor, door frames, all props, and the few static
// candle lights. Also owns prop-level effects (heart tells, heart destruction).

import * as THREE from 'three';
import { TILE, WALL_HEIGHT, TILE_WALL, TILE_DOOR } from '/shared/constants.js';
import { createTextures } from './textures.js';
import { createPropKit } from './props.js';

const MAX_STATIC_LIGHTS = 3;

function instanced(geometry, material, positions, { cast = true, receive = true } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, positions.length));
  const m = new THREE.Matrix4();
  positions.forEach(([x, y, z], i) => {
    m.makeTranslation(x, y, z);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = positions.length;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export function buildMansion(map) {
  const tex = createTextures(map.seed);
  const kit = createPropKit(tex);
  const root = new THREE.Group();
  root.name = 'mansion';

  const mats = {
    wallpaper: new THREE.MeshStandardMaterial({ map: tex.wallpaper, roughness: 0.92 }),
    stoneWall: new THREE.MeshStandardMaterial({ map: tex.stoneWall, roughness: 0.97 }),
    wood: new THREE.MeshStandardMaterial({ map: tex.woodFloor, roughness: 0.78 }),
    carpet: new THREE.MeshStandardMaterial({ map: tex.carpet, roughness: 1 }),
    stoneFloor: new THREE.MeshStandardMaterial({ map: tex.stoneFloor, roughness: 0.95 }),
    ceiling: new THREE.MeshStandardMaterial({ map: tex.ceiling, roughness: 1 }),
    frame: kit.materials.woodDark,
  };

  const wallGeo = new THREE.BoxGeometry(TILE, WALL_HEIGHT, TILE).translate(0, WALL_HEIGHT / 2, 0);
  const floorGeo = new THREE.PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2);
  const ceilGeo = new THREE.PlaneGeometry(TILE, TILE).rotateX(Math.PI / 2).translate(0, WALL_HEIGHT, 0);

  const holes = new Set(map.props.filter((p) => p.kind === 'stairs_down').map((p) => `${p.floor}:${p.tx}:${p.ty}`));
  const floorGroups = [];

  for (const f of map.floors) {
    const g = new THREE.Group();
    g.name = f.name;
    g.position.y = f.y;
    const basement = f.id === 1;
    const tile = (x, y) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? TILE_WALL : f.tiles[y * f.w + x]);
    const walls = [], roomFloor = [], hallFloor = [], ceil = [];
    const headersNS = [], headersEW = [], posts = [];

    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const t = tile(x, y);
        const cx = (x + 0.5) * TILE, cz = (y + 0.5) * TILE;
        if (t === TILE_WALL) {
          let exposed = false;
          for (let oy = -1; oy <= 1 && !exposed; oy++) for (let ox = -1; ox <= 1; ox++) if (tile(x + ox, y + oy) !== TILE_WALL) { exposed = true; break; }
          if (exposed) walls.push([cx, 0, cz]);
          continue;
        }
        ceil.push([cx, 0, cz]);
        if (!holes.has(`${f.id}:${x}:${y}`)) {
          (f.roomIds[y * f.w + x] >= 0 || basement ? roomFloor : hallFloor).push([cx, 0, cz]);
        }
        // Frame single-width doorways.
        if (t === TILE_DOOR) {
          const wallsEW = tile(x - 1, y) === TILE_WALL && tile(x + 1, y) === TILE_WALL;
          const wallsNS = tile(x, y - 1) === TILE_WALL && tile(x, y + 1) === TILE_WALL;
          if (wallsEW) {
            headersNS.push([cx, 0, cz]);
            for (const s of [-1, 1]) posts.push([cx + s * (TILE / 2 - 0.08), 0, cz]);
          } else if (wallsNS) {
            headersEW.push([cx, 0, cz]);
            for (const s of [-1, 1]) posts.push([cx, 0, cz + s * (TILE / 2 - 0.08)]);
          }
        }
      }
    }

    g.add(instanced(wallGeo, basement ? mats.stoneWall : mats.wallpaper, walls));
    g.add(instanced(floorGeo, basement ? mats.stoneFloor : mats.wood, roomFloor, { cast: false }));
    if (hallFloor.length) g.add(instanced(floorGeo, mats.carpet, hallFloor, { cast: false }));
    g.add(instanced(ceilGeo, basement ? mats.stoneFloor : mats.ceiling, ceil, { cast: false }));
    const headerY = WALL_HEIGHT - 0.45;
    if (headersNS.length) g.add(instanced(new THREE.BoxGeometry(TILE, 0.9, 0.5).translate(0, headerY, 0), mats.frame, headersNS));
    if (headersEW.length) g.add(instanced(new THREE.BoxGeometry(0.5, 0.9, TILE).translate(0, headerY, 0), mats.frame, headersEW));
    if (posts.length) g.add(instanced(new THREE.BoxGeometry(0.16, WALL_HEIGHT - 0.9, 0.5).translate(0, (WALL_HEIGHT - 0.9) / 2, 0), mats.frame, posts));

    root.add(g);
    floorGroups.push(g);
  }

  // ---- props --------------------------------------------------------------
  const propObjects = new Map();
  const animated = [];
  const flickers = [];
  let staticLights = 0;

  for (const p of map.props) {
    const obj = kit.build(p);
    obj.position.set(p.x, 0, p.z);
    obj.rotation.y = p.rot;
    obj.userData.prop = p;
    floorGroups[p.floor].add(obj);
    propObjects.set(p.id, obj);
    if (obj.userData.fx) animated.push(obj);

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
  const flash = new THREE.PointLight(0xff2010, 0, 12, 1.5);
  root.add(flash);

  // ---- effects --------------------------------------------------------------
  const revealed = new Set();
  const destroyed = new Set();
  const transients = [];

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

  function burst(floor, x, z) {
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
    const mat = new THREE.PointsMaterial({ color: 0xff2a1a, size: 0.06, map: emberSprite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
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

  return {
    group: root,
    floorGroups,
    propObjects,

    setActiveFloor(floor) {
      activeFloor = floor;
      floorGroups.forEach((g, i) => { g.visible = i === floor; });
    },

    revealHearts(propIds) {
      for (const id of propIds) revealed.add(id);
    },

    destroyHeart(propId, instant = false) {
      if (destroyed.has(propId)) return;
      destroyed.add(propId);
      const obj = propObjects.get(propId);
      if (!obj) return;
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

    update(t, dt, camera) {
      const ctx = { camera, isHeart: false };
      for (const obj of animated) {
        if (!obj.visible || !obj.parent.visible) continue;
        const id = obj.userData.prop.id;
        ctx.isHeart = revealed.has(id) && !destroyed.has(id);
        obj.userData.fx(t, ctx);
        const door = obj.userData.door;
        if (door) {
          const target = (door.userData.targetOpen ?? 0) * -1.9;
          door.rotation.y += (target - door.rotation.y) * Math.min(1, dt * 3);
        }
      }
      for (const f of flickers) {
        const n = Math.sin(t * 9 + f.seed) * 0.5 + Math.sin(t * 23.7 + f.seed * 2) * 0.3 + Math.sin(t * 3.1) * 0.2;
        f.light.intensity = f.floor === activeFloor ? f.base * (0.8 + n * 0.18) : 0;
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
  };
}
