// Seeds for tests that need open floor to stage a fight in: mansions with a
// clear 14-tile row (3 tiles wide) on Floor 1. Random mansions don't always
// have one, which made those tests flaky. (Not a test file: no `.test.js`.)

import { generateMansion } from '../shared/mapgen.js';
import { createCollisionWorld, overlapsSolid } from '../shared/collision.js';
import { isPassable } from '../shared/pathfinding.js';
import { tileCenter } from '../shared/constants.js';

function hasRow(map, len) {
  const world = createCollisionWorld(map);
  const f = map.floors[0];
  const ok = (x, y) => isPassable(f, x, y) && !overlapsSolid(world, 0, tileCenter(x), tileCenter(y), 0.95);
  for (let y = 3; y < f.h - 3; y++) {
    for (let x = 2; x < f.w - len - 2; x++) {
      let good = true;
      for (let k = 0; k < len && good; k++) good = ok(x + k, y) && ok(x + k, y - 1) && ok(x + k, y + 1);
      if (good) return true;
    }
  }
  return false;
}

let good = null;
let next = 0;
/** A seed (rotating through a fixed list) whose mansion has room for a duel. */
export function roomySeed() {
  if (!good) {
    good = [];
    for (let s = 1; good.length < 10; s++) if (hasRow(generateMansion(s * 977), 14)) good.push(s * 977);
  }
  return good[next++ % good.length];
}
