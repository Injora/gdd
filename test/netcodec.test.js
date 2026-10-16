// Step 9: the compact snapshot protocol round-trips real game snapshots,
// sends slow state only when it changes, and is several times smaller.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/Game.js';
import { PHASE } from '../shared/constants.js';
import { SnapshotEncoder, SnapshotDecoder, SCHEMA } from '../shared/netcodec.js';

function makeGame() {
  const io = { to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } };
  const g = new Game(io, {
    room: 't', hostId: 'p0', seed: 4242,
    members: ['parthius', 'soham', 'himandriel', 'kartavian'].map((wizardId, i) => ({ id: `p${i}`, name: `P${i}`, wizardId, isBot: false })),
  });
  g.monster.nextHauntAt = Infinity;
  g.tomeReadBy = 't';
  g.setPhase(PHASE.HEARTS);
  return g;
}
const run = (g, s) => { for (let t = 0; t < s; t += 0.05) g.step(0.05); };

/** Every field matches, within the quantization of the fast ones. */
function assertClose(actual, expected, path = 'snap') {
  const TOL = { x: 0.006, z: 0.006, vx: 0.006, vz: 0.006, yaw: 0.025, pitch: 0.007, u: 0.006, t: 0.001, fl: 0.051, dw: 0.051 };
  for (const k of Object.keys(expected)) {
    const e = expected[k], a = actual[k];
    if (k === 'yaw') {
      const d = Math.atan2(Math.sin(a - e), Math.cos(a - e));
      assert.ok(Math.abs(d) <= TOL.yaw, `${path}.${k}: ${a} vs ${e}`);
    } else if (TOL[k] !== undefined && typeof e === 'number') {
      assert.ok(Math.abs(a - e) <= TOL[k], `${path}.${k}: ${a} vs ${e}`);
    } else if (Array.isArray(e) && ['players', 'monsters', 'prj', 'ents'].includes(k)) {
      assert.equal(a.length, e.length, `${path}.${k} length`);
      e.forEach((x, i) => assertClose(a[i], x, `${path}.${k}[${i}]`));
    } else {
      assert.deepEqual(a ?? null, e ?? null, `${path}.${k}`);
    }
  }
}

test('round trip: a live game (players, the Keeper, a Sin with hazards, projectiles) decodes to the same snapshot', () => {
  const g = makeGame();
  const enc = new SnapshotEncoder(), dec = new SnapshotDecoder();
  const p = g.players.get('p0');
  g.debugArena('p0', { sin: 'gluttony' });
  run(g, 4);
  p.yaw = 2.5;
  p.pitch = -0.6;
  g.spells.cast(p, p.yaw, 0, 0); // a projectile
  g.onInvis('p1');
  for (let i = 0; i < 40; i++) {
    g.step(0.05);
    const snap = g.snapshot();
    const { bin, delta } = enc.encode(snap, g.time);
    dec.applyDelta(delta);
    assertClose(dec.decode(bin), snap);
  }
  const snap = g.snapshot();
  assert.ok(snap.monsters.some((m) => m.kind === 'sin' && m.hz?.length), 'hazards travelled too');
});

test('slow state is sent only when it changes; fields that disappear are removed', () => {
  const g = makeGame();
  const enc = new SnapshotEncoder(), dec = new SnapshotDecoder();
  const first = enc.encode(g.snapshot(), 0);
  assert.ok(first.delta.ids.players.length === 4 && first.delta.top.phase === PHASE.HEARTS, 'the first frame names everyone');
  dec.applyDelta(first.delta);
  // Moving only changes fast fields: no delta at all.
  for (const pl of g.players.values()) pl.x += 0.5;
  const moved = enc.encode(g.snapshot(), 0.05);
  assert.equal(moved.delta, null, 'pure movement is binary only');
  assert.ok(dec.decode(moved.bin).players.every((pl, i) => Math.abs(pl.x - [...g.players.values()][i].x) < 0.01));
  // A buff appears: exactly that field travels.
  g.onInvis('p2');
  const buffed = enc.encode(g.snapshot(), 0.1);
  const idx = buffed.delta.players && Object.keys(buffed.delta.players);
  assert.deepEqual(idx, ['2']);
  assert.deepEqual(buffed.delta.players[2], { bf: ['invis'] });
  dec.applyDelta(buffed.delta);
  assert.deepEqual(dec.decode(buffed.bin).players[2].bf, ['invis']);
  // A field that goes away (a custom one) is removed on the client.
  const snap = g.snapshot();
  snap.monsters[0].extra = 1;
  dec.applyDelta(enc.encode(snap, 0.15).delta);
  const gone = enc.encode(g.snapshot(), 0.2);
  assert.deepEqual(gone.delta.rm.monsters, { 0: ['extra'] });
  dec.applyDelta(gone.delta);
  assert.ok(!('extra' in dec.decode(gone.bin).monsters[0]));
});

