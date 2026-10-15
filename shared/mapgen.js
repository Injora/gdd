// Procedural Gothic mansion generator.
//
// Ground floor: binary-space-partition rooms joined by corridors (plus a few
// extra loops so chases never dead-end). Basement: an authored template holding
// the Crypt, Wine Cellar, Ossuary and the single-gated Basement Ritual Cell.
//
// The output is plain JSON (see ARCHITECTURE.md "Map format") so the server can
// send it straight to clients. Everything here is deterministic for a seed.

import { createRng } from './rng.js';
import {
  TILE, TILE_WALL, TILE_FLOOR, TILE_DOOR, FLOOR_Y, DIRS, HEART_COUNT,
  tileCenter, propRotFromDir, yawFromDir,
} from './constants.js';
import { ROOM_TYPES, HEART_TYPES, HEART_TYPE_IDS, makeClue } from './lore.js';
import { PROP_DEFS } from './propdefs.js';

const GROUND_W = 60;
const GROUND_H = 60;
const MIN_LEAF = 10;
const BASEMENT_W = 34;
const BASEMENT_H = 26;

// ---------------------------------------------------------------------------
// Grid

class FloorGrid {
  constructor(id, name, w, h) {
    this.id = id;
    this.name = name;
    this.w = w;
    this.h = h;
    this.y = FLOOR_Y[id];
    this.tiles = new Array(w * h).fill(TILE_WALL);
    this.roomIds = new Array(w * h).fill(-1);
    this.blocked = new Array(w * h).fill(0);
  }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  idx(x, y) { return y * this.w + x; }
  tile(x, y) { return this.inb(x, y) ? this.tiles[this.idx(x, y)] : TILE_WALL; }
  room(x, y) { return this.inb(x, y) ? this.roomIds[this.idx(x, y)] : -1; }
  walkable(x, y) { return this.tile(x, y) !== TILE_WALL && !this.blocked[this.idx(x, y)]; }

  carveRoom(r) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = this.idx(x, y);
        this.tiles[i] = TILE_FLOOR;
        this.roomIds[i] = r.id;
      }
    }
  }
  carveTile(x, y) {
    if (x < 1 || y < 1 || x >= this.w - 1 || y >= this.h - 1) return;
    const i = this.idx(x, y);
    if (this.tiles[i] === TILE_WALL) this.tiles[i] = TILE_FLOOR;
  }
  carveH(x1, x2, y, wd) {
    const a = Math.min(x1, x2), b = Math.max(x1, x2) + wd - 1;
    for (let x = a; x <= b; x++) for (let k = 0; k < wd; k++) this.carveTile(x, y + k);
  }
  carveV(y1, y2, x, wd) {
    const a = Math.min(y1, y2), b = Math.max(y1, y2) + wd - 1;
    for (let y = a; y <= b; y++) for (let k = 0; k < wd; k++) this.carveTile(x + k, y);
  }
  carveCorridor(a, b, wd, horizontalFirst) {
    if (horizontalFirst) {
      this.carveH(a.x, b.x, a.y, wd);
      this.carveV(a.y, b.y, b.x, wd);
    } else {
      this.carveV(a.y, b.y, a.x, wd);
      this.carveH(a.x, b.x, b.y, wd);
    }
  }
  /** Corridor tiles touching a room become doorways. */
  markDoors() {
    for (let y = 1; y < this.h - 1; y++) {
      for (let x = 1; x < this.w - 1; x++) {
        const i = this.idx(x, y);
        if (this.tiles[i] !== TILE_FLOOR || this.roomIds[i] !== -1) continue;
        for (const [dx, dy] of DIRS) {
          if (this.room(x + dx, y + dy) >= 0) { this.tiles[i] = TILE_DOOR; break; }
        }
      }
    }
  }
  /** BFS distance (in tiles) from (sx, sy) over walkable tiles; -1 = unreachable. */
  distances(sx, sy) {
    const dist = new Array(this.w * this.h).fill(-1);
    const q = [sx, sy];
    dist[this.idx(sx, sy)] = 0;
    for (let h = 0; h < q.length; h += 2) {
      const x = q[h], y = q[h + 1], d = dist[this.idx(x, y)];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!this.walkable(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (dist[ni] !== -1) continue;
        dist[ni] = d + 1;
        q.push(nx, ny);
      }
    }
    return dist;
  }
  /** True when every walkable tile is reachable from (ax, ay). */
  connectedFrom(ax, ay) {
    let total = 0;
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] !== TILE_WALL && !this.blocked[i]) total++;
    const dist = this.distances(ax, ay);
    let reached = 0;
    for (const d of dist) if (d >= 0) reached++;
    return reached === total;
  }
  toJSON() {
    return {
      id: this.id, name: this.name, w: this.w, h: this.h, y: this.y,
      tiles: this.tiles, roomIds: this.roomIds, blocked: this.blocked,
    };
  }
}

