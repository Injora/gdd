// Step 8: the Keeper hunts down activity. Task steps, spells and movement
// 1 room away send it to the room; toggling V before it steps in and standing
// still survives its inspection, moving (or working the task) does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/Game.js';
import { AI } from '../server/Monster.js';
import { PHASE, INVIS, tileCenter } from '../shared/constants.js';
import { buildRoomGraph, zoneAt, oneRoomAway, nearCorridor } from '../shared/roomgraph.js';
import { generateMansion } from '../shared/mapgen.js';
import { use, at } from './_tasks.js';

function makeGame(seed = 777) {
  const events = [];
  const io = { to: () => ({ emit: (name, data) => events.push({ name, data }) }), sockets: { sockets: new Map() } };
  const g = new Game(io, {
    room: 't', hostId: 'p0', seed,
    members: [{ id: 'p0', name: 'P0', wizardId: 'parthius', isBot: false }, { id: 'p1', name: 'P1', wizardId: 'soham', isBot: false }],
  });
  g.events = events;
  g.monster.nextHauntAt = Infinity;
  g.tomeReadBy = 't';
  g.setPhase(PHASE.HEARTS);
  const m = g.monster;
  m.awaken();
  m.aggression = 0;
  g.players.get('p1').floor = 1; // out of the way, in the basement
  return { g, m, p: g.players.get('p0') };
}
const evs = (g, type) => g.events.filter((e) => e.name === 'game:event' && e.data.type === type).map((e) => e.data);
const run = (g, s, until) => { for (let t = 0; t < s; t += 0.05) { g.step(0.05); if (until?.()) return true; } return false; };

/** A patrol spot on `floor` that is neither 1 room away from (x, z) nor close: `minRoute`–`maxRoute` units to walk to `entry`. */
function farSpot(g, m, floor, x, z, entry, minRoute = 22, maxRoute = 45) {
  for (const tl of m.tiles[floor]) {
    if (Math.hypot(tl.x - x, tl.z - z) < 22 || tl.roomId < 0) continue;
    if (oneRoomAway(m.rooms, g.map, floor, tl.x, tl.z, x, z, AI.ADJACENT_RANGE)) continue;
    m.place(tl);
    const d = m.routeLength(entry);
    if (d >= minRoute && d <= maxRoute) return tl;
  }
  throw new Error('no far spot');
}

/** The Keeper patrolling at `spot`, nothing on its mind. */
function patrolAt(m, spot) {
  m.place(spot);
  m.hidden = false;
  m.setState('stalking');
  m.goal = { x: spot.x, z: spot.z, floor: spot.floor, peek: false };
  m.goalUntil = Infinity;
}

/** The wrath Heart (Armory Hall, ground floor) and the Keeper patrolling far from it. */
function wrathSetup() {
  const { g, m, p } = makeGame();
  const heart = g.map.hearts.find((h) => h.sin === 'wrath');
  const task = g.props[heart.tasks[0]];
  const door = m.rooms[task.floor].doors.get(heart.roomId)[0];
  const spot = farSpot(g, m, task.floor, task.x, task.z, { ...door, floor: task.floor });
  patrolAt(m, spot);
  at(p, task);
  p.moving = false;
  return { g, m, p, heart, task };
}

// ---------------------------------------------------------------------------

