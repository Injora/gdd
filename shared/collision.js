// Circle-vs-world collision shared by the client controller, server-side bots
// and (later) the Monster. Walls are whole tiles; props use their AABB collider.

import { TILE, TILE_WALL } from './constants.js';

/**
 * Build a collision world for a map.
 * @param {object} map               generated mansion
 * @param {(prop) => boolean} [isActive]  for dynamic colliders (e.g. the cell
 *        gate): return false to let players pass through.
 */
export function createCollisionWorld(map, isActive = () => true) {
  const floors = map.floors.map((f) => ({ f, cells: new Map() }));
  for (const p of map.props) {
    if (!p.collider) continue;
    const { x, z, hx, hz } = p.collider;
    const box = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, prop: p };
    const fl = floors[p.floor];
    const tx0 = Math.floor(box.minX / TILE), tx1 = Math.floor(box.maxX / TILE);
    const tz0 = Math.floor(box.minZ / TILE), tz1 = Math.floor(box.maxZ / TILE);
    for (let ty = tz0; ty <= tz1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const k = ty * fl.f.w + tx;
        if (!fl.cells.has(k)) fl.cells.set(k, []);
        fl.cells.get(k).push(box);
      }
    }
  }
  return { map, floors, isActive, barriers: new Map() };
}

/**
 * Add a temporary full-tile barrier (e.g. Terra Spike's barricade). It blocks
 * movement through the collision world AND marks the floor's dynamic-blocked
 * grid (`floor.dyn`) so findPath() routes around it until it is removed.
 */
export function addBarrier(world, floor, id, tiles) {
  const fl = world.floors[floor];
  const f = fl.f;
  if (!f.dyn) f.dyn = new Array(f.w * f.h).fill(0);
  const boxes = [];
  for (const [tx, ty] of tiles) {
    const k = ty * f.w + tx;
    const box = { minX: tx * TILE, maxX: (tx + 1) * TILE, minZ: ty * TILE, maxZ: (ty + 1) * TILE, barrier: id };
    if (!fl.cells.has(k)) fl.cells.set(k, []);
    fl.cells.get(k).push(box);
    f.dyn[k]++;
    boxes.push([k, box]);
  }
  world.barriers.set(id, { floor, tiles, boxes });
}

export function removeBarrier(world, id) {
  const b = world.barriers.get(id);
  if (!b) return;
  const fl = world.floors[b.floor];
  for (const [k, box] of b.boxes) {
    const list = fl.cells.get(k);
    const i = list ? list.indexOf(box) : -1;
    if (i >= 0) list.splice(i, 1);
    fl.f.dyn[k] = Math.max(0, fl.f.dyn[k] - 1);
  }
  world.barriers.delete(id);
}

function isWall(f, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= f.w || ty >= f.h) return true;
  return f.tiles[ty * f.w + tx] === TILE_WALL;
}

/** Push a circle out of one AABB. Returns the corrected [x, z] or null if no overlap. */
function pushOut(x, z, r, minX, maxX, minZ, maxZ) {
  const cx = Math.max(minX, Math.min(x, maxX));
  const cz = Math.max(minZ, Math.min(z, maxZ));
  const dx = x - cx, dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return [cx + (dx / d) * r, cz + (dz / d) * r];
  }
  // Centre inside the box: leave along the shallowest axis.
  const left = x - minX, right = maxX - x, top = z - minZ, bottom = maxZ - z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return [minX - r, z];
  if (m === right) return [maxX + r, z];
  if (m === top) return [x, minZ - r];
  return [x, maxZ + r];
}

function resolve(world, floor, x, z, r, ignoreDynamic = false) {
  const fl = world.floors[floor];
  const f = fl.f;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
    const tz0 = Math.floor((z - r) / TILE), tz1 = Math.floor((z + r) / TILE);
    for (let ty = tz0; ty <= tz1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (isWall(f, tx, ty)) {
          const res = pushOut(x, z, r, tx * TILE, (tx + 1) * TILE, ty * TILE, (ty + 1) * TILE);
          if (res) { [x, z] = res; moved = true; }
        }
        const boxes = fl.cells.get(ty * f.w + tx);
        if (!boxes) continue;
        for (const b of boxes) {
          if (b.prop?.collider.dynamic && (ignoreDynamic || !world.isActive(b.prop))) continue;
          const res = pushOut(x, z, r, b.minX, b.maxX, b.minZ, b.maxZ);
          if (res) { [x, z] = res; moved = true; }
        }
      }
    }
    if (!moved) break;
  }
  return [x, z];
}

/** Move a circle of radius r by (dx, dz) on `floor`, sliding along obstacles. */
export function moveCircle(world, floor, x, z, dx, dz, r) {
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
  const sx = dx / steps, sz = dz / steps;
  for (let i = 0; i < steps; i++) {
    [x, z] = resolve(world, floor, x + sx, z, r);
    [x, z] = resolve(world, floor, x, z + sz, r);
  }
  return { x, z };
}

/**
 * True if a circle at (x, z) overlaps any solid geometry. With
 * `ignoreDynamic`, gates are ignored (spells fly between the Cell's bars).
 */
export function overlapsSolid(world, floor, x, z, r, { ignoreDynamic = false } = {}) {
  const [nx, nz] = resolve(world, floor, x, z, r, ignoreDynamic);
  return Math.abs(nx - x) > 1e-3 || Math.abs(nz - z) > 1e-3;
}

/**
 * Line of sight between two points on one floor (walls only; props don't
 * block sight). DDA grid walk.
 */
export function lineOfSight(map, floor, x0, z0, x1, z1) {
  const f = map.floors[floor];
  let tx = Math.floor(x0 / TILE), ty = Math.floor(z0 / TILE);
  const ex = Math.floor(x1 / TILE), ey = Math.floor(z1 / TILE);
  const dx = x1 - x0, dz = z1 - z0;
  const stepX = Math.sign(dx), stepZ = Math.sign(dz);
  const tDeltaX = stepX ? Math.abs(TILE / dx) : Infinity;
  const tDeltaZ = stepZ ? Math.abs(TILE / dz) : Infinity;
  let tMaxX = stepX ? ((stepX > 0 ? (tx + 1) * TILE - x0 : x0 - tx * TILE) / Math.abs(dx)) : Infinity;
  let tMaxZ = stepZ ? ((stepZ > 0 ? (ty + 1) * TILE - z0 : z0 - ty * TILE) / Math.abs(dz)) : Infinity;
  const steps = Math.abs(ex - tx) + Math.abs(ey - ty);
  for (let i = 0; i < steps; i++) {
    if (isWall(f, tx, ty)) return false;
    if (tMaxX < tMaxZ) { tMaxX += tDeltaX; tx += stepX; } else { tMaxZ += tDeltaZ; ty += stepZ; }
  }
  return !isWall(f, tx, ty);
}
