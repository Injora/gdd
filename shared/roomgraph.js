// The mansion as a graph of rooms (per floor), for the Keeper's senses:
// which rooms are "1 room away" from where it stands, and which doorway leads
// into a room. Doorways and corridors are the tiles with no room (roomId -1);
// two rooms are adjacent when a short walk through doors / corridors joins
// them (a shared doorway, or a stretch of hall up to HOPS tiles long).

import { TILE, TILE_WALL, TILE_VOID, TILE_DOOR, tileCenter } from './constants.js';

export const HOPS = 8;
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const walkable = (f, x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h && f.tiles[y * f.w + x] !== TILE_WALL && f.tiles[y * f.w + x] !== TILE_VOID;

/**
 * Rooms reachable from the seed tiles by walking at most `hops` tiles through
 * doorways / corridors (never through another room).
 */
function roomsWithin(f, seeds, hops) {
  const found = new Set();
  const seen = new Map();
  let frontier = [];
  for (const [x, y] of seeds) {
    seen.set(y * f.w + x, 0);
    frontier.push([x, y]);
  }
  for (let d = 0; d <= hops && frontier.length; d++) {
    const next = [];
    for (const [x, y] of frontier) {
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (!walkable(f, nx, ny)) continue;
        const i = ny * f.w + nx;
        const room = f.roomIds[i];
        if (room >= 0) { found.add(room); continue; }
        if (seen.has(i)) continue;
        seen.set(i, d + 1);
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return found;
}

/**
 * Per floor: `adj` (roomId -> Set of rooms 1 room away) and `doors`
 * (roomId -> doorway tiles [{ tx, ty, x, z }] that lead into it).
 */
export function buildRoomGraph(map, hops = HOPS) {
  return map.floors.map((f) => {
    const exits = new Map(); // roomId -> no-room tiles touching it
    const doors = new Map();
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        if (f.roomIds[i] >= 0 || !walkable(f, x, y)) continue;
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h) continue;
          const room = f.roomIds[ny * f.w + nx];
          if (room < 0 || !walkable(f, nx, ny)) continue;
          if (!exits.has(room)) exits.set(room, []);
          exits.get(room).push([x, y]);
          if (f.tiles[i] === TILE_DOOR) {
            if (!doors.has(room)) doors.set(room, []);
            if (!doors.get(room).some((d) => d.tx === x && d.ty === y)) doors.get(room).push({ tx: x, ty: y, x: tileCenter(x), z: tileCenter(y) });
          }
        }
      }
    }
    const adj = new Map();
    for (const [room, seeds] of exits) {
      const near = roomsWithin(f, seeds, hops);
      near.delete(room);
      adj.set(room, near);
    }
    return { floor: f.id, adj, doors, f };
  });
}

/** The room at world (x, z) on `floor`, or -1 in a doorway / corridor. */
export function zoneAt(map, floor, x, z) {
  const f = map.floors[floor];
  const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
  if (!f || tx < 0 || ty < 0 || tx >= f.w || ty >= f.h) return -1;
  return f.roomIds[ty * f.w + tx];
}

/** Rooms "1 room away" from world (x, z): the neighbours of its room, or the rooms a corridor leads to. */
export function roomsAround(graph, map, floor, x, z, hops = HOPS) {
  const g = graph[floor];
  const zone = zoneAt(map, floor, x, z);
  if (zone >= 0) return g.adj.get(zone) ?? new Set();
  const f = map.floors[floor];
  return roomsWithin(f, [[Math.floor(x / TILE), Math.floor(z / TILE)]], hops);
}

/**
 * Is (px, pz) "1 room away" from (x, z) on the same floor: within `range`
 * units, in the same room, or in a room next to it?
 */
export function oneRoomAway(graph, map, floor, x, z, px, pz, range = 18) {
  if (Math.hypot(px - x, pz - z) <= range) return true;
  const pr = zoneAt(map, floor, px, pz);
  if (pr < 0) {
    // In a corridor: one hop from the Keeper's room means the corridor touches it.
    const mine = zoneAt(map, floor, x, z);
    return mine >= 0 && roomsAround(graph, map, floor, px, pz).has(mine);
  }
  const mine = zoneAt(map, floor, x, z);
  return pr === mine || roomsAround(graph, map, floor, x, z).has(pr);
}

/** Is world (x, z) in a corridor / doorway, or within `reach` tiles of one? */
export function nearCorridor(map, floor, x, z, reach = 2) {
  const f = map.floors[floor];
  const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (walkable(f, nx, ny) && f.roomIds[ny * f.w + nx] < 0) return true;
    }
  }
  return false;
}