test('a dropped volatile frame is harmless; entities that vanish and return are re-sent in full', () => {
  const g = makeGame();
  const enc = new SnapshotEncoder(), dec = new SnapshotDecoder();
  dec.applyDelta(enc.encode(g.snapshot(), 0).delta);
  enc.encode(g.snapshot(), 0.05); // dropped (no delta, binary lost)
  const f = enc.encode(g.snapshot(), 0.1);
  dec.applyDelta(f.delta);
  assertClose(dec.decode(f.bin), g.snapshot());
  // A projectile id is never reused; the encoder forgets long-gone ones.
  const snap = g.snapshot();
  snap.prj = [{ id: 7, k: 'fireball', f: 0, x: 1, z: 2, vx: 3, vz: -4 }];
  const a = enc.encode(snap, 1);
  assert.deepEqual(a.delta.ids.prj, [[0, 7]]);
  assert.deepEqual(a.delta.prj[0], { k: 'fireball' });
  snap.prj = [];
  enc.encode(snap, 20); // gone for > 10s
  snap.prj = [{ id: 7, k: 'fireball', f: 0, x: 1, z: 2, vx: 3, vz: -4 }];
  const back = enc.encode(snap, 21);
  assert.deepEqual(back.delta.prj[0], { k: 'fireball' }, 'its slow fields come back in full');
});

test('several times smaller than the JSON snapshot (and fast fields quantized as specified)', () => {
  const g = makeGame();
  const enc = new SnapshotEncoder();
  let json = 0, compact = 0;
  enc.encode(g.snapshot(), 0); // the first, full frame
  for (let i = 0; i < 100; i++) {
    for (const pl of g.players.values()) { pl.x += 0.1; pl.yaw += 0.05; pl.moving = true; }
    g.step(0.05);
    const snap = g.snapshot();
    json += JSON.stringify(snap).length;
    const { bin, delta } = enc.encode(snap, g.time);
    compact += bin.byteLength + (delta ? JSON.stringify(delta).length : 0);
  }
  assert.ok(compact * 4 < json, `compact ${compact} B vs JSON ${json} B`);
  assert.deepEqual(SCHEMA.players.fast.find(([f]) => f === 'x'), ['x', 'pos'], 'positions are Int16 (1 cm)');
  assert.deepEqual(SCHEMA.players.fast.find(([f]) => f === 'yaw'), ['yaw', 'ang'], 'rotations are Uint8');
});

test('a tick with a delta sends binary + delta in ONE reliable packet; movement alone goes volatile', () => {
  const sent = [];
  const room = {
    emit: (ev, ...args) => sent.push({ ev, args, volatile: false }),
    get volatile() { return { emit: (ev, ...args) => sent.push({ ev, args, volatile: true }) }; },
  };
  const io = { to: () => room, sockets: { sockets: new Map() } };
  const g = new Game(io, { room: 't', hostId: 'p0', seed: 4242, members: [{ id: 'p0', name: 'P0', wizardId: 'soham', isBot: false }] });
  g.monster.nextHauntAt = Infinity;
  const frames = () => sent.filter((s) => s.ev === 'game:s');
  g.broadcastSnapshot(); // the first: everything is new
  assert.equal(frames().length, 1);
  assert.equal(frames()[0].volatile, false, 'reliable');
  assert.ok(frames()[0].args[1]?.ids, 'carrying the delta');
  sent.length = 0;
  g.players.get('p0').x += 0.5;
  g.broadcastSnapshot(); // only movement
  assert.equal(frames().length, 1);
  assert.equal(frames()[0].volatile, true, 'volatile');
  assert.equal(frames()[0].args.length, 1);
  assert.equal(sent.filter((s) => s.ev === 'game:sd').length, 0, 'never a separate delta (a volatile frame behind it would be dropped)');
});
