// Test helper (Step 7): do every step of a Heart's thematic task, including
// the carry tasks (take an ingot / platter from a source, bring it to the sink).

import { TASKS } from '../shared/lore.js';

const at = (p, prop) => {
  const spot = prop.front ?? { x: prop.x, z: prop.z };
  Object.assign(p, { x: spot.x, z: spot.z, floor: prop.floor });
};

/** Hold E on `propId` until the channel finishes. */
export function use(g, p, propId, run) {
  at(p, g.props[propId]);
  g.onInteract(p.id, propId);
  run(g, 3, () => !p.channel);
}

/** All three steps of `heart`'s task, done by player p. */
export function doHeartTasks(g, p, heart, run) {
  const T = TASKS[heart.sin];
  for (const tid of heart.tasks) {
    use(g, p, tid, run);
    if (T.sink) use(g, p, heart.sink, run);
  }
}

export { at };
