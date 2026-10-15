// Step 6: the Keeper's rules. Unkillable until the Hearts are gone; locks on to
// the first wizard it spots; the Disillusionment Charm (V) only works if cast
// before it sees you, and only while you stand still; and only three
// Ultimates (Dawn, Mind Fracture, Devil Union) can break its lock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/Game.js';
import { AI } from '../server/Monster.js';
import { isPassable } from '../shared/pathfinding.js';
import { overlapsSolid } from '../shared/collision.js';
import { PHASE, INVIS, HP, tileCenter, worldToTile, yawFromDir } from '../shared/constants.js';

function makeGame(members, seed = 777) {
  const events = [];
  const io = { to: () => ({ emit: (name, data) => events.push({ name, data }) }), sockets: { sockets: new Map() } };
  const game = new Game(io, {
    room: 't', hostId: members[0].id, seed,
    members: members.map((m) => ({ name: m.id.toUpperCase(), isBot: false, ...m })),
  });
  game.events = events;
  game.monster.nextHauntAt = Infinity;
  return game;
}
const humans = (...w) => w.map((wizardId, i) => ({ id: `p${i}`, wizardId }));
const evs = (g, type) => g.events.filter((e) => e.name === 'game:event' && e.data.type === type).map((e) => e.data);
const run = (g, s, until) => { for (let t = 0; t < s; t += 0.05) { g.step(0.05); if (until?.()) return true; } return false; };

function openRow(g, len) {
  const f = g.map.floors[0];
  const ok = (x, y) => isPassable(f, x, y) && !overlapsSolid(g.world, 0, tileCenter(x), tileCenter(y), 0.95);
  for (let y = 3; y < f.h - 3; y++) {
    for (let x = 2; x < f.w - len - 2; x++) {
      let good = true;
      for (let k = 0; k < len && good; k++) good = ok(x + k, y) && ok(x + k, y - 1) && ok(x + k, y + 1);
      if (good) return { x, y };
    }
  }
  throw new Error('no open row');
}
const put = (b, tx, ty, floor = 0) => { b.x = tileCenter(tx); b.z = tileCenter(ty); b.floor = floor; };

/** Phase II, the Keeper awake at (tx, ty) facing west, the other wizards far away. */
function setup(wizards = ['parthius', 'soham']) {
  const g = makeGame(humans(...wizards));
  g.tomeReadBy = 't';
  g.setPhase(PHASE.HEARTS);
  const m = g.monster;
  m.awaken();
  m.aggression = 0;
  for (const [i] of wizards.entries()) if (i > 0) g.players.get(`p${i}`).floor = 1;
  const row = openRow(g, 12);
  const p = g.players.get('p0');
  put(p, row.x + 6, row.y);
  p.light = false;
  p.moving = false;
  return { g, m, p, row };
}

/** Make the Keeper prowl along the row from x0 to x1 (through the wizard's spot). */
function prowl(m, row, x0, x1) {
  m.place({ x: tileCenter(row.x + x0), z: tileCenter(row.y), floor: 0 });
  m.hidden = false;
  m.setState('stalking');
  m.yaw = yawFromDir(x1 - x0, 0);
  m.goal = { x: tileCenter(row.x + x1), z: tileCenter(row.y), floor: 0, peek: false };
  m.goalUntil = Infinity;
}

// ---------------------------------------------------------------------------

test('the Keeper is unkillable in Phases I and II: no spell, Ultimate or fire ever hurts it', () => {
  const { g, m, p } = setup(['parthius', 'soham']);
  m.place({ x: p.x + 5, z: p.z, floor: 0 });
  m.hidden = false;
  m.blindUntil = Infinity;
  const hp = m.hp;
  for (const slot of [0, 1, 2]) g.spells.cast(p, yawFromDir(1, 0), 0, slot);
  p.ult = 100;
  g.spells.cast(p, yawFromDir(1, 0), 0, 'ult'); // the Fiendfyre dragon
  run(g, 8);
  assert.equal(m.hp, hp);
  assert.ok(!m.dead);
  assert.ok(evs(g, 'monster:damage').length > 0 && evs(g, 'monster:damage').every((e) => e.immune && e.amount === 0));
  assert.equal(evs(g, 'monster:banished').filter((e) => e.reason !== 'capture').length, 0, 'never driven off');
  assert.equal(m.immune, true);
});

