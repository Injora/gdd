// Step 9: mansions shared between covens. generateMansion(seed) is pure, and
// a running game only ever writes the dynamic-barrier grid (`floor.dyn`), so
// every coven playing the same seed shares one read-only mansion (tiles,
// rooms, props, the client copy, the room graph, the Keeper's tile index)
// and gets its own thin floor wrappers. An LRU keeps the most recent seeds.
//
// MANSION_POOL=N (env) draws new games' seeds from a fixed pool of N layouts,
// so a big deployment builds each mansion once and shares it widely.

import { generateMansion, publicMap } from '../shared/mapgen.js';

const MAX = Math.max(1, Number(process.env.MAP_CACHE) || 64);
const POOL = Math.max(0, Number(process.env.MANSION_POOL) || 0);
const cache = new Map(); // seed -> entry (Map order = LRU)
export const mapStats = { hits: 0, misses: 0 };

/** The shared, read-only mansion for `seed` (built on first use). */
export function mansionFor(seed) {
  let e = cache.get(seed);
  if (e) {
    mapStats.hits++;
    cache.delete(seed);
    cache.set(seed, e);
    return e;
  }
  mapStats.misses++;
  const map = generateMansion(seed);
  e = { seed, map, clientMap: publicMap(map), derived: new Map() };
  cache.set(seed, e);
  while (cache.size > MAX) cache.delete(cache.keys().next().value);
  return e;
}

/** A per-game view of a shared mansion: its own floors (for barriers), everything else shared. */
export function instanceMap(entry) {
  return { ...entry.map, floors: entry.map.floors.map((f) => ({ ...f, dyn: null })) };
}

/** Memoise something derived from a mansion's static layout (room graph, tile index…). */
export function derived(entry, key, build) {
  if (!entry) return build();
  if (!entry.derived.has(key)) entry.derived.set(key, build());
  return entry.derived.get(key);
}

/** A seed for a new game: random, or from the pool. */
export function newSeed() {
  if (POOL) return (Math.floor(Math.random() * POOL) * 2654435761 + 12345) >>> 0;
  return (Math.random() * 0xffffffff) >>> 0;
}

export function cacheSize() { return cache.size; }
