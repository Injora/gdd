import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMansion, publicMap, roomAt } from '../shared/mapgen.js';
import { createCollisionWorld, overlapsSolid, moveCircle, lineOfSight } from '../shared/collision.js';
import { findPath, isPassable } from '../shared/pathfinding.js';
import { stairToward, allStairs } from '../shared/nav.js';
import { HEART_COUNT, PLAYER_RADIUS, TILE, TILE_VOID, FLOOR, tileCenter } from '../shared/constants.js';
import { HEART_TYPES, TASKS, TASK_STEPS } from '../shared/lore.js';

const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7);
const tileOf = (v) => Math.floor(v / TILE);

test('generation is deterministic', () => {
  assert.deepEqual(generateMansion(42), generateMansion(42));
});

test('three levels: Floor 1, Floor 2 and the Basement, with every required room', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const map = generateMansion(seed);
    assert.equal(map.floors.length, 3);
    const types = (f) => new Set(map.rooms.filter((r) => r.floor === f).map((r) => r.type));
    const g = types(FLOOR.GROUND), u = types(FLOOR.UPPER), b = types(FLOOR.BASEMENT);
    for (const t of ['foyer', 'altar', 'banquet', 'armory', 'nursery', 'library', 'stairwell', 'stairhall']) assert.ok(g.has(t), `Floor 1 has ${t} (seed ${seed})`);
    for (const t of ['gallery', 'ballroom', 'master_study', 'rose_bedroom', 'observatory', 'alchemy', 'landing']) assert.ok(u.has(t), `Floor 2 has ${t} (seed ${seed})`);
    for (const t of ['crypt', 'ossuary', 'cell']) assert.ok(b.has(t), `Basement has ${t}`);
    assert.equal(map.rooms.find((r) => r.type === 'cell').name, 'Underground Cage Prison');
    // Room ids index the rooms array.
    map.rooms.forEach((r, i) => assert.equal(r.id, i));
  }
});

test('the Balcony Gallery overlooks the Foyer through an open void (no walking, clear sight)', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const map = generateMansion(seed);
    const foyer = map.rooms[map.ids.foyer];
    const upper = map.floors[FLOOR.UPPER];
    let voids = 0;
    for (let y = 0; y < upper.h; y++) {
      for (let x = 0; x < upper.w; x++) {
        if (upper.tiles[y * upper.w + x] !== TILE_VOID) continue;
        voids++;
        // Every void tile hangs over the Foyer's floor.
        assert.equal(map.floors[FLOOR.GROUND].roomIds[y * upper.w + x], foyer.id);
        assert.ok(!isPassable(upper, x, y));
      }
    }
    assert.ok(voids >= 9, `a real overlook (${voids} tiles)`);
    // You can see straight across it from one side of the gallery to the other.
    const vx0 = foyer.x, vx1 = foyer.x + foyer.w - 1, cy = foyer.y + Math.floor(foyer.h / 2);
    assert.ok(lineOfSight(map, FLOOR.UPPER, tileCenter(vx0), tileCenter(cy), tileCenter(vx1), tileCenter(cy)));
    const world = createCollisionWorld(map);
    assert.ok(overlapsSolid(world, FLOOR.UPPER, tileCenter(foyer.cx), tileCenter(foyer.cy), PLAYER_RADIUS), 'nobody walks on air');
  }
});

test('Grand Dual Staircases climb from the Foyer to the gallery; every floor connects by stairs', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const map = generateMansion(seed);
    const stairs = allStairs(map);
    const grand = stairs.filter((s) => s.kind === 'grand_stair' && s.floor === FLOOR.GROUND && s.room === map.ids.foyer);
    assert.equal(grand.length, 2, 'two staircases in the Foyer');
    for (const s of grand) {
      const up = map.props[s.link];
      assert.equal(up.floor, FLOOR.UPPER);
      assert.equal(up.room, map.ids.gallery);
      assert.equal(up.tx, s.tx, 'the stair rises through its own tile column');
      assert.equal(up.ty, s.ty);
      assert.equal(up.link, s.id);
    }
    // A second family stair elsewhere, plus the servants' stair to the basement.
    assert.ok(stairs.some((s) => s.kind === 'grand_stair' && s.room !== map.ids.foyer));
    assert.equal(map.props[map.ids.stairsDown].target.floor, FLOOR.BASEMENT);
    assert.equal(map.stairs.length, 4);
    // Routing: from the basement to Floor 2 you go up to Floor 1 first.
    const ante = map.props[map.ids.stairsUp];
    const first = stairToward(map, FLOOR.BASEMENT, ante.x, ante.z, FLOOR.UPPER);
    assert.equal(first.id, map.ids.stairsUp);
    const second = stairToward(map, FLOOR.GROUND, first.target.x, first.target.z, FLOOR.UPPER);
    assert.equal(second.target.floor, FLOOR.UPPER);
    assert.equal(stairToward(map, FLOOR.UPPER, 10, 10, FLOOR.UPPER), null);
  }
});

