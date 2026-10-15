// A* over a floor's tile grid (8-way, no corner cutting). Used by bot
// teammates now and by the Monster in Step 4.

import { TILE, TILE_WALL, tileCenter } from './constants.js';

export function isPassable(floor, x, y) {
  if (x < 0 || y < 0 || x >= floor.w || y >= floor.h) return false;
  const i = y * floor.w + x;
  return floor.tiles[i] !== TILE_WALL && !floor.blocked[i];
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const NEIGHBORS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * Find a tile path from (sx, sy) to (gx, gy). Returns [[x, y], ...] including
 * the goal (excluding the start), or null. If the goal is impassable the path
 * ends at the nearest passable neighbour.
 */
export function findPath(floor, sx, sy, gx, gy, maxNodes = 6000) {
  if (!isPassable(floor, gx, gy)) {
    let best = null;
    for (const [dx, dy] of NEIGHBORS) {
      if (isPassable(floor, gx + dx, gy + dy)) { best = [gx + dx, gy + dy]; break; }
    }
    if (!best) return null;
    [gx, gy] = best;
  }
  if (sx === gx && sy === gy) return [];
  const w = floor.w;
  const g = new Map();
  const came = new Map();
  const open = new MinHeap();
  const h = (x, y) => {
    const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  const start = sy * w + sx, goal = gy * w + gx;
  g.set(start, 0);
  open.push({ i: start, x: sx, y: sy, f: h(sx, sy) });
  const closed = new Set();
  let expanded = 0;
  while (open.size) {
    const cur = open.pop();
    if (cur.i === goal) {
      const path = [];
      let k = goal;
      while (k !== start) {
        path.push([k % w, Math.floor(k / w)]);
        k = came.get(k);
      }
      return path.reverse();
    }
    if (closed.has(cur.i)) continue;
    closed.add(cur.i);
    if (++expanded > maxNodes) return null;
    const cg = g.get(cur.i);
    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!isPassable(floor, nx, ny)) continue;
      if (dx && dy && (!isPassable(floor, cur.x + dx, cur.y) || !isPassable(floor, cur.x, cur.y + dy))) continue;
      const ni = ny * w + nx;
      const ng = cg + cost;
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng);
        came.set(ni, cur.i);
        open.push({ i: ni, x: nx, y: ny, f: ng + h(nx, ny) });
      }
    }
  }
  return null;
}

/** Convert a tile path into world-space waypoints. */
export const pathToWorld = (path) => path.map(([x, y]) => ({ x: tileCenter(x), z: tileCenter(y) }));

export const toTile = (v) => Math.floor(v / TILE);
