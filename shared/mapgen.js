// Procedural Gothic mansion generator: two stories above ground and a basement.
//
// Floor 1 (ground, id 0): binary-space-partition rooms joined by corridors
//   (plus extra loops so chases never dead-end). The Grand Foyer, Chapel,
//   Library, Banquet Hall, Armory Hall, Nursery, the Servants' Stairwell down
//   to the basement and the West Stair Hall up to Floor 2.
// Floor 2 (upper story, id 2): its own BSP layout around the Balcony Gallery,
//   which rings an open void directly over the Foyer (you can look down into
//   the Foyer, and up into the gallery). Rooms are joined by a spanning tree
//   plus loops. Two spiral stairs climb from the Foyer to the gallery, a third
//   from the West Stair Hall to the Upper Stair Landing: the pair of each
//   staircase share one tile column, so it really goes up through the ceiling.
// Basement (id 1): an authored template holding the Crypt, Wine Cellar,
//   Ossuary and the single-gated Underground Cage Prison.
//
// Seven Hearts hide on Floors 1 and 2, each in a room with a 3-part task
// (braziers, rune mirrors, clockwork pedestals, chalices) that unseals it.
//
// The output is plain JSON (see ARCHITECTURE.md "Map format") so the server can
// send it straight to clients. Everything here is deterministic for a seed.

import { createRng } from './rng.js';
import {
  TILE, TILE_WALL, TILE_FLOOR, TILE_DOOR, TILE_VOID, FLOOR, FLOOR_Y, DIRS, HEART_COUNT,
  tileCenter, propRotFromDir, yawFromDir,
} from './constants.js';
import { ROOM_TYPES, HEART_TYPES, HEART_TYPE_IDS, TASKS, TASK_KINDS, TASK_STEPS, makeClue } from './lore.js';
import { PROP_DEFS } from './propdefs.js';

const W = 60;
const H = 60;
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
  open(x, y) { const t = this.tile(x, y); return t !== TILE_WALL && t !== TILE_VOID; }
  walkable(x, y) { return this.open(x, y) && !this.blocked[this.idx(x, y)]; }

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
          if (this.room(x + dx, y + dy) >= 0 && this.open(x + dx, y + dy)) { this.tiles[i] = TILE_DOOR; break; }
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
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t !== TILE_WALL && t !== TILE_VOID && !this.blocked[i]) total++;
    }
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
// BSP layout

function splitBSP(rng, node, depth, leaves, minLeaf = MIN_LEAF) {
  const MIN_LEAF = minLeaf;
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
  for (const c of node.children) splitBSP(rng, c, depth + 1, leaves, minLeaf);
  return node;
}