test('room graph: rooms 1 room away share a doorway or a short hall; doors lead into every room', () => {
  for (const seed of [1, 42, 777, 4242]) {
    const map = generateMansion(seed);
    const graph = buildRoomGraph(map);
    for (const r of map.rooms) {
      if (r.type === 'cell') continue;
      const g = graph[r.floor];
      assert.ok((g.doors.get(r.id) ?? []).length > 0 || (g.adj.get(r.id)?.size ?? 0) > 0, `${seed} ${r.name} has a way in`);
      for (const n of g.adj.get(r.id) ?? []) assert.ok(g.adj.get(n).has(r.id), 'adjacency is symmetric');
    }
  }
  const map = generateMansion(42);
  const graph = buildRoomGraph(map);
  const byName = (n) => map.rooms.find((r) => r.name === n && r.floor === 0);
  const library = byName('Library'), nursery = byName('Nursery'), foyer = byName('Grand Foyer');
  assert.ok(graph[0].adj.get(library.id).has(nursery.id), 'Library ↔ Nursery');
  const c = (r) => ({ x: tileCenter(r.cx), z: tileCenter(r.cy) });
  assert.ok(oneRoomAway(graph, map, 0, c(library).x, c(library).z, c(nursery).x, c(nursery).z, 0));
  assert.ok(!oneRoomAway(graph, map, 0, c(library).x, c(library).z, c(foyer).x, c(foyer).z, 0), 'the Foyer is further off');
  assert.equal(zoneAt(map, 0, c(library).x, c(library).z), library.id);
  const door = graph[0].doors.get(library.id)[0];
  assert.ok(nearCorridor(map, 0, door.x, door.z));
});

test('a Sin task step (1/3) sends the Keeper straight to that room: investigating, routed to its doorway', () => {
  const { g, m, p, heart, task } = wrathSetup();
  use(g, p, task.id, run);
  assert.equal(evs(g, 'task').at(-1).progress, 1);
  assert.equal(m.state, 'investigating');
  assert.equal(m.ping.kind, 'task');
  assert.equal(m.ping.roomId, heart.roomId);
  assert.ok(m.ping.entry.door, 'it comes through a doorway');
  assert.ok(m.rooms[task.floor].doors.get(heart.roomId).some((d) => d.x === m.ping.entry.x && d.z === m.ping.entry.z));
  assert.deepEqual({ x: m.ping.look.x, z: m.ping.look.z }, { x: task.x, z: task.z }, 'it will look around the task object');
  const ev = evs(g, 'monster:investigate').at(-1);
  assert.equal(ev.roomId, heart.roomId);
  assert.ok(ev.eta >= AI.INVESTIGATE_WARN - 0.01, `its footsteps are heard for a while first (eta ${ev.eta}s)`);
  g.step(0.05);
  assert.ok(m.path.length > 0, 'a route');
  assert.equal(m.pathKey.split(':')[1], `${Math.floor(m.ping.entry.x / 2)},${Math.floor(m.ping.entry.z / 2)}`, 'pathfinding toward the doorway');
  assert.ok(m.moving);
});

test('casting a spell sends it to the caster’s room; activity inside a sealed lockdown does not', () => {
  const { g, m, p, heart } = wrathSetup();
  p.yaw = 0;
  assert.ok(g.spells.cast(p, 0, 0, 0).ok);
  assert.equal(m.state, 'investigating');
  assert.equal(m.ping.kind, 'spell');
  assert.equal(m.ping.roomId, heart.roomId);

  // Inside a Sin's lockdown the Keeper hears nothing.
  const { g: g2, m: m2, p: p2 } = wrathSetup();
  const h2 = g2.map.hearts.find((h) => h.sin === 'wrath');
  for (const tid of h2.tasks) g2.propState[tid] = { done: true };
  g2.propState[h2.propId] = { unsealed: true };
  at(p2, g2.props[h2.propId]);
  g2.startArena(h2, p2);
  patrolAt(m2, farSpot(g2, m2, p2.floor, p2.x, p2.z, { x: p2.x, z: p2.z, floor: p2.floor }, 0, 80));
  g2.spells.cooldowns = {};
  p2.cooldowns = {};
  g2.spells.cast(p2, 0, 0, 0);
  assert.notEqual(m2.state, 'investigating');
  assert.equal(g2.activity('task', p2, p2), false);
});