// ---------------------------------------------------------------------------
// Ground floor layout (BSP)

function splitBSP(rng, node, depth, leaves) {
  const canV = node.w >= MIN_LEAF * 2;
  const canH = node.h >= MIN_LEAF * 2;
  const smallEnough = node.w <= MIN_LEAF * 2.4 && node.h <= MIN_LEAF * 2.4;
  if ((!canV && !canH) || (depth >= 3 && smallEnough && rng.chance(0.25))) {
    leaves.push(node);
    return node;
  }
  let vertical;
  if (canV && canH) {
    if (node.w > node.h * 1.2) vertical = true;
    else if (node.h > node.w * 1.2) vertical = false;
    else vertical = rng.chance(0.5);
  } else {
    vertical = canV;
  }
  if (vertical) {
    const cut = rng.int(MIN_LEAF, node.w - MIN_LEAF);
    node.children = [
      { x: node.x, y: node.y, w: cut, h: node.h },
      { x: node.x + cut, y: node.y, w: node.w - cut, h: node.h },
    ];
  } else {
    const cut = rng.int(MIN_LEAF, node.h - MIN_LEAF);
    node.children = [
      { x: node.x, y: node.y, w: node.w, h: cut },
      { x: node.x, y: node.y + cut, w: node.w, h: node.h - cut },
    ];
  }
  for (const c of node.children) splitBSP(rng, c, depth + 1, leaves);
  return node;
}

function makeRoomInLeaf(rng, leaf, id, floor) {
  const rw = rng.int(Math.max(5, Math.floor((leaf.w - 2) * 0.6)), leaf.w - 2);
  const rh = rng.int(Math.max(5, Math.floor((leaf.h - 2) * 0.6)), leaf.h - 2);
  const x = leaf.x + rng.int(1, leaf.w - rw - 1);
  const y = leaf.y + rng.int(1, leaf.h - rh - 1);
  return makeRoom(id, floor, x, y, rw, rh);
}

function makeRoom(id, floor, x, y, w, h) {
  return {
    id, floor, x, y, w, h,
    cx: x + Math.floor(w / 2),
    cy: y + Math.floor(h / 2),
    area: w * h,
    type: null,
    name: null,
  };
}

const manhattan = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);

function connectTree(rng, grid, node, links) {
  if (!node.children) return [node.room];
  const a = connectTree(rng, grid, node.children[0], links);
  const b = connectTree(rng, grid, node.children[1], links);
  let best = null;
  for (const ra of a) {
    for (const rb of b) {
      const d = manhattan(ra, rb);
      if (!best || d < best.d) best = { ra, rb, d };
    }
  }
  link(rng, grid, best.ra, best.rb, links);
  return a.concat(b);
}

