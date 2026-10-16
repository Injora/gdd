// Step 9: the pieces that let one process run many covens: the staggered
// tick scheduler and mansions shared between covens on the same seed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TickScheduler } from '../server/TickScheduler.js';
import { mansionFor, instanceMap, derived, mapStats } from '../server/MapCache.js';
import { Game } from '../server/Game.js';
import { addBarrier } from '../shared/collision.js';
import { isPassable } from '../shared/pathfinding.js';

const fakeGame = (room, onTick) => ({ room, players: new Map([['a', {}], ['b', {}]]), tick: onTick });

test('scheduler: games spread over staggered slots, each stepped once per cycle; a throwing game is isolated', () => {
  const s = new TickScheduler(20, 4);
  const ticks = new Map();
  const games = Array.from({ length: 10 }, (_, i) => fakeGame(`g${i}`, () => ticks.set(i, (ticks.get(i) ?? 0) + 1)));
  const bad = fakeGame('bad', () => { throw new Error('boom'); });
  for (const g of games) s.add(g);
  s.add(bad);
  clearInterval(s.timer); // drive it by hand
  const sizes = s.lanes.map((l) => l.size).sort();
  assert.deepEqual(sizes, [2, 3, 3, 3], 'balanced lanes');
  const errLog = console.error;
  console.error = () => {};
  for (let i = 0; i < 4 * 5; i++) s.loop(); // five 50 ms cycles
  console.error = errLog;
  for (let i = 0; i < 10; i++) assert.equal(ticks.get(i), 5, `game ${i}: 20 Hz`);
  assert.equal(s.errors, 5, 'the bad game threw every cycle, nobody else noticed');
  const st = s.stats();
  assert.equal(st.rooms, 11);
  assert.equal(st.players, 22);
  assert.equal(st.slots, 4);
  assert.ok(st.p95 >= 0 && st.cycleP95 >= st.p95);
  s.remove(bad);
  for (const g of games) s.remove(g);
  assert.equal(s.timer, null, 'the loop stops when the last game ends');
});

test('mansion cache: covens on one seed share the layout, but each has its own barriers', () => {
  const before = mapStats.misses;
  const a = mansionFor(987654), b = mansionFor(987654);
  assert.equal(a, b, 'built once');
  assert.equal(mapStats.misses, before + 1);
  const ma = instanceMap(a), mb = instanceMap(b);
  assert.equal(ma.floors[0].tiles, mb.floors[0].tiles, 'tiles shared');
  assert.equal(ma.props, mb.props, 'props shared');
  assert.notEqual(ma.floors[0], mb.floors[0], 'floors are per game');
  assert.equal(derived(a, 'x', () => ({ n: 1 })), derived(b, 'x', () => ({ n: 2 })), 'derived tables shared');

  // A barrier in one coven's mansion does not block the other's.
  const io = { to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } };
  const lobby = (id) => ({ room: id, hostId: 'p', seed: 987654, members: [{ id: 'p', name: 'P', wizardId: 'soham', isBot: false }] });
  const g1 = new Game(io, lobby('one')), g2 = new Game(io, lobby('two'));
  assert.equal(g1.mansion, g2.mansion);
  assert.equal(g1.monster.rooms, g2.monster.rooms, 'one room graph');
  assert.equal(g1.monster.tiles, g2.monster.tiles, 'one Keeper tile index');
  const f = g1.map.floors[0];
  let tile = null;
  for (let i = 0; i < f.w * f.h && !tile; i++) if (isPassable(f, i % f.w, Math.floor(i / f.w))) tile = [i % f.w, Math.floor(i / f.w)];
  addBarrier(g1.world, 0, 'test', [tile]);
  assert.ok(!isPassable(g1.map.floors[0], ...tile), 'blocked in coven one');
  assert.ok(isPassable(g2.map.floors[0], ...tile), 'open in coven two');
});
