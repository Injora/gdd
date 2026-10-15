// Cross-floor navigation for bots and monsters: which staircase to take next
// to reach another floor. Every stair prop has a `target` on another floor;
// the floors form a small graph (Floor 2 ↔ Floor 1 ↔ Basement).

const cache = new WeakMap();

function stairsOf(map) {
  let list = cache.get(map);
  if (!list) {
    list = map.props.filter((p) => p.interact === 'stairs' && p.target && p.front);
    cache.set(map, list);
  }
  return list;
}

/** Stair hops from every floor to `toFloor`. */
function hopsTo(map, toFloor) {
  const stairs = stairsOf(map);
  const hops = new Map([[toFloor, 0]]);
  const queue = [toFloor];
  while (queue.length) {
    const f = queue.shift();
    for (const s of stairs) {
      // s leads from s.floor to s.target.floor; walk the links backwards.
      if (s.target.floor !== f || hops.has(s.floor)) continue;
      hops.set(s.floor, hops.get(f) + 1);
      queue.push(s.floor);
    }
  }
  return hops;
}

/**
 * The stair prop to walk to (on `fromFloor`, nearest to x/z) on a shortest
 * route to `toFloor`; null when already there or unreachable.
 */
export function stairToward(map, fromFloor, x, z, toFloor) {
  if (fromFloor === toFloor) return null;
  const hops = hopsTo(map, toFloor);
  const here = hops.get(fromFloor);
  if (here === undefined) return null;
  let best = null;
  for (const s of stairsOf(map)) {
    if (s.floor !== fromFloor || hops.get(s.target.floor) !== here - 1) continue;
    const d = Math.hypot(s.front.x - x, s.front.z - z);
    if (!best || d < best.d) best = { s, d };
  }
  return best?.s ?? null;
}

/** Every stair prop (for tests and the minimap). */
export function allStairs(map) { return stairsOf(map); }
