import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMansion, publicMap } from '../shared/mapgen.js';
import { createCollisionWorld, overlapsSolid, moveCircle } from '../shared/collision.js';
import { findPath } from '../shared/pathfinding.js';
import { HEART_COUNT, PLAYER_RADIUS, TILE } from '../shared/constants.js';

const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7);
const tileOf = (v) => Math.floor(v / TILE);

test('generation is deterministic', () => {
  assert.deepEqual(generateMansion(42), generateMansion(42));
});

for (const seed of SEEDS) {
  test(`seed ${seed}: mansion is complete and fully reachable`, () => {
    const map = generateMansion(seed);
    const world = createCollisionWorld(map);
    const [ground, basement] = map.floors;

    // Six hearts, six distinct rooms, six distinct types.
    assert.equal(map.hearts.length, HEART_COUNT);
    assert.equal(new Set(map.hearts.map((h) => h.roomId)).size, HEART_COUNT);
    assert.equal(new Set(map.hearts.map((h) => h.type)).size, HEART_COUNT);
    for (const h of map.hearts) assert.equal(map.props[h.propId].heart, h.type);

    // Key props exist with the right kinds.
    const { tome, altar, stairsDown, stairsUp, gate } = map.ids;
    assert.equal(map.props[tome].kind, 'tome');
    assert.equal(map.props[altar].kind, 'altar');
    assert.equal(map.props[stairsDown].floor, 0);
    assert.equal(map.props[stairsUp].floor, 1);
    assert.equal(map.props[gate].kind, 'gate');

    // Spawn points are clear.
    for (const p of map.spawn.points) assert.ok(!overlapsSolid(world, 0, p.x, p.z, PLAYER_RADIUS), 'spawn clear');
    for (const p of map.cell.points) assert.ok(!overlapsSolid(world, 1, p.x, p.z, PLAYER_RADIUS), 'cell clear');

    // Every interactable can be reached on foot from where you arrive on its floor.
    const starts = [
      [tileOf(map.spawn.points[0].x), tileOf(map.spawn.points[0].z)],
      [tileOf(map.props[stairsDown].target.x), tileOf(map.props[stairsDown].target.z)],
    ];
    for (const p of map.props) {
      if (!p.interact || p.kind === 'gate') continue;
      const floor = map.floors[p.floor];
      const goal = p.front ? [p.front.tx, p.front.ty] : [p.tx, p.ty];
      const [sx, sy] = starts[p.floor];
      const path = findPath(floor, sx, sy, goal[0], goal[1], 1e6);
      assert.ok(path, `prop ${p.id} (${p.kind}) reachable on floor ${p.floor}`);
    }

    // The cell is sealed: from inside, the only exit is through the gate.
    const cellPt = map.cell.points[0];
    const outside = findPath(basement, tileOf(cellPt.x), tileOf(cellPt.z), starts[1][0], starts[1][1], 1e6);
    assert.ok(outside, 'cell connects to basement through gate tile');
    const g = map.props[gate];
    assert.ok(outside.some(([x, y]) => x === g.tx && y === g.ty), 'path out of cell passes the gate');

    // A locked gate physically blocks walking out.
    let pos = { x: cellPt.x, z: cellPt.z };
    for (let i = 0; i < 400; i++) pos = moveCircle(world, 1, pos.x, pos.z, -0.1, (g.z - pos.z) * 0.1, PLAYER_RADIUS);
    assert.ok(pos.x > g.collider.x, 'gate holds');

    // Clients never learn which props are hearts.
    const pub = JSON.parse(JSON.stringify(publicMap(map)));
    assert.equal(pub.hearts, undefined);
    assert.ok(pub.props.every((p) => !('heart' in p) && !('decoy' in p)));
    assert.ok(ground.tiles.length === ground.w * ground.h);
  });
}