test('moving 1 room away is sensed at once; moving far off is not; crossing a doorway turns its patrol', () => {
  const { g, m, p } = makeGame();
  const rooms = g.map.rooms.filter((r) => r.floor === 0 && r.type !== 'cell');
  const center = (r) => ({ x: tileCenter(r.cx), z: tileCenter(r.cy), floor: 0 });
  // Two adjacent rooms more than ADJACENT_RANGE apart (so it is the room graph that counts).
  let pair = null;
  for (const a of rooms) {
    for (const bId of m.rooms[0].adj.get(a.id) ?? []) {
      const b = g.map.rooms[bId];
      const d = Math.hypot(center(a).x - center(b).x, center(a).z - center(b).z);
      if (d > AI.ADJACENT_RANGE && zoneAt(g.map, 0, center(a).x, center(a).z) === a.id && zoneAt(g.map, 0, center(b).x, center(b).z) === b.id) pair = { a, b };
    }
  }
  assert.ok(pair, 'an adjacent pair of rooms far apart');
  patrolAt(m, center(pair.a));
  // Far away (not adjacent, > 18u): nothing.
  const far = rooms.find((r) => r.id !== pair.a.id && !oneRoomAway(m.rooms, g.map, 0, m.x, m.z, center(r).x, center(r).z, AI.ADJACENT_RANGE) && zoneAt(g.map, 0, center(r).x, center(r).z) === r.id);
  Object.assign(p, center(far));
  p.moving = true;
  g.step(0.05);
  assert.equal(m.state, 'stalking', 'too far to hear');
  // Next door, moving: it goes to look.
  Object.assign(p, center(pair.b));
  g.step(0.05);
  assert.equal(m.state, 'investigating');
  assert.equal(m.ping.kind, 'movement');
  assert.equal(m.ping.roomId, pair.b.id);
  assert.equal(evs(g, 'monster:investigate').at(-1).by, 'p0');

  // A doorway crossing biases the patrol toward the room just entered.
  const { g: g2, m: m2, p: q } = makeGame();
  patrolAt(m2, center(pair.a));
  Object.assign(q, center(far));
  q.moving = false;
  g2.step(0.05);
  const target = rooms.find((r) => r.id !== far.id && r.id !== pair.a.id && zoneAt(g2.map, 0, center(r).x, center(r).z) === r.id);
  Object.assign(q, center(target));
  g2.step(0.05);
  assert.equal(m2.disturbance.roomId, target.id);
  assert.equal(m2.state, 'stalking');
  assert.ok(m2.goal?.disturbance, 'its patrol bends toward that doorway');
  assert.ok(m2.rooms[0].doors.get(target.id).some((d) => d.x === m2.goal.x && d.z === m2.goal.z));
});

test('V before it arrives and perfectly still: it walks in, looks around the task for 3–4s, and leaves', () => {
  const { g, m, p, task } = wrathSetup();
  use(g, p, task.id, run);
  assert.equal(m.state, 'investigating');
  assert.ok(g.onInvis('p0').ok, 'V, before it is anywhere near');
  p.moving = false;
  let closest = Infinity, inspected = 0;
  const done = run(g, 45, () => {
    closest = Math.min(closest, Math.hypot(m.x - p.x, m.z - p.z));
    if (m.ping?.stage === 'inspect') inspected += 0.05;
    return m.state !== 'investigating';
  });
  assert.ok(done, 'the investigation ended');
  assert.equal(m.lastInvestigation.stage, 'inspect', 'it got as far as looking around');
  assert.ok(inspected >= AI.INSPECT_MIN - 0.1 && inspected <= AI.INSPECT_MAX + 0.1, `looked around for ${inspected.toFixed(1)}s`);
  assert.ok(closest < 6, `it came right up (${closest.toFixed(1)}u)`);
  assert.ok(!p.captured && !p.capturing);
  assert.notEqual(m.targetId, 'p0');
  assert.notEqual(m.state, 'hunting');
  assert.equal(evs(g, 'monster:hunt').filter((e) => e.targetId === 'p0').length, 0, 'never locked on');
});