test('seven Hearts on Floors 1 and 2, each sealed by a 3-part task in its room', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const map = generateMansion(seed);
    assert.equal(map.hearts.length, HEART_COUNT);
    assert.equal(new Set(map.hearts.map((h) => h.roomId)).size, HEART_COUNT);
    assert.equal(new Set(map.hearts.map((h) => h.type)).size, HEART_COUNT);
    assert.equal(new Set(map.hearts.map((h) => h.sin)).size, HEART_COUNT, 'one Sin per Heart');
    assert.ok(map.hearts.some((h) => h.floor === FLOOR.GROUND) && map.hearts.some((h) => h.floor === FLOOR.UPPER));
    for (const h of map.hearts) {
      assert.notEqual(h.floor, FLOOR.BASEMENT);
      const prop = map.props[h.propId];
      assert.equal(prop.heart, h.type);
      assert.equal(prop.kind, HEART_TYPES[h.type].prop);
      assert.equal(h.tasks.length, TASK_STEPS);
      for (const id of h.tasks) {
        const t = map.props[id];
        assert.equal(t.interact, 'task');
        assert.equal(t.kind, TASKS[h.task].prop);
        assert.equal(t.room, h.roomId, 'task props stand in the Heart’s room');
        if (TASKS[h.task].turns) assert.ok(t.turns >= 1 && t.turns <= 3);
      }
    }
  }
});

for (const seed of SEEDS) {
  test(`seed ${seed}: mansion is complete and fully reachable`, () => {
    const map = generateMansion(seed);
    const world = createCollisionWorld(map);
    const basement = map.floors[FLOOR.BASEMENT];

    // Key props exist with the right kinds.
    const { tome, altar, stairsDown, stairsUp, gate } = map.ids;
    assert.equal(map.props[tome].kind, 'tome');
    assert.equal(map.props[altar].kind, 'altar');
    assert.equal(map.props[stairsDown].floor, FLOOR.GROUND);
    assert.equal(map.props[stairsUp].floor, FLOOR.BASEMENT);
    assert.equal(map.props[gate].kind, 'gate');

    // Spawn points are clear.
    for (const p of map.spawn.points) assert.ok(!overlapsSolid(world, FLOOR.GROUND, p.x, p.z, PLAYER_RADIUS), 'spawn clear');
    for (const p of map.cell.points) assert.ok(!overlapsSolid(world, FLOOR.BASEMENT, p.x, p.z, PLAYER_RADIUS), 'cell clear');

    // Every interactable can be reached on foot from the spawn, using the stairs.
    const spawn = map.spawn.points[0];
    const starts = { [FLOOR.GROUND]: [tileOf(spawn.x), tileOf(spawn.z)] };
    for (const s of allStairs(map)) {
      if (s.floor === FLOOR.GROUND) starts[s.target.floor] ??= [tileOf(s.target.x), tileOf(s.target.z)];
    }
    assert.ok(starts[FLOOR.UPPER] && starts[FLOOR.BASEMENT]);
    for (const p of map.props) {
      if (!p.interact || p.kind === 'gate') continue;
      const goal = p.front ? [p.front.tx, p.front.ty] : [p.tx, p.ty];
      const [sx, sy] = starts[p.floor];
      const path = findPath(map.floors[p.floor], sx, sy, goal[0], goal[1], 1e6);
      assert.ok(path, `prop ${p.id} (${p.kind}) reachable on floor ${p.floor}`);
    }
    // Every room is reachable too (no dead floors).
    for (const r of map.rooms) {
      if (r.type === 'cell') continue;
      const f = map.floors[r.floor];
      let tile = null;
      for (let y = r.y; y < r.y + r.h && !tile; y++) for (let x = r.x; x < r.x + r.w && !tile; x++) if (isPassable(f, x, y)) tile = [x, y];
      assert.ok(tile && findPath(f, ...starts[r.floor], ...tile, 1e6), `${r.name} reachable`);
      assert.equal(roomAt(map, r.floor, tileCenter(tile[0]), tileCenter(tile[1]))?.id, r.id);
    }

    // The cage is sealed: from inside, the only exit is through its door.
    const cellPt = map.cell.points[0];
    const outside = findPath(basement, tileOf(cellPt.x), tileOf(cellPt.z), ...starts[FLOOR.BASEMENT], 1e6);
    assert.ok(outside, 'cage connects to basement through the door tile');
    const g = map.props[gate];
    assert.ok(outside.some(([x, y]) => x === g.tx && y === g.ty), 'path out of the cage passes the door');

    // A locked door physically blocks walking out.
    let pos = { x: cellPt.x, z: cellPt.z };
    for (let i = 0; i < 400; i++) pos = moveCircle(world, FLOOR.BASEMENT, pos.x, pos.z, -0.1, (g.z - pos.z) * 0.1, PLAYER_RADIUS);
    assert.ok(pos.x > g.collider.x, 'door holds');

    // Clients never learn which props are hearts (or which heart a task guards).
    const pub = JSON.parse(JSON.stringify(publicMap(map)));
    assert.equal(pub.hearts, undefined);
    assert.ok(pub.props.every((p) => !('heart' in p) && !('decoy' in p) && !('taskOf' in p)));
  });
}