test('V: invisible BEFORE it sees you and standing completely still, it walks right past', () => {
  const { g, m, p, row } = setup();
  assert.ok(g.onInvis('p0').ok);
  assert.ok(g.spells.buffCodes(p).includes('invis'));
  prowl(m, row, 0, 11);
  let closest = Infinity;
  for (let t = 0; t < 8; t += 0.05) {
    g.step(0.05);
    closest = Math.min(closest, Math.hypot(m.x - p.x, m.z - p.z));
    if (m.state === 'hunting') break;
  }
  assert.ok(closest < 2, `it came right by (${closest.toFixed(2)}u)`);
  assert.notEqual(m.state, 'hunting', 'never noticed you');
  assert.equal(evs(g, 'monster:hunt').length, 0);
});

test('V: moving (or casting) within 14 units while invisible gives you away: it locks on and charges', () => {
  for (const how of ['move', 'cast']) {
    const { g, m, p, row } = setup();
    g.onInvis('p0');
    prowl(m, row, -6, 12);
    m.place({ x: p.x - INVIS.sense + 1, z: p.z, floor: 0 });
    if (how === 'move') p.moving = true;
    else g.spells.cast(p, yawFromDir(1, 0), 0, 0);
    run(g, 0.2);
    assert.equal(m.state, 'hunting', how);
    assert.equal(m.targetId, 'p0');
    assert.equal(evs(g, 'monster:hunt')[0].reason, 'sensed');
    // ...but beyond 14 units, moving is safe.
    const s2 = setup();
    s2.g.onInvis('p0');
    prowl(s2.m, s2.row, -6, -5);
    s2.m.place({ x: s2.p.x - INVIS.sense - 2, z: s2.p.z, floor: 0 });
    s2.p.moving = true;
    run(s2.g, 0.3);
    assert.notEqual(s2.m.state, 'hunting', 'too far to sense');
  }
});

test('spotted = locked: going invisible AFTER it has seen you does not work; it still runs you down', () => {
  const { g, m, p, row } = setup();
  prowl(m, row, 0, 1);
  m.yaw = yawFromDir(1, 0); // looking straight at you, 6 tiles off
  p.light = true;
  assert.ok(run(g, 1, () => m.state === 'hunting'), 'spotted');
  assert.equal(evs(g, 'monster:hunt')[0].reason, 'sighted');
  const res = g.onInvis('p0');
  assert.ok(res.ok && res.late, 'too late');
  assert.equal(m.state, 'hunting');
  // Run! (The wizard sprints east; it still knows exactly where they are.)
  let caught = false;
  for (let t = 0; t < 20 && !caught; t += 0.05) {
    if (!p.capturing) {
      p.x += 2 * 0.05;
      if (overlapsSolid(g.world, 0, p.x, p.z, 0.35)) p.x -= 2 * 0.05;
      p.moving = true;
    }
    g.step(0.05);
    caught = evs(g, 'capture').some((e) => e.id === 'p0');
  }
  assert.ok(caught, 'captured');
});

test('the first wizard it sees is the one it chases (a second one in plain view is ignored)', () => {
  const { g, m, p, row } = setup(['parthius', 'soham']);
  const q = g.players.get('p1');
  put(q, row.x + 8, row.y);
  m.hunt(p, 'sighted');
  m.hunt(q, 'sighted');
  assert.equal(m.targetId, 'p0');
});

test('ordinary stuns and pushes only stall its charge; they never break the lock', () => {
  const { g, m, p, row } = setup(['soham', 'kartavian']);
  prowl(m, row, 0, 1);
  m.hunt(p, 'test');
  p.yaw = yawFromDir(m.x - p.x, m.z - p.z);
  g.spells.cast(p, p.yaw, 0, 0); // Sacred Bind
  assert.ok(m.isStunned());
  run(g, AI.CC_CAP + 0.1);
  assert.ok(!m.isStunned(), 'only for a moment');
  assert.equal(m.state, 'hunting');
  assert.equal(m.targetId, 'p0');
});

for (const [wizard, ult, reason, hold] of [
  ['soham', 'Dawn of the Sacred Order', 'dawn', 30],
  ['injorath', 'Abyssal Mind Fracture', 'fracture', 10],
]) {
  test(`${ult} breaks its sight-lock and holds it ${hold}s; then you can hide`, () => {
    const { g, m, p, row } = setup([wizard, 'parthius']);
    prowl(m, row, 0, 1);
    m.hunt(p, 'test');
    p.ult = 100;
    assert.ok(g.spells.cast(p, yawFromDir(m.x - p.x, m.z - p.z), 0, 'ult').ok);
    assert.notEqual(m.state, 'hunting', 'the lock is wiped');
    assert.equal(m.targetId, null);
    const br = evs(g, 'monster:lockbroken')[0];
    assert.equal(br.reason, reason);
    assert.equal(br.targetId, 'p0');
    const pos = { x: m.x, z: m.z };
    run(g, hold - 0.5);
    assert.ok(Math.hypot(m.x - pos.x, m.z - pos.z) < 0.05, 'held in place');
    // Meanwhile: out of its sight, invisible, still. When it wakes, it does not find you.
    g.onInvis('p0');
    p.moving = false;
    run(g, 0.5 + AI.RELEASE_BLIND + 2);
    assert.notEqual(m.state, 'hunting');
  });
}