function roomInLeaf(rng, leaf, floor) {
  const rw = rng.int(Math.max(5, Math.floor((leaf.w - 2) * 0.6)), leaf.w - 2);
  const rh = rng.int(Math.max(5, Math.floor((leaf.h - 2) * 0.6)), leaf.h - 2);
  const x = leaf.x + rng.int(1, leaf.w - rw - 1);
  const y = leaf.y + rng.int(1, leaf.h - rh - 1);
  return makeRoom(-1, floor, x, y, rw, rh);
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
const linkKey = (a, b) => (a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`);

/** Where a corridor toward `other` leaves room `r` (rooms with a void use their rim). */
function anchorOf(r, other) {
  if (!r.rim) return { x: r.cx, y: r.cy };
  let best = null;
  for (const t of r.rim) {
    const d = Math.abs(t.x - other.cx) + Math.abs(t.y - other.cy);
    if (!best || d < best.d) best = { t, d };
  }
  return best.t;
}

function link(rng, grid, a, b, links) {
  const wd = rng.chance(0.4) ? 2 : 1;
  grid.carveCorridor(anchorOf(a, b), anchorOf(b, a), wd, rng.chance(0.5));
  links.add(linkKey(a, b));
}

/** Ground floor: join the BSP siblings bottom-up (the original Step 2 layout). */
function connectTree(rng, grid, node, links) {
  if (!node.children) return node.room ? [node.room] : [];
  const a = connectTree(rng, grid, node.children[0], links);
  const b = connectTree(rng, grid, node.children[1], links);
  if (!a.length || !b.length) return a.concat(b);
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

/** Any room set: a minimum spanning tree (Prim) by room distance. */
function connectSpanning(rng, grid, rooms, links) {
  const inTree = new Set([rooms[0]]);
  while (inTree.size < rooms.length) {
    let best = null;
    for (const a of inTree) {
      for (const b of rooms) {
        if (inTree.has(b)) continue;
        const d = manhattan(a, b);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    link(rng, grid, best.a, best.b, links);
    inTree.add(best.b);
  }
}

function addLoops(rng, grid, rooms, links, count, maxDist) {
  const candidates = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      if (!links.has(linkKey(a, b)) && manhattan(a, b) < maxDist) candidates.push([a, b]);
    }
  }
  rng.shuffle(candidates);
  for (const [a, b] of candidates.slice(0, count)) link(rng, grid, a, b, links);
}

const overlaps = (r, box) => r.x <= box.x1 && r.x + r.w - 1 >= box.x0 && r.y <= box.y1 && r.y + r.h - 1 >= box.y0;

// ---------------------------------------------------------------------------
// Room furnishing recipes: [kind, strategy, min, max]

const RECIPES = {
  // Floor 1
  foyer: [['statue', 'inset', 2, 4], ['armchair', 'wall', 1, 2], ['cabinet', 'wall', 1, 1], ['painting', 'wall', 1, 2], ['rug', 'rug', 1, 1]],
  library: [['bookshelf', 'wall', 6, 12], ['desk', 'wall', 1, 1], ['armchair', 'wall', 1, 2], ['chair', 'center', 1, 2], ['chandelier', 'chandelier', 0, 1]],
  altar: [['pillar', 'inset', 4, 4], ['statue', 'wall', 1, 2], ['sconce', 'wall', 2, 4]],
  stairwell: [['crate', 'wall', 1, 2], ['cabinet', 'wall', 0, 1], ['sconce', 'wall', 1, 2]],
  stairhall: [['statue', 'wall', 1, 2], ['sconce', 'wall', 2, 3], ['painting', 'wall', 1, 2], ['armchair', 'wall', 0, 1], ['rug', 'rug', 0, 1]],
  banquet: [['longtable', 'longtable', 1, 1], ['cabinet', 'wall', 1, 2], ['fireplace', 'wall', 0, 1], ['painting', 'wall', 1, 2], ['chandelier', 'chandelier', 1, 1]],
  armory: [['armor', 'wall', 3, 6], ['weaponrack', 'wall', 1, 3], ['statue', 'center', 0, 1], ['sconce', 'wall', 1, 2], ['rug', 'rug', 0, 1]],
  nursery: [['crib', 'wall', 1, 2], ['rockinghorse', 'center', 0, 1], ['cabinet', 'wall', 0, 1], ['chair', 'wall', 0, 1]],
  conservatory: [['plant', 'wall', 4, 8], ['plant', 'center', 1, 3], ['table', 'center', 0, 1], ['chair', 'center', 0, 2]],
  music: [['piano', 'wall', 1, 1], ['chair', 'center', 2, 4], ['cabinet', 'wall', 0, 1], ['painting', 'wall', 0, 1], ['rug', 'rug', 0, 1]],
  parlor: [['armchair', 'wall', 2, 4], ['table', 'center', 1, 1], ['fireplace', 'wall', 0, 1], ['cabinet', 'wall', 1, 1], ['rug', 'rug', 1, 1]],
  billiard: [['billiard', 'center', 1, 1], ['cabinet', 'wall', 1, 2], ['chair', 'wall', 1, 2], ['antlers', 'wall', 0, 1]],
  trophy: [['antlers', 'wall', 3, 6], ['statue', 'center', 0, 2], ['cabinet', 'wall', 1, 2], ['armchair', 'wall', 0, 1]],
  kitchen: [['stove', 'wall', 1, 2], ['table', 'center', 1, 2], ['cabinet', 'wall', 2, 3], ['barrel', 'wall', 1, 2]],
  servants: [['bed', 'wall', 1, 2], ['cabinet', 'wall', 0, 1], ['chair', 'wall', 0, 1]],
  washroom: [['bathtub', 'wall', 1, 1], ['cabinet', 'wall', 0, 1]],
  smoking: [['armchair', 'wall', 2, 3], ['table', 'center', 0, 1], ['cabinet', 'wall', 0, 1]],
  drawing_room: [['armchair', 'wall', 2, 4], ['piano', 'wall', 0, 1], ['table', 'center', 1, 1], ['painting', 'wall', 1, 2], ['rug', 'rug', 1, 1], ['chandelier', 'chandelier', 0, 1]],
  pantry: [['cabinet', 'wall', 2, 3], ['barrel', 'wall', 1, 2], ['crate', 'wall', 0, 2]],
  cloakroom: [['wardrobe', 'wall', 1, 2], ['cabinet', 'wall', 1, 1], ['chair', 'wall', 0, 1]],
  gun_room: [['weaponrack', 'wall', 1, 2], ['antlers', 'wall', 1, 3], ['cabinet', 'wall', 1, 1], ['table', 'center', 0, 1]],
  // Floor 2
  gallery: [['painting', 'wall', 3, 6], ['sconce', 'wall', 2, 4], ['chandelier', 'chandelier', 1, 1]],
  landing: [['statue', 'wall', 1, 2], ['sconce', 'wall', 1, 2], ['painting', 'wall', 1, 2], ['plant', 'wall', 0, 1]],
  ballroom: [['pillar', 'inset', 4, 4], ['piano', 'wall', 1, 1], ['chair', 'wall', 2, 4], ['statue', 'wall', 0, 1], ['chandelier', 'chandelier', 1, 1]],
  master_study: [['desk', 'wall', 1, 1], ['bookshelf', 'wall', 2, 4], ['globe', 'center', 0, 1], ['armchair', 'wall', 1, 1], ['fireplace', 'wall', 0, 1], ['rug', 'rug', 0, 1]],
  rose_bedroom: [['bed', 'wall', 1, 1], ['wardrobe', 'wall', 1, 1], ['plant', 'wall', 2, 3], ['armchair', 'wall', 0, 1], ['rug', 'rug', 1, 1]],
  observatory: [['telescope', 'center', 1, 1], ['globe', 'center', 0, 1], ['bookshelf', 'wall', 1, 2], ['desk', 'wall', 0, 1], ['chair', 'wall', 1, 2]],
  alchemy: [['alembic', 'wall', 1, 2], ['cauldron', 'center', 1, 1], ['bookshelf', 'wall', 1, 3], ['cabinet', 'wall', 1, 1], ['candles', 'candles', 0, 1]],
  master_bedroom: [['bed', 'wall', 1, 1], ['wardrobe', 'wall', 1, 2], ['fireplace', 'wall', 0, 1], ['armchair', 'wall', 0, 1], ['rug', 'rug', 1, 1]],
  portrait_hall: [['painting', 'wall', 5, 9], ['statue', 'center', 1, 2], ['armchair', 'wall', 0, 1], ['rug', 'rug', 0, 1]],
  guest_bedroom: [['bed', 'wall', 1, 1], ['wardrobe', 'wall', 0, 1], ['chair', 'wall', 0, 1]],
  sewing: [['table', 'center', 1, 1], ['chair', 'center', 0, 2], ['cabinet', 'wall', 1, 2]],
  marble_bath: [['bathtub', 'wall', 1, 2], ['cabinet', 'wall', 0, 1], ['plant', 'wall', 0, 2]],
  linen: [['cabinet', 'wall', 2, 3], ['wardrobe', 'wall', 0, 1], ['crate', 'wall', 0, 1]],
  clock_room: [['clock', 'wall', 2, 3], ['cabinet', 'wall', 1, 2], ['desk', 'wall', 0, 1], ['chair', 'center', 0, 1]],
  reading_room: [['bookshelf', 'wall', 3, 6], ['armchair', 'wall', 1, 3], ['table', 'center', 0, 1], ['rug', 'rug', 0, 1]],
  map_room: [['globe', 'center', 1, 1], ['desk', 'wall', 1, 1], ['cabinet', 'wall', 1, 2], ['painting', 'wall', 1, 2]],
  dressing_room: [['wardrobe', 'wall', 2, 3], ['mirror', 'wall', 0, 1], ['chair', 'wall', 0, 1]],
  card_room: [['table', 'center', 1, 1], ['chair', 'center', 1, 3], ['cabinet', 'wall', 0, 1]],
  // Basement
  antechamber: [['crate', 'wall', 2, 4], ['barrel', 'wall', 0, 2], ['sconce', 'wall', 1, 2]],
  crypt: [['coffin', 'center', 2, 4], ['sarcophagus', 'center', 1, 2], ['statue', 'wall', 0, 2], ['candles', 'candles', 1, 2]],
  wine_cellar: [['barrel', 'wall', 5, 9], ['crate', 'wall', 1, 3], ['crate', 'center', 0, 2]],
  ossuary: [['statue', 'wall', 1, 2], ['crate', 'wall', 1, 2], ['coffin', 'wall', 1, 2], ['candles', 'candles', 1, 1]],
  cell: [['shackles', 'wall', 3, 4], ['ritualcircle', 'circle', 1, 1]],
};

/** Rooms that get stained-glass moonlight windows. */
const WINDOWED = new Set(['foyer', 'altar', 'library', 'banquet', 'ballroom', 'gallery', 'observatory', 'master_study',
  'rose_bedroom', 'portrait_hall', 'conservatory', 'music', 'master_bedroom', 'stairhall', 'landing']);

// ---------------------------------------------------------------------------
// Prop placement

class Placer {
  constructor(rng, grids, anchors) {
    this.rng = rng;
    this.grids = grids; // indexed by floor id
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
            if (g.open(x + ox, y + oy) && g.room(x + ox, y + oy) !== room.id) { nearOpening = true; break; }
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
        if (!g.open(x, y)) continue;
        for (let d = 0; d < 4; d++) {
          const [dx, dy] = DIRS[d];
          if (g.tile(x + dx, y + dy) === TILE_WALL) slots.push({ x, y, dir: (d + 2) % 4, wall: true });
        }
      }
    }
    return this.rng.shuffle(slots);
  }

  centerSlots(room) {
    const g = this.grids[room.floor];
    const slots = [];
    for (let y = room.y + 2; y <= room.y + room.h - 3; y++) {
      for (let x = room.x + 2; x <= room.x + room.w - 3; x++) {
        if (g.open(x, y)) slots.push({ x, y, dir: this.rng.int(0, 3), wall: false });
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
  place(room, kind, slot, extra = {}, dryRun = false) {
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
        if (!g.inb(fx, fy) || !g.open(fx, fy)) return null;
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
      const ok = g.connectedFrom(ax, ay);
      if (!ok || dryRun) for (const [fx, fy] of footprint) g.blocked[g.idx(fx, fy)] = 0;
      if (!ok) return null;
    }
    if (dryRun) return true;
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
// Room types

const ROMAN = ['', '', ' II', ' III', ' IV', ' V'];
function setType(room, type, nth = 1) {
  room.type = type;
  room.name = ROOM_TYPES[type].name + (ROMAN[nth] ?? ` ${nth}`);
}

/** Fill untyped rooms from the sized pools of one floor ('ground' | 'upper'). */
function fillPools(rng, rooms, floorKey, fallback) {
  const pools = { large: [], medium: [], small: [] };
  for (const [key, t] of Object.entries(ROOM_TYPES)) if (t.floor === floorKey && pools[t.size]) pools[t.size].push(key);
  for (const p of Object.values(pools)) rng.shuffle(p);
  const rest = rooms.filter((r) => !r.type).sort((a, b) => b.area - a.area);
  const used = {};
  rest.forEach((r, i) => {
    const cls = i < rest.length / 3 ? 'large' : i < (2 * rest.length) / 3 ? 'medium' : 'small';
    let type = null;
    for (const c of [cls, 'medium', 'large', 'small']) if (pools[c].length) { type = pools[c].pop(); break; }
    if (!type) type = rng.pick(fallback);
    used[type] = (used[type] || 0) + 1;
    setType(r, type, used[type]);
  });
}

// ---------------------------------------------------------------------------
// Floor 1 (ground)

function buildGround(rng, nextId) {
  const g = new FloorGrid(FLOOR.GROUND, 'Floor 1', W, H);
  const leaves = [];
  const root = splitBSP(rng, { x: 0, y: 0, w: W, h: H }, 0, leaves);
  const rooms = leaves.map((leaf) => {
    leaf.room = roomInLeaf(rng, leaf, FLOOR.GROUND);
    leaf.room.id = nextId();
    return leaf.room;
  });
  if (rooms.length < 12) return null;
  for (const r of rooms) g.carveRoom(r);
  const links = new Set();
  connectTree(rng, g, root, links);
  addLoops(rng, g, rooms, links, 3, 24);
  g.markDoors();

  // The Foyer: the big room nearest the front (south) of the house.
  const half = W / 2;
  const foyer = rooms.filter((r) => r.w >= 6 && r.h >= 6).reduce((best, r) => {
    const score = r.y + r.h - 0.3 * Math.abs(r.cx - half);
    return !best || score > best.score ? { r, score } : best;
  }, null)?.r;
  if (!foyer) return null;
  setType(foyer, 'foyer');
  return { grid: g, rooms, foyer };
}

// ---------------------------------------------------------------------------
// Floor 2 (upper story)

function buildUpper(rng, nextId, foyer) {
  const g = new FloorGrid(FLOOR.UPPER, 'Floor 2', W, H);
  // The Balcony Gallery: a ring over the Foyer (and its walls) around an open void.
  const gx0 = Math.max(1, foyer.x - 1), gy0 = Math.max(1, foyer.y - 1);
  const gx1 = Math.min(W - 2, foyer.x + foyer.w), gy1 = Math.min(H - 2, foyer.y + foyer.h);
  const keepOut = { x0: gx0 - 3, y0: gy0 - 3, x1: gx1 + 3, y1: gy1 + 3 };
  const leaves = [];
  splitBSP(rng, { x: 0, y: 0, w: W, h: H }, 0, leaves, 12);
  const candidates = leaves.map((leaf) => roomInLeaf(rng, leaf, FLOOR.UPPER)).filter((r) => !overlaps(r, keepOut));
  if (candidates.length < 8) return null;

  const gallery = makeRoom(nextId(), FLOOR.UPPER, gx0, gy0, gx1 - gx0 + 1, gy1 - gy0 + 1);
  setType(gallery, 'gallery');
  const voidBox = { x0: foyer.x + 1, y0: foyer.y + 1, x1: foyer.x + foyer.w - 2, y1: foyer.y + foyer.h - 2 };
  gallery.void = voidBox;
  gallery.rim = [];
  for (let y = gallery.y; y < gallery.y + gallery.h; y++) {
    for (let x = gallery.x; x < gallery.x + gallery.w; x++) {
      const inVoid = x >= voidBox.x0 && x <= voidBox.x1 && y >= voidBox.y0 && y <= voidBox.y1;
      const edge = x === gallery.x || y === gallery.y || x === gallery.x + gallery.w - 1 || y === gallery.y + gallery.h - 1;
      if (!inVoid && edge) gallery.rim.push({ x, y });
    }
  }
  const rooms = [gallery];
  for (const r of candidates) {
    r.id = nextId();
    rooms.push(r);
  }
  for (const r of rooms) g.carveRoom(r);
  const links = new Set();
  connectSpanning(rng, g, rooms, links);
  addLoops(rng, g, rooms, links, 4, 26);
  for (let y = voidBox.y0; y <= voidBox.y1; y++) {
    for (let x = voidBox.x0; x <= voidBox.x1; x++) g.tiles[g.idx(x, y)] = TILE_VOID;
  }
  g.markDoors();
  const a = gallery.rim[0];
  if (!g.connectedFrom(a.x, a.y)) return null;
  return { grid: g, rooms, gallery };
}

// ---------------------------------------------------------------------------
// Basement template

function buildBasement(nextId) {
  const g = new FloorGrid(FLOOR.BASEMENT, 'Basement', BASEMENT_W, BASEMENT_H);
  const rooms = [
    makeRoom(nextId(), FLOOR.BASEMENT, 2, 2, 8, 7),
    makeRoom(nextId(), FLOOR.BASEMENT, 15, 2, 11, 8),
    makeRoom(nextId(), FLOOR.BASEMENT, 2, 14, 10, 8),
    makeRoom(nextId(), FLOOR.BASEMENT, 16, 14, 8, 8),
    makeRoom(nextId(), FLOOR.BASEMENT, 27, 15, 5, 5),
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
  // The only way into the Cage: a one-tile passage ending in the cage door.
  const gateY = cell.cy;
  g.carveH(ossuary.x + ossuary.w, cell.x - 1, gateY, 1);
  g.markDoors();
  return { grid: g, rooms, ante, cell, gate: { x: cell.x - 1, y: gateY } };
}

// ---------------------------------------------------------------------------
// Stairs

/** Link two stair props both ways: using one puts you at the other's front. */
function pairStairs(a, b, labelA, labelB) {
  a.target = { floor: b.floor, x: b.front.x, z: b.front.z, yaw: yawFromDir(...DIRS[b.dir]) };
  b.target = { floor: a.floor, x: a.front.x, z: a.front.z, yaw: yawFromDir(...DIRS[a.dir]) };
  a.link = b.id;
  b.link = a.id;
  a.label = labelA;
  b.label = labelB;
}

/**
 * Tiles in `room` (Floor 1) whose column also lands inside an Floor-2 room
 * (other than the gallery), with a free front tile on both floors: a spiral
 * stair can rise straight through the ceiling there.
 */
function spiralSpots(ground, upper, room, gallery) {
  const out = [];
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      const ur = upper.room(x, y);
      if (ur < 0 || ur === gallery.id || !upper.open(x, y) || !ground.open(x, y)) continue;
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = DIRS[d];
        if (ground.room(x + dx, y + dy) === room.id && upper.room(x + dx, y + dy) === ur && upper.open(x + dx, y + dy)) {
          out.push({ x, y, dir: d, upperRoom: ur });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API

export function generateMansion(seed) {
  seed = seed >>> 0;
  for (let attempt = 0; attempt < 60; attempt++) {
    const map = tryGenerate(createRng(seed + attempt * 7919), seed);
    if (map) return map;
  }
  throw new Error(`Mansion generation failed for seed ${seed}`);
}

function tryGenerate(rng, seed) {
  let roomCounter = 0;
  const nextId = () => roomCounter++;

  const groundL = buildGround(rng, nextId);
  if (!groundL) return null;
  const { grid: ground, foyer } = groundL;
  const groundRooms = groundL.rooms;
  const upperL = buildUpper(rng, nextId, foyer);
  if (!upperL) return null;
  const { grid: upper, gallery } = upperL;
  const upperRooms = upperL.rooms;
  const basement = buildBasement(nextId);
  const rooms = [...groundRooms, ...upperRooms, ...basement.rooms].sort((a, b) => a.id - b.id);
  const grids = [];
  grids[FLOOR.GROUND] = ground;
  grids[FLOOR.BASEMENT] = basement.grid;
  grids[FLOOR.UPPER] = upper;

  // ---- Floor 1 room types
  const dist = ground.distances(foyer.cx, foyer.cy);
  for (const r of groundRooms) r.dist = dist[ground.idx(r.cx, r.cy)];
  const maxDist = Math.max(...groundRooms.map((r) => r.dist));
  const freeG = () => groundRooms.filter((r) => !r.type);
  const roomy = (list, minArea) => {
    const big = list.filter((r) => r.area >= minArea);
    return big.length ? big : list;
  };
  const closestTo = (list, target) =>
    list.reduce((best, r) => (!best || Math.abs(r.dist - target) < Math.abs(best.dist - target) ? r : best), null);
  const altar = roomy(freeG(), 42).reduce((best, r) => (!best || r.dist > best.dist ? r : best), null);
  setType(altar, 'altar');
  // The West Stair Hall: far from the Foyer, under a Floor-2 room the spiral can rise into.
  const stairCands = freeG()
    .map((r) => ({ r, spots: spiralSpots(ground, upper, r, gallery) }))
    .filter((c) => c.spots.length)
    .sort((a, b) => b.r.dist - a.r.dist);
  if (!stairCands.length) return null;
  const stairhall = stairCands[0].r;
  setType(stairhall, 'stairhall');
  setType(closestTo(roomy(freeG(), 30), maxDist * 0.5), 'library');
  setType(closestTo(freeG(), maxDist * 0.7), 'stairwell');
  const bySize = () => freeG().sort((a, b) => b.area - a.area);
  setType(bySize()[0], 'banquet');
  setType(bySize()[Math.min(1, bySize().length - 1)], 'armory');
  setType(bySize().at(-1), 'nursery');
  fillPools(rng, groundRooms, 'ground', ['parlor', 'servants', 'smoking']);

  // ---- Basement + placer
  const galleryAnchor = gallery.rim.find((t) => upper.walkable(t.x, t.y));
  const anchors = [];
  anchors[FLOOR.GROUND] = [foyer.cx, foyer.cy];
  anchors[FLOOR.BASEMENT] = [basement.ante.cx, basement.ante.cy];
  anchors[FLOOR.UPPER] = [galleryAnchor.x, galleryAnchor.y];
  const placer = new Placer(rng, grids, anchors);
  for (const r of rooms) placer.reserveDoorways(r);
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) placer.reserve(FLOOR.GROUND, foyer.cx + ox, foyer.cy + oy);
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) placer.reserve(FLOOR.BASEMENT, basement.cell.cx + ox, basement.cell.cy + oy);

  // ---- The spiral to Floor 2 (West Stair Hall ↔ Upper Stair Landing)
  let spiral = null;
  for (const spot of rng.shuffle(stairCands[0].spots.slice())) {
    const landingRoom = upperRooms.find((r) => r.id === spot.upperRoom);
    const slot = { x: spot.x, y: spot.y, dir: spot.dir, wall: false };
    if (!placer.place(landingRoom, 'stairs_landing', slot, {}, true)) continue;
    const a = placer.place(stairhall, 'grand_stair', slot);
    if (!a) continue;
    const b = placer.place(landingRoom, 'stairs_landing', slot);
    if (!b) return null;
    spiral = { a, b, landingRoom };
    break;
  }
  if (!spiral) return null;
  setType(spiral.landingRoom, 'landing');

  // ---- Floor 2 room types
  const freeU = () => upperRooms.filter((r) => !r.type).sort((a, b) => b.area - a.area);
  if (freeU().length < 6) return null;
  setType(freeU()[0], 'ballroom');
  const specials = rng.shuffle(['observatory', 'alchemy', 'master_study', 'rose_bedroom']);
  for (const type of specials) setType(rng.pick(freeU().slice(0, 4)), type);
  fillPools(rng, upperRooms, 'upper', ['guest_bedroom', 'linen', 'sewing']);

  pairStairs(spiral.a, spiral.b, 'Climb the family stair to Floor 2', 'Descend the family stair to Floor 1');

  // ---- The Grand Foyer's dual spiral staircases up to the Balcony Gallery.
  // Each rises from a Foyer edge tile to the same tile of the gallery's rim.
  const foyerSpots = [];
  for (let y = foyer.y; y < foyer.y + foyer.h; y++) {
    for (let x = foyer.x; x < foyer.x + foyer.w; x++) {
      const ex = x === foyer.x || x === foyer.x + foyer.w - 1, ey = y === foyer.y || y === foyer.y + foyer.h - 1;
      if (!(ex || ey) || (ex && ey)) continue; // edge tiles, no corners
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = DIRS[d];
        // A wall behind on Floor 1; that wall's tile is gallery rim on Floor 2.
        if (ground.tile(x - dx, y - dy) !== TILE_WALL) continue;
        if (upper.room(x - dx, y - dy) !== gallery.id || !upper.open(x - dx, y - dy) || !upper.open(x, y)) continue;
        if (ground.room(x + dx, y + dy) !== foyer.id) continue;
        foyerSpots.push({ x, y, dir: d });
      }
    }
  }
  const grand = [];
  // Prefer the back wall (farthest from the front door), as far apart as possible.
  const back = foyerSpots.filter((s) => s.dir === 2);
  const pool = back.length >= 2 ? back : foyerSpots;
  const ordered = pool.slice().sort((p, q) => p.x - q.x || p.y - q.y);
  const tryPair = [ordered[0], ordered.at(-1), ...rng.shuffle(ordered.slice(1, -1))];
  for (const spot of tryPair) {
    if (!spot || grand.length >= 2) continue;
    if (grand.some((gs) => Math.abs(gs.a.tx - spot.x) + Math.abs(gs.a.ty - spot.y) < 4)) continue;
    const up = { x: spot.x, y: spot.y, dir: (spot.dir + 2) % 4, wall: false };
    if (!placer.place(gallery, 'stairs_landing', up, {}, true)) continue;
    const a = placer.place(foyer, 'grand_stair', { x: spot.x, y: spot.y, dir: spot.dir, wall: false });
    if (!a) continue;
    const b = placer.place(gallery, 'stairs_landing', up);
    if (!b) return null;
    pairStairs(a, b, 'Climb the grand staircase to the Balcony Gallery', 'Descend the grand staircase to the Foyer');
    grand.push({ a, b });
  }
  if (grand.length < 2) return null;

  // ---- Key props
  const byType = (t) => rooms.find((r) => r.type === t);
  const library = byType('library');
  const stairwell = byType('stairwell');

  const tome = placer.placeAny(library, 'tome', [
    { x: library.cx, y: library.cy, dir: 2, wall: false },
    ...placer.centerSlots(library),
  ]);
  if (!tome) return null;

  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) placer.reserve(FLOOR.GROUND, altar.cx + ox, altar.cy + oy);
  const altarProp = placer.place(altar, 'altar', { x: altar.cx, y: altar.cy, dir: 2, wall: false, ignoreReserved: true });
  if (!altarProp) return null;
  placer.place(altar, 'ritualcircle', { x: altar.cx, y: altar.cy, dir: 0, wall: false });
  placer.place(altar, 'candles', { x: altar.cx, y: altar.cy, dir: 0, wall: false }, { light: '#ff6a3a' });

  const stairsDown = placer.placeOnWall(stairwell, 'stairs_down');
  if (!stairsDown) return null;
  const ante = basement.ante;
  const stairsUp = placer.placeAny(ante, 'stairs_up', placer.wallSlots(ante).filter((s) => s.dir === 2));
  if (!stairsUp) return null;
  pairStairs(stairsDown, stairsUp, 'Descend the servants’ stair to the Basement', 'Climb the servants’ stair to Floor 1');

  const gateProp = placer.place(null, 'gate', { x: basement.gate.x, y: basement.gate.y, dir: 3, wall: false }, { floor: FLOOR.BASEMENT });
  if (!gateProp) return null;
  placer.place(basement.cell, 'candles', { x: basement.cell.cx, y: basement.cell.cy, dir: 0, wall: false }, { light: '#b0141e' });

  // ---- Hearts: seven rooms on Floors 1 and 2, seven disguises, a task in each room.
  const excluded = new Set(['foyer', 'altar', 'stairwell', 'library', 'stairhall', 'gallery', 'landing']);
  const heartable = (list) => rng.shuffle(list.filter((r) => !excluded.has(r.type) && r.w >= 5 && r.h >= 5))
    .sort((a, b) => (b.area >= 30) - (a.area >= 30));
  const gCands = heartable(groundRooms);
  const uCands = heartable(upperRooms);
  const nGround = Math.min(gCands.length, rng.int(3, 4));
  const heartRooms = [...gCands.slice(0, nGround), ...uCands.slice(0, HEART_COUNT - nGround)];
  if (heartRooms.length < HEART_COUNT) return null;
  const spare = [...gCands.slice(nGround), ...uCands.slice(HEART_COUNT - nGround)];

  const hearts = [];
  const types = rng.shuffle([...HEART_TYPE_IDS]);
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    const ht = HEART_TYPES[type];
    let placed = null, room = null;
    for (const r of [heartRooms[i], ...spare].filter(Boolean)) {
      if (hearts.some((h) => h.roomId === r.id)) continue;
      placed = placer.placeOnWall(r, ht.prop, { heart: type });
      if (placed) {
        room = r;
        const si = spare.indexOf(r);
        if (si >= 0) spare.splice(si, 1);
        break;
      }
    }
    if (!placed) return null;
    // The room's task: three props of one kind.
    const kind = rng.pick(TASK_KINDS);
    const task = TASKS[kind];
    const taskIds = [];
    for (let k = 0; k < TASK_STEPS; k++) {
      const extra = { task: kind, taskOf: type };
      if (task.turns) extra.turns = rng.int(1, 3);
      const slots = task.prop === 'rune_mirror' ? placer.wallSlots(room) : [...placer.centerSlots(room), ...placer.wallSlots(room)];
      const tp = placer.placeAny(room, task.prop, slots, extra);
      if (!tp) return null;
      taskIds.push(tp.id);
    }
    hearts.push({
      id: `heart_${type}`,
      type,
      name: ht.name,
      sin: ht.sin,
      propId: placed.id,
      roomId: room.id,
      roomName: room.name,
      floor: room.floor,
      task: kind,
      tasks: taskIds,
      clue: makeClue(type, room.type),
    });
  }

  // ---- Decoys: ordinary twins of each heart scattered elsewhere
  const decoyRooms = rooms.filter((r) => r !== altar && r.type !== 'cell' && r.type !== 'antechamber' && r !== gallery);
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

  // ---- Stained-glass windows
  for (const r of rooms) {
    if (!WINDOWED.has(r.type)) continue;
    const n = rng.int(1, r.area > 60 ? 3 : 2);
    for (let i = 0; i < n; i++) placer.placeOnWall(r, 'window');
  }

  // ---- Furniture
  for (const r of rooms) placer.furnish(r);

  // ---- Spawns
  const ring = [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]];
  const spawn = {
    floor: FLOOR.GROUND,
    yaw: 0,
    points: ring.map(([ox, oz]) => ({ x: tileCenter(foyer.cx) + ox, z: tileCenter(foyer.cy) + oz })),
  };
  const cellRoom = basement.cell;
  const cell = {
    floor: FLOOR.BASEMENT,
    roomId: cellRoom.id,
    yaw: Math.PI / 2,
    points: ring.map(([ox, oz]) => ({ x: tileCenter(cellRoom.cx) + ox, z: tileCenter(cellRoom.cy) + oz })),
  };

  return {
    version: 2,
    seed,
    tile: TILE,
    floors: grids.map((g) => g.toJSON()),
    rooms: rooms.map(({ dist, rim, ...r }) => r),
    props: placer.props,
    hearts,
    spawn,
    cell,
    stairs: [[spiral.a.id, spiral.b.id], ...grand.map((gs) => [gs.a.id, gs.b.id]), [stairsDown.id, stairsUp.id]],
    ids: {
      foyer: foyer.id,
      gallery: gallery.id,
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
    props: map.props.map(({ heart, decoy, taskOf, ...p }) => p),
  };
}

export function roomAt(map, floor, x, z) {
  const f = map.floors[floor];
  const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
  if (tx < 0 || ty < 0 || tx >= f.w || ty >= f.h) return null;
  const id = f.roomIds[ty * f.w + tx];
  return id >= 0 ? map.rooms[id] : null;
}