test('moving, working the task, or staying in plain sight: it finds you and locks on', () => {
  // Invisible but moving.
  {
    const { g, m, p, task } = wrathSetup();
    use(g, p, task.id, run);
    g.onInvis('p0');
    p.moving = true;
    assert.ok(run(g, 40, () => m.state === 'hunting'), 'sensed');
    assert.equal(m.targetId, 'p0');
    assert.equal(evs(g, 'monster:hunt').at(-1).reason, 'sensed');
    assert.ok(Math.hypot(m.x - p.x, m.z - p.z) <= INVIS.sense + 0.5);
  }
  // Invisible, standing still, but still working the next task.
  {
    const { g, m, p, heart, task } = wrathSetup();
    use(g, p, task.id, run);
    g.onInvis('p0');
    p.moving = false;
    const next = g.props[heart.tasks[1]];
    at(p, next);
    // They hear it coming, but keep working the task as it walks in.
    const locked = run(g, 40, () => {
      if (!p.channel && !g.propState[next.id]?.done && Math.hypot(m.x - p.x, m.z - p.z) < INVIS.sense - 1) g.onInteract('p0', next.id);
      return m.state === 'hunting';
    });
    assert.ok(locked && m.targetId === 'p0', 'its hands gave it away');
  }
  // Visible and still: it walks in and sees you.
  {
    const { g, m, p, task } = wrathSetup();
    use(g, p, task.id, run);
    p.moving = false;
    assert.ok(run(g, 40, () => m.state === 'hunting'), 'spotted');
    assert.equal(m.targetId, 'p0');
    assert.equal(evs(g, 'monster:hunt').at(-1).reason, 'sighted');
    // Too late for the charm now.
    assert.equal(g.onInvis('p0').reason, 'seen');
  }
});

test('every activity kind pings (task, spell, sprint/Lumos near a corridor, the gate, a prisoner’s call)', () => {
  const { g, m, p } = makeGame();
  const map = g.map;
  const door = m.rooms[0].doors.values().next().value[0];
  const kinds = [];
  const listen = () => { kinds.push(g.lastActivity?.kind); g.lastActivity = undefined; };
  // Sprinting next to a doorway.
  Object.assign(p, { x: door.x, z: door.z, floor: 0 });
  g.sprintNoise(p);
  listen();
  // Lumos toggled near it.
  p.activityAt = -Infinity;
  p.tseq = 0;
  p.lastStateAt = Date.now() - 100;
  g.onPlayerState('p0', { tseq: 0, x: p.x, z: p.z, yaw: 0, pitch: 0, li: false, mv: false }); // the first state: Nox
  assert.equal(g.lastActivity, undefined, 'hearing the starting state is not a toggle');
  p.lastStateAt = Date.now() - 100;
  g.onPlayerState('p0', { tseq: 0, x: p.x, z: p.z, yaw: 0, pitch: 0, li: true, mv: false }); // F: Lumos
  listen();
  // The gate breaking open, and a prisoner crying out.
  g.openGate('P0', p);
  listen();
  p.captured = true;
  p.pingAt = 0;
  g.onPing('p0');
  listen();
  assert.deepEqual(kinds, ['sprint', 'lumos', 'gate', 'help']);
  // The cage: it looks in from the gate, it never goes in.
  assert.equal(m.ping.kind, 'help');
  assert.equal(m.ping.enter, false);
  const gate = map.props[map.ids.gate];
  assert.ok(Math.hypot(m.ping.look.x - gate.x, m.ping.look.z - gate.z) < 3);
});

test('a quieter ping turns its march (after a while) but never pulls it out of a room it has stepped into', () => {
  const { g, m, p, task } = wrathSetup();
  use(g, p, task.id, run); // a task: priority 5
  const other = { x: m.x, z: m.z, floor: m.floor };
  assert.equal(g.activity('sprint', other, null), false, 'a sprint elsewhere does not turn it');
  m.ping.at -= AI.OVERRIDE_AFTER + 1; // still marching, a while later
  m.ping.stage = 'enter'; // …but already in the room
  assert.equal(g.activity('sprint', other, null), false, 'it finishes checking the room');
  m.ping.stage = 'approach';
  assert.equal(g.activity('sprint', other, null), true, 'on its way, after a while, it can be turned');
  assert.equal(m.ping.kind, 'sprint');
});