test('Devil Union: 30s immunity; the Keeper touching a wizard recoils, frozen 6s, its lock wiped', () => {
  const { g, m, p, row } = setup(['himanshu', 'soham']);
  p.ult = 100;
  assert.ok(g.spells.cast(p, yawFromDir(1, 0), 0, 'ult').ok);
  prowl(m, row, 3, 4);
  m.hunt(p, 'test');
  assert.ok(run(g, 4, () => evs(g, 'monster:recoil').length > 0), 'it touched you and recoiled');
  assert.equal(evs(g, 'capture').length, 0);
  assert.ok(m.isFrozen());
  assert.ok(m.st.frozenUntil - g.time > AI.UNION_RECOIL - 0.5);
  assert.notEqual(m.state, 'hunting');
  assert.equal(evs(g, 'monster:lockbroken')[0].reason, 'union');
  assert.equal(g.damagePlayer(p, 30, m, 'lunge'), 'immune');
});

test('V has a 12s duration and an 18s cooldown, for every wizard', () => {
  for (const w of ['injorath', 'parthius', 'himandriel', 'sushantus', 'kartavian', 'soham', 'himanshu']) {
    const g = makeGame(humans(w));
    const p = g.players.get('p0');
    assert.ok(g.onInvis('p0').ok, w);
    assert.equal(evs(g, 'invis')[0].duration, INVIS.duration);
    assert.equal(g.onInvis('p0').reason, 'cooldown');
    run(g, INVIS.duration + 0.1);
    assert.ok(!g.spells.buffCodes(p).includes('invis'), 'faded');
    assert.equal(g.onInvis('p0').reason, 'cooldown');
    run(g, INVIS.cooldown - INVIS.duration);
    assert.ok(g.onInvis('p0').ok, 'ready again');
  }
});

test('the capture screen plays for 1.5s, then you wake up in the Underground Iron Cage', () => {
  const { g, m, p } = setup();
  g.players.get('p1').floor = 0;
  m.place({ x: p.x + 1.2, z: p.z, floor: 0 });
  m.hidden = false;
  m.setState('stalking');
  m.hunt(p, 'test');
  assert.ok(run(g, 4, () => evs(g, 'capture').length > 0));
  const cap = evs(g, 'capture')[0];
  assert.equal(cap.duration, 1.5);
  assert.equal(cap.by, 'amalgam');
  run(g, 1.3);
  assert.ok(p.capturing && !p.captured, 'still screaming');
  run(g, 0.3);
  assert.ok(p.captured);
  assert.equal(p.floor, g.map.cell.floor);
  const f = g.map.floors[p.floor];
  assert.equal(f.roomIds[worldToTile(p.z) * f.w + worldToTile(p.x)], g.map.cell.roomId);
  assert.equal(g.map.rooms[g.map.cell.roomId].name, 'Underground Cage Prison');
  assert.equal(p.hp, Math.max(p.hp, HP.CELL));
});

test('bots hide: with the Keeper prowling near, a bot casts V and freezes until it passes', () => {
  const g = makeGame([{ id: 'h', wizardId: 'parthius' }, { id: 'b', wizardId: 'soham', isBot: true }]);
  g.tomeReadBy = 't';
  g.setPhase(PHASE.HEARTS);
  const m = g.monster;
  m.awaken();
  const h = g.players.get('h');
  h.floor = 1;
  const b = g.players.get('b');
  const row = openRow(g, 12);
  put(b, row.x + 6, row.y);
  prowl(m, { x: row.x, y: row.y }, 0, 11);
  run(g, 0.3);
  assert.ok(g.spells.buffCodes(b).includes('invis'), 'vanished');
  let moved = 0;
  const start = { x: b.x, z: b.z };
  for (let t = 0; t < 3; t += 0.05) {
    g.step(0.05);
    if (Math.hypot(m.x - b.x, m.z - b.z) < INVIS.sense) moved = Math.max(moved, Math.hypot(b.x - start.x, b.z - start.z));
  }
  assert.ok(moved < 0.01, 'held perfectly still while it was near');
  assert.notEqual(m.targetId, 'b');
});