function link(rng, grid, a, b, links) {
  const wd = rng.chance(0.4) ? 2 : 1;
  grid.carveCorridor({ x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }, wd, rng.chance(0.5));
  links.add(linkKey(a, b));
}
const linkKey = (a, b) => (a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`);

// ---------------------------------------------------------------------------
// Room furnishing recipes: [kind, strategy, min, max]

const RECIPES = {
  foyer: [['statue', 'inset', 2, 4], ['armchair', 'wall', 1, 2], ['cabinet', 'wall', 1, 1], ['painting', 'wall', 1, 2], ['rug', 'rug', 1, 1], ['chandelier', 'chandelier', 1, 1]],
  library: [['bookshelf', 'wall', 6, 12], ['desk', 'wall', 1, 1], ['armchair', 'wall', 1, 2], ['chair', 'center', 1, 2], ['chandelier', 'chandelier', 0, 1]],
  altar: [['pillar', 'inset', 4, 4], ['statue', 'wall', 1, 2], ['sconce', 'wall', 2, 4]],
  stairwell: [['crate', 'wall', 1, 2], ['cabinet', 'wall', 0, 1], ['sconce', 'wall', 1, 2]],
  ballroom: [['pillar', 'inset', 4, 4], ['piano', 'wall', 1, 1], ['chair', 'wall', 2, 4], ['statue', 'wall', 0, 1], ['chandelier', 'chandelier', 1, 1]],
  dining: [['longtable', 'longtable', 1, 1], ['cabinet', 'wall', 1, 2], ['fireplace', 'wall', 0, 1], ['painting', 'wall', 1, 2], ['chandelier', 'chandelier', 1, 1]],
  gallery: [['painting', 'wall', 5, 9], ['statue', 'center', 1, 2], ['armchair', 'wall', 0, 1], ['rug', 'rug', 0, 1]],
  conservatory: [['plant', 'wall', 4, 8], ['plant', 'center', 1, 3], ['table', 'center', 0, 1], ['chair', 'center', 0, 2]],
  music: [['piano', 'wall', 1, 1], ['chair', 'center', 2, 4], ['cabinet', 'wall', 0, 1], ['painting', 'wall', 0, 1], ['rug', 'rug', 0, 1]],
  master_bedroom: [['bed', 'wall', 1, 1], ['wardrobe', 'wall', 1, 2], ['fireplace', 'wall', 0, 1], ['armchair', 'wall', 0, 1], ['rug', 'rug', 1, 1]],
  parlor: [['armchair', 'wall', 2, 4], ['table', 'center', 1, 1], ['fireplace', 'wall', 0, 1], ['cabinet', 'wall', 1, 1], ['rug', 'rug', 1, 1]],
  billiard: [['billiard', 'center', 1, 1], ['cabinet', 'wall', 1, 2], ['chair', 'wall', 1, 2], ['antlers', 'wall', 0, 1]],
  trophy: [['antlers', 'wall', 3, 6], ['statue', 'center', 0, 2], ['cabinet', 'wall', 1, 2], ['armchair', 'wall', 0, 1]],
  kitchen: [['stove', 'wall', 1, 2], ['table', 'center', 1, 2], ['cabinet', 'wall', 2, 3], ['barrel', 'wall', 1, 2]],
  guest_bedroom: [['bed', 'wall', 1, 1], ['wardrobe', 'wall', 0, 1], ['chair', 'wall', 0, 1]],
  nursery: [['crib', 'wall', 1, 2], ['rockinghorse', 'center', 0, 1], ['cabinet', 'wall', 0, 1], ['chair', 'wall', 0, 1]],
  study: [['desk', 'wall', 1, 1], ['bookshelf', 'wall', 1, 3], ['armchair', 'wall', 0, 1]],
  servants: [['bed', 'wall', 1, 2], ['cabinet', 'wall', 0, 1], ['chair', 'wall', 0, 1]],
  washroom: [['bathtub', 'wall', 1, 1], ['cabinet', 'wall', 0, 1]],
  sewing: [['table', 'center', 1, 1], ['chair', 'center', 0, 2], ['cabinet', 'wall', 1, 2]],
  smoking: [['armchair', 'wall', 2, 3], ['table', 'center', 0, 1], ['cabinet', 'wall', 0, 1]],
  antechamber: [['crate', 'wall', 2, 4], ['barrel', 'wall', 0, 2], ['sconce', 'wall', 1, 2]],
  crypt: [['coffin', 'center', 2, 4], ['sarcophagus', 'center', 1, 2], ['statue', 'wall', 0, 2], ['candles', 'candles', 1, 2]],
  wine_cellar: [['barrel', 'wall', 5, 9], ['crate', 'wall', 1, 3], ['crate', 'center', 0, 2]],
  ossuary: [['statue', 'wall', 1, 2], ['crate', 'wall', 1, 2], ['coffin', 'wall', 1, 2], ['candles', 'candles', 1, 1]],
  cell: [['shackles', 'wall', 3, 4], ['ritualcircle', 'circle', 1, 1]],
};

// ---------------------------------------------------------------------------
// Prop placement

class Placer {
  constructor(rng, grids, anchors) {
    this.rng = rng;
    this.grids = grids;
    this.anchors = anchors; // per floor [x, y] used for connectivity checks
    this.props = [];
    this.occ = grids.map(() => new Set());
    this.reserved = grids.map(() => new Set());
  }

  reserve(floor, x, y) { this.reserved[floor].add(this.grids[floor].idx(x, y)); }

  /** Reserve room tiles next to any opening so doorways never get blocked. */
  reserveDoorways(room) {
    const g = this.grids[room.floor];
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        let nearOpening = false;
        for (let oy = -1; oy <= 1 && !nearOpening; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const t = g.tile(x + ox, y + oy);
            if (t !== TILE_WALL && g.room(x + ox, y + oy) !== room.id) { nearOpening = true; break; }
          }
        }
        if (nearOpening) this.reserve(room.floor, x, y);
      }
    }
  }

  wallSlots(room) {
    const g = this.grids[room.floor];
    const slots = [];
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (x !== room.x && x !== room.x + room.w - 1 && y !== room.y && y !== room.y + room.h - 1) continue;
        for (let d = 0; d < 4; d++) {
          const [dx, dy] = DIRS[d];
          if (g.tile(x + dx, y + dy) === TILE_WALL) slots.push({ x, y, dir: (d + 2) % 4, wall: true });
        }
      }
    }
    return this.rng.shuffle(slots);
  }

  centerSlots(room) {
    const slots = [];
    for (let y = room.y + 2; y <= room.y + room.h - 3; y++) {
      for (let x = room.x + 2; x <= room.x + room.w - 3; x++) {
        slots.push({ x, y, dir: this.rng.int(0, 3), wall: false });
      }
    }
    return this.rng.shuffle(slots);
  }

  insetSlots(room) {
    if (room.w < 6 || room.h < 6) return [];
    const x0 = room.x + 1, x1 = room.x + room.w - 2, y0 = room.y + 1, y1 = room.y + room.h - 2;
    return [
      { x: x0, y: y0, dir: 2, wall: false }, { x: x1, y: y0, dir: 2, wall: false },
      { x: x0, y: y1, dir: 0, wall: false }, { x: x1, y: y1, dir: 0, wall: false },
    ];
  }

  /**
   * Try to place `kind` at `slot`. Returns the prop or null if the footprint is
   * invalid or a blocking prop would cut the floor in two.
   */
  place(room, kind, slot, extra = {}) {
    const def = PROP_DEFS[kind];
    const floor = room ? room.floor : extra.floor;
    const g = this.grids[floor];
    const [dx, dy] = DIRS[slot.dir];
    const len = def.len || 1;
    const start = slot.centered ? -Math.floor(len / 2) : 0;
    const footprint = [];
    for (let i = 0; i < len; i++) footprint.push([slot.x + dx * (start + i), slot.y + dy * (start + i)]);

    if (def.mount !== 'none') {
      for (const [fx, fy] of footprint) {
        if (!g.inb(fx, fy) || g.tile(fx, fy) === TILE_WALL) return null;
        if (room && g.room(fx, fy) !== room.id) return null;
        const i = g.idx(fx, fy);
        if (this.occ[floor].has(i)) return null;
        if (this.reserved[floor].has(i) && !slot.ignoreReserved) return null;
      }
    }

    let front = null;
    if (def.interact && def.mount === 'floor') {
      const fx = slot.x + dx * (start + len), fy = slot.y + dy * (start + len);
      if (!g.walkable(fx, fy) || this.occ[floor].has(g.idx(fx, fy))) return null;
      front = [fx, fy];
    }

    if (def.blocks && !def.dynamic) {
      for (const [fx, fy] of footprint) g.blocked[g.idx(fx, fy)] = 1;
      const [ax, ay] = this.anchors[floor];
      if (!g.connectedFrom(ax, ay)) {
        for (const [fx, fy] of footprint) g.blocked[g.idx(fx, fy)] = 0;
        return null;
      }
    }
    if (def.mount !== 'none') for (const [fx, fy] of footprint) this.occ[floor].add(g.idx(fx, fy));
    if (front) this.reserve(floor, front[0], front[1]);

    // World position: footprint centre, pushed back against the wall if wall-backed.
    let cx = 0, cy = 0;
    for (const [fx, fy] of footprint) { cx += fx; cy += fy; }
    cx /= footprint.length; cy /= footprint.length;
    let x = tileCenter(cx), z = tileCenter(cy);
    if (slot.wall) {
      const shift = def.mount === 'wall'
        ? TILE / 2 - def.d / 2 - 0.01
        : (len * TILE - def.d) / 2 - 0.04;
      x -= dx * shift;
      z -= dy * shift;
    }
    const rot = propRotFromDir(dx, dy);
    const ns = dx === 0;
    const prop = {
      id: this.props.length,
      kind,
      floor,
      room: room ? room.id : -1,
      tx: slot.x,
      ty: slot.y,
      dir: slot.dir,
      x: round3(x),
      z: round3(z),
      rot: round3(rot),
      blocks: !!def.blocks,
      interact: def.interact || null,
      variant: this.rng.int(0, 9999),
      ...extra,
    };
    if (def.blocks) {
      prop.collider = {
        x: prop.x, z: prop.z,
        hx: round3((ns ? def.w : def.d) / 2),
        hz: round3((ns ? def.d : def.w) / 2),
      };
      if (def.dynamic) prop.collider.dynamic = true;
    }
    if (front) prop.front = { tx: front[0], ty: front[1], x: tileCenter(front[0]), z: tileCenter(front[1]) };
    this.props.push(prop);
    return prop;
  }

  /** Try slots in order until one works. */
  placeAny(room, kind, slots, extra) {
    for (const s of slots) {
      const p = this.place(room, kind, s, extra);
      if (p) return p;
    }
    return null;
  }

  placeOnWall(room, kind, extra) { return this.placeAny(room, kind, this.wallSlots(room), extra); }

  furnish(room) {
    const recipe = RECIPES[room.type] || [];
    for (const [kind, strategy, min, max] of recipe) {
      const n = this.rng.int(min, max);
      for (let i = 0; i < n; i++) {
        let slots;
        switch (strategy) {
          case 'wall': slots = this.wallSlots(room); break;
          case 'center': slots = this.centerSlots(room); break;
          case 'inset': slots = this.insetSlots(room).slice(i, i + 1); break;
          case 'longtable': {
            const horizontal = room.w >= room.h;
            slots = [{ x: room.cx, y: room.cy, dir: horizontal ? 1 : 2, wall: false, centered: true }];
            break;
          }
          case 'rug':
          case 'chandelier':
          case 'circle':
            slots = [{ x: room.cx, y: room.cy, dir: room.w >= room.h ? 1 : 0, wall: false }];
            break;
          case 'candles':
            slots = this.centerSlots(room);
            break;
          default: slots = [];
        }
        this.placeAny(room, kind, slots);
      }
    }
  }
}

const round3 = (v) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------
// Room type assignment (ground floor)

function assignGroundRooms(rng, grid, rooms) {
  const half = grid.w / 2;
  const foyer = rooms.reduce((best, r) => {
    const score = r.y + r.h - 0.3 * Math.abs(r.cx - half);
    return !best || score > best.score ? { r, score } : best;
  }, null).r;
  setType(foyer, 'foyer');

  const dist = grid.distances(foyer.cx, foyer.cy);
  for (const r of rooms) r.dist = dist[grid.idx(r.cx, r.cy)];
  const maxDist = Math.max(...rooms.map((r) => r.dist));

  const free = () => rooms.filter((r) => !r.type);
  const roomy = (list, minArea) => {
    const big = list.filter((r) => r.area >= minArea);
    return big.length ? big : list;
  };
  const closestTo = (list, target) =>
    list.reduce((best, r) => (!best || Math.abs(r.dist - target) < Math.abs(best.dist - target) ? r : best), null);

  const altar = roomy(free(), 42).reduce((best, r) => (!best || r.dist > best.dist ? r : best), null);
  setType(altar, 'altar');
  setType(closestTo(roomy(free(), 30), maxDist * 0.5), 'library');
  setType(closestTo(free(), maxDist * 0.7), 'stairwell');

  const pools = { large: [], medium: [], small: [] };
  for (const [key, t] of Object.entries(ROOM_TYPES)) if (pools[t.size]) pools[t.size].push(key);
  for (const p of Object.values(pools)) rng.shuffle(p);

  const rest = free().sort((a, b) => b.area - a.area);
  const used = {};
  rest.forEach((r, i) => {
    const cls = i < rest.length / 3 ? 'large' : i < (2 * rest.length) / 3 ? 'medium' : 'small';
    const order = [cls, 'medium', 'large', 'small'];
    let type = null;
    for (const c of order) if (pools[c].length) { type = pools[c].pop(); break; }
    if (!type) type = rng.pick(['guest_bedroom', 'servants', 'parlor']);
    used[type] = (used[type] || 0) + 1;
    setType(r, type, used[type]);
  });
  return { foyer, altar };
}

const ROMAN = ['', '', ' II', ' III', ' IV', ' V'];
function setType(room, type, nth = 1) {
  room.type = type;
  room.name = ROOM_TYPES[type].name + (ROMAN[nth] ?? ` ${nth}`);
}

// ---------------------------------------------------------------------------
// Basement template

function buildBasement(nextId) {
  const g = new FloorGrid(1, 'Basement', BASEMENT_W, BASEMENT_H);
  const rooms = [
    makeRoom(nextId(), 1, 2, 2, 8, 7),
    makeRoom(nextId(), 1, 15, 2, 11, 8),
    makeRoom(nextId(), 1, 2, 14, 10, 8),
    makeRoom(nextId(), 1, 16, 14, 8, 8),
    makeRoom(nextId(), 1, 27, 15, 5, 5),
  ];
  const [ante, crypt, wine, ossuary, cell] = rooms;
  setType(ante, 'antechamber');
  setType(crypt, 'crypt');
  setType(wine, 'wine_cellar');
  setType(ossuary, 'ossuary');
  setType(cell, 'cell');
  for (const r of rooms) g.carveRoom(r);

  g.carveCorridor({ x: ante.cx, y: ante.cy }, { x: crypt.cx, y: crypt.cy }, 2, true);
  g.carveCorridor({ x: ante.cx, y: ante.cy }, { x: wine.cx, y: wine.cy }, 1, true);
  g.carveCorridor({ x: crypt.cx, y: crypt.cy }, { x: ossuary.cx, y: ossuary.cy }, 1, false);
  g.carveCorridor({ x: wine.cx, y: wine.cy }, { x: ossuary.cx, y: ossuary.cy }, 2, true);
  // The only way into the Cell: a one-tile passage ending in the gate.
  const gateY = cell.cy;
  g.carveH(ossuary.x + ossuary.w, cell.x - 1, gateY, 1);
  g.markDoors();
  return { grid: g, rooms, ante, cell, gate: { x: cell.x - 1, y: gateY } };
}

// ---------------------------------------------------------------------------
// Public API

export function generateMansion(seed) {
  seed = seed >>> 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const map = tryGenerate(createRng(seed + attempt * 7919), seed);
    if (map) return map;
  }
  throw new Error(`Mansion generation failed for seed ${seed}`);
}

function tryGenerate(rng, seed) {
  let roomCounter = 0;
  const nextId = () => roomCounter++;

  // Ground floor
  const ground = new FloorGrid(0, 'Ground Floor', GROUND_W, GROUND_H);
  const leaves = [];
  const root = splitBSP(rng, { x: 0, y: 0, w: GROUND_W, h: GROUND_H }, 0, leaves);
  const groundRooms = leaves.map((leaf) => (leaf.room = makeRoomInLeaf(rng, leaf, nextId(), 0)));
  if (groundRooms.length < 11) return null;
  for (const r of groundRooms) ground.carveRoom(r);
  const links = new Set();
  connectTree(rng, ground, root, links);
  const loopCandidates = [];
  for (let i = 0; i < groundRooms.length; i++) {
    for (let j = i + 1; j < groundRooms.length; j++) {
      const a = groundRooms[i], b = groundRooms[j];
      if (!links.has(linkKey(a, b)) && manhattan(a, b) < 24) loopCandidates.push([a, b]);
    }
  }
  rng.shuffle(loopCandidates);
  for (const [a, b] of loopCandidates.slice(0, 3)) link(rng, ground, a, b, links);
  ground.markDoors();
  const { foyer, altar } = assignGroundRooms(rng, ground, groundRooms);

  // Basement
  const basement = buildBasement(nextId);
  const rooms = groundRooms.concat(basement.rooms);
  const grids = [ground, basement.grid];

  const placer = new Placer(rng, grids, [[foyer.cx, foyer.cy], [basement.ante.cx, basement.ante.cy]]);
  for (const r of rooms) placer.reserveDoorways(r);
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) placer.reserve(0, foyer.cx + ox, foyer.cy + oy);
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) placer.reserve(1, basement.cell.cx + ox, basement.cell.cy + oy);

  // --- Key props
  const byType = (t) => rooms.find((r) => r.type === t);
  const library = byType('library');
  const stairwell = byType('stairwell');

  const tome = placer.placeAny(library, 'tome', [
    { x: library.cx, y: library.cy, dir: 2, wall: false },
    ...placer.centerSlots(library),
  ]);
  if (!tome) return null;

  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) placer.reserve(0, altar.cx + ox, altar.cy + oy);
  const altarProp = placer.place(altar, 'altar', { x: altar.cx, y: altar.cy, dir: 2, wall: false, ignoreReserved: true });
  if (!altarProp) return null;
  placer.place(altar, 'ritualcircle', { x: altar.cx, y: altar.cy, dir: 0, wall: false });
  placer.place(altar, 'candles', { x: altar.cx, y: altar.cy, dir: 0, wall: false }, { light: '#ff6a3a' });

  const stairsDown = placer.placeOnWall(stairwell, 'stairs_down');
  if (!stairsDown) return null;
  const ante = basement.ante;
  const stairsUp = placer.placeAny(ante, 'stairs_up', placer.wallSlots(ante).filter((s) => s.dir === 2));
  if (!stairsUp) return null;
  stairsDown.target = { floor: 1, x: stairsUp.front.x, z: stairsUp.front.z, yaw: yawFromDir(...DIRS[stairsUp.dir]) };
  stairsUp.target = { floor: 0, x: stairsDown.front.x, z: stairsDown.front.z, yaw: yawFromDir(...DIRS[stairsDown.dir]) };

  const gateProp = placer.place(null, 'gate', { x: basement.gate.x, y: basement.gate.y, dir: 3, wall: false }, { floor: 1 });
  if (!gateProp) return null;
  placer.place(basement.cell, 'candles', { x: basement.cell.cx, y: basement.cell.cy, dir: 0, wall: false }, { light: '#b0141e' });

  // --- Hearts: six rooms, six disguises
  const groundCandidates = rng.shuffle(groundRooms.filter((r) => r !== foyer && r !== altar && r !== stairwell && r !== library));
  const basementCandidates = rng.shuffle(basement.rooms.filter((r) => ['crypt', 'wine_cellar', 'ossuary'].includes(r.type)));
  const heartRooms = groundCandidates.slice(0, HEART_COUNT);
  if (rng.chance(0.4)) heartRooms[HEART_COUNT - 1] = basementCandidates[0];
  const spareRooms = groundCandidates.slice(HEART_COUNT).concat([library, stairwell]);

  const hearts = [];
  const types = rng.shuffle([...HEART_TYPE_IDS]);
  for (const type of types) {
    let placed = null;
    const tryRooms = [heartRooms.shift(), ...spareRooms].filter(Boolean);
    for (const r of tryRooms) {
      placed = placer.placeOnWall(r, HEART_TYPES[type].prop, { heart: type });
      if (placed) {
        const si = spareRooms.indexOf(r);
        if (si >= 0) spareRooms.splice(si, 1);
        hearts.push({
          id: `heart_${type}`,
          type,
          name: HEART_TYPES[type].name,
          propId: placed.id,
          roomId: r.id,
          roomName: r.name,
          floor: r.floor,
          clue: makeClue(type, r.type),
        });
        break;
      }
    }
    if (!placed) return null;
  }

  // --- Decoys: ordinary twins of each heart scattered elsewhere
  const decoyRooms = rooms.filter((r) => r !== altar && r.type !== 'cell' && r.type !== 'antechamber');
  for (const type of HEART_TYPE_IDS) {
    const heartRoom = hearts.find((h) => h.type === type).roomId;
    const count = rng.int(2, 3);
    const candidates = rng.shuffle(decoyRooms.filter((r) => r.id !== heartRoom));
    let n = 0;
    for (const r of candidates) {
      if (n >= count) break;
      if (placer.placeOnWall(r, HEART_TYPES[type].prop, { decoy: type })) n++;
    }
  }

  // --- Furniture
  for (const r of rooms) placer.furnish(r);

  // --- Spawns
  const ring = [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]];
  const spawn = {
    floor: 0,
    yaw: 0,
    points: ring.map(([ox, oz]) => ({ x: tileCenter(foyer.cx) + ox, z: tileCenter(foyer.cy) + oz })),
  };
  const cellRoom = basement.cell;
  const cell = {
    floor: 1,
    roomId: cellRoom.id,
    yaw: Math.PI / 2,
    points: ring.map(([ox, oz]) => ({ x: tileCenter(cellRoom.cx) + ox, z: tileCenter(cellRoom.cy) + oz })),
  };

  return {
    version: 1,
    seed,
    tile: TILE,
    floors: grids.map((g) => g.toJSON()),
    rooms: rooms.map(({ dist, ...r }) => r),
    props: placer.props,
    hearts,
    spawn,
    cell,
    ids: {
      foyer: foyer.id,
      altarRoom: altar.id,
      tome: tome.id,
      altar: altarProp.id,
      stairsDown: stairsDown.id,
      stairsUp: stairsUp.id,
      gate: gateProp.id,
    },
  };
}

/** Copy of the map safe to send to clients: hearts look exactly like decoys. */
export function publicMap(map) {
  return {
    ...map,
    hearts: undefined,
    props: map.props.map(({ heart, decoy, ...p }) => p),
  };
}

export function roomAt(map, floor, x, z) {
  const f = map.floors[floor];
  const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
  if (tx < 0 || ty < 0 || tx >= f.w || ty >= f.h) return null;
  const id = f.roomIds[ty * f.w + tx];
  return id >= 0 ? map.rooms[id] : null;
}
