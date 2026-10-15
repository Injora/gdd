// The Malphas Amalgam: AI state machine, capture → Cage → rescue, game over,
// bot rescue pathfinding, debug controls. (Its Step 6 rules — unkillable,
// sight-lock, invisibility, the three lock-breaking Ultimates — are in
// keeper.test.js.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/Game.js';
import { roomySeed } from './_seeds.js';
import { AI } from '../server/Monster.js';
import { isPassable } from '../shared/pathfinding.js';
import { lineOfSight, moveCircle, overlapsSolid } from '../shared/collision.js';
import { PHASE, CHANNEL, PLAYER_RADIUS, tileCenter, worldToTile, yawFromDir } from '../shared/constants.js';

function makeGame(members, seed) {
  const events = [];
  const io = { to: () => ({ emit: (name, data) => events.push({ name, data }) }), sockets: { sockets: new Map() } };
  const lobby = {
    room: 'test',
    seed: seed ?? roomySeed(),
    hostId: members[0].id,
    members: members.map((m) => ({ name: m.id.toUpperCase(), isBot: false, ...m })),
  };
  const game = new Game(io, lobby);
  game.events = events;
  return game;
}
const humans = (...wizards) => wizards.map((w, i) => ({ id: `p${i}`, wizardId: w }));
const evs = (g, type) => g.events.filter((e) => e.name === 'game:event' && e.data.type === type).map((e) => e.data);
const run = (g, seconds, until) => {
  for (let t = 0; t < seconds; t += 0.05) {
    g.step(0.05);
    if (until?.()) return true;
  }
  return false;
};

function openRow(g, len, floor = 0) {
  const f = g.map.floors[floor];
  const ok = (x, y) => isPassable(f, x, y) && !overlapsSolid(g.world, floor, tileCenter(x), tileCenter(y), 0.95);
  for (let y = 2; y < f.h - 2; y++) {
    for (let x = 2; x < f.w - len - 2; x++) {
      let good = true;
      for (let k = 0; k < len && good; k++) good = ok(x + k, y) && ok(x + k, y - 1) && ok(x + k, y + 1);
      if (good) return { x, y };
    }
  }
  throw new Error('no open row');
}
const put = (b, tx, ty, floor = 0) => { b.x = tileCenter(tx); b.z = tileCenter(ty); b.floor = floor; };

/** Tome read, monster awake but deterministic (no random aggression). */
function awake(g) {
  g.tomeReadBy = 'test';
  g.setPhase(PHASE.HEARTS);
  g.monster.awaken();
  g.monster.aggression = 0;
  return g.monster;
}

// ---------------------------------------------------------------------------

test('dormant before the Tome: hidden, untargetable, deaf to noise', () => {
  const g = makeGame(humans('parthius'));
  const m = g.monster;
  m.nextHauntAt = Infinity;
  run(g, 3);
  assert.equal(m.state, 'dormant');
  assert.ok(m.hidden);
  assert.equal(g.monsters().length, 0);
  g.noise(g.players.get('p0'), Infinity, 'heart');
  assert.equal(m.state, 'dormant');
});

test('haunting: peeks from a distant corner in view, vanishes when a wand lights it', () => {
  const g = makeGame(humans('parthius'));
  const m = g.monster;
  m.nextHauntAt = Infinity;
  const p = g.players.get('p0');
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) {
    const tile = m.tiles[0][Math.floor(Math.random() * m.tiles[0].length)];
    p.x = tile.x;
    p.z = tile.z;
    p.yaw = 0;
    p.light = false;
    m.startHaunt(p);
    ok = m.state === 'haunt';
  }
  assert.ok(ok, 'found a haunting spot');
  const d = Math.hypot(m.x - p.x, m.z - p.z);
  assert.ok(d >= 14 && d <= 24, `distance ${d}`);
  assert.ok(lineOfSight(g.map, 0, p.x, p.z, m.x, m.z), 'visible from the victim');
  assert.ok(!m.hidden && !m.targetable, 'an apparition, not a target');

  p.light = true;
  p.yaw = yawFromDir(m.x - p.x, m.z - p.z);
  g.step(0.05);
  assert.equal(m.state, 'haunt', 'lingers for a lit glimpse');
  run(g, AI.HAUNT_LIT_GRACE + 0.05);
  assert.equal(m.state, 'dormant');
  assert.ok(m.hidden);
  assert.equal(evs(g, 'monster:vanish').at(-1).lit, true);
});

test('a haunting also fades on its own after a few seconds', () => {
  const g = makeGame(humans('parthius'));
  const m = g.monster;
  m.nextHauntAt = Infinity;
  const p = g.players.get('p0');
  for (let i = 0; i < 60 && m.state !== 'haunt'; i++) {
    const tile = m.tiles[0][Math.floor(Math.random() * m.tiles[0].length)];
    p.x = tile.x;
    p.z = tile.z;
    p.light = false;
    m.startHaunt(p);
  }
  run(g, AI.HAUNT_LIFE + 0.2);
  assert.equal(m.state, 'dormant');
  assert.equal(evs(g, 'monster:vanish').at(-1).lit, false);
});

test('reading the Tome wakes it out of sight; it then stalks at a distance', () => {
  const g = makeGame(humans('parthius', 'soham'));
  const row = openRow(g, 6);
  const p = g.players.get('p0');
  put(p, row.x + 2, row.y);
  p.light = false;
  g.players.get('p1').floor = 1;
  g.completeInteraction(p, g.props[g.map.ids.tome]);
  const m = g.monster;
  m.aggression = 0;
  assert.equal(g.phase, PHASE.HEARTS);
  assert.equal(m.state, 'stalking');
  assert.ok(!m.hidden);
  assert.equal(evs(g, 'monster:awaken').length, 1);
  assert.ok(Math.hypot(m.x - p.x, m.z - p.z) >= 12, 'appears far away');

  let inBand = 0, ticks = 0, travelled = 0, last = { x: m.x, z: m.z };
  for (let t = 0; t < 20; t += 0.05) {
    g.step(0.05);
    if (m.state !== 'stalking') break;
    const d = m.floor === p.floor ? Math.hypot(m.x - p.x, m.z - p.z) : 99;
    ticks++;
    if (d >= AI.TOO_CLOSE) inBand++;
    travelled += Math.hypot(m.x - last.x, m.z - last.z);
    last = { x: m.x, z: m.z };
  }
  assert.ok(travelled > 5, 'it prowls between stalking spots');
  assert.ok(inBand / ticks > 0.9, `keeps its distance while stalking (${inBand}/${ticks})`);
});

test('noise: sprinting nearby, casting, and a dying Heart start a hunt', () => {
  const g = makeGame(humans('parthius', 'soham'));
  const m = awake(g);
  const row = openRow(g, 8);
  const p = g.players.get('p0');
  put(p, row.x, row.y);
  const placeMonster = (dx) => { m.setState('stalking'); m.x = p.x + dx; m.z = p.z; m.floor = 0; };

  placeMonster(12);
  g.noise(p, 10, 'sprint');
  assert.equal(m.state, 'stalking', 'sprinting 12 units away is not heard');
  placeMonster(9);
  g.noise(p, 10, 'sprint');
  assert.equal(m.state, 'hunting');
  assert.equal(m.targetId, 'p0');

  placeMonster(13);
  g.spells.cast(p, yawFromDir(-1, 0));
  assert.equal(m.state, 'hunting', 'spellcasting carries 14 units');

  // A dying Heart is felt anywhere: it goes to look (it never knows who did it).
  m.setState('stalking');
  m.floor = 1;
  m.hear({ x: 5, z: 5, floor: 0 }, Infinity, 'heart');
  assert.equal(m.state, 'searching');
  assert.deepEqual(m.lastKnown, { x: 5, z: 5, floor: 0 });
});

test('staring at it with a lit wand for 1.5s makes it duck out of sight or charge', () => {
  for (let trial = 0; trial < 6; trial++) {
    const g = makeGame(humans('parthius', 'soham'));
    const m = awake(g);
    g.players.get('p1').floor = 1;
    const row = openRow(g, 8);
    const p = g.players.get('p0');
    put(p, row.x, row.y);
    put(m, row.x + 5, row.y);
    m.yaw = yawFromDir(-1, 0);
    m.blindUntil = Infinity; // (isolate the stare from its own sight-lock)
    p.yaw = yawFromDir(1, 0);
    p.light = true;
    m.setState('stalking');
    m.peekUntil = Infinity; // hold still while being stared at
    run(g, 1.4);
    assert.equal(m.state, 'stalking', 'not yet');
    run(g, 0.2);
    const ducked = m.state === 'stalking' && m.goal && !lineOfSight(g.map, 0, p.x, p.z, m.goal.x, m.goal.z);
    assert.ok(m.state === 'hunting' || ducked, `reacted (state ${m.state})`);
  }
});

test('hunt → lunge → capture: the victim lands in the Cell; the Amalgam retreats 12–18s', () => {
  const g = makeGame(humans('parthius', 'soham'));
  const m = awake(g);
  const row = openRow(g, 8);
  const p = g.players.get('p0');
  put(p, row.x, row.y);
  put(g.players.get('p1'), row.x, row.y); // a free ally (no game over)
  g.players.get('p1').floor = 0;
  g.players.get('p1').x += 40;
  put(m, row.x + 5, row.y);
  m.hunt(p, 'test');
  assert.ok(run(g, 8, () => evs(g, 'capture').length > 0), 'lunge landed');
  const cap = evs(g, 'capture')[0];
  assert.equal(cap.id, 'p0');
  assert.ok(p.capturing > 0 && !p.captured, 'jumpscare first');
  assert.equal(m.state, 'retreating');

  run(g, 1.2);
  assert.ok(!p.captured, 'the 1.5s capture screen is still playing');
  run(g, 0.4);
  assert.ok(p.captured);
  assert.equal(p.floor, g.map.cell.floor);
  const room = g.map.floors[p.floor].roomIds[worldToTile(p.z) * g.map.floors[p.floor].w + worldToTile(p.x)];
  assert.equal(room, g.map.cell.roomId, 'inside the Underground Cage');
  assert.ok(!g.propState[g.map.ids.gate]?.open, 'gate locked');
  assert.equal(evs(g, 'captured').length, 1);
  assert.ok(m.hidden, 'melted into the dark');

  run(g, AI.RETREAT_MIN - 2.5);
  assert.ok(m.hidden && m.state === 'retreating', 'still gone');
  run(g, AI.RETREAT_MAX - AI.RETREAT_MIN + 2);
  assert.ok(!m.hidden, 'back');
  assert.notEqual(m.state, 'retreating');
});

test('a Void-shielded wizard is not captured: the lunge rebounds', () => {
  const g = makeGame(humans('himanshu', 'soham'));
  const m = awake(g);
  const row = openRow(g, 8);
  const p = g.players.get('p0');
  put(p, row.x, row.y);
  g.players.get('p1').floor = 1;
  put(m, row.x + 3, row.y);
  p.shieldUntil = Infinity;
  m.hunt(p, 'test');
  assert.ok(run(g, 6, () => evs(g, 'monster:blocked').length > 0));
  assert.equal(evs(g, 'capture').length, 0);
  assert.ok(m.isBlocked() && m.isKnocked());
});

test('locked on, it never gives up the chase: out of sight, on another floor, it still comes', () => {
  const g = makeGame(humans('parthius', 'soham'), 31337);
  const m = awake(g);
  g.players.get('p1').floor = 1;
  const p = g.players.get('p0');
  // Prey far away and out of sight.
  const tile = m.tiles[0].find((tl) => m.tiles[0].some((o) => Math.hypot(o.x - tl.x, o.z - tl.z) > 50 && !lineOfSight(g.map, 0, o.x, o.z, tl.x, tl.z)));
  const far = m.tiles[0].find((o) => Math.hypot(o.x - tile.x, o.z - tile.z) > 50 && !lineOfSight(g.map, 0, o.x, o.z, tile.x, tile.z));
  p.x = tile.x; p.z = tile.z; p.floor = 0; p.light = false; p.crouch = true;
  m.place({ x: far.x, z: far.z, floor: 0 });
  m.hidden = false;
  m.setState('stalking');
  m.hunt(p, 'test');
  p.capturing = 0;
  const reached = run(g, 90, () => Math.hypot(m.x - p.x, m.z - p.z) < 4 || evs(g, 'capture').length > 0);
  assert.ok(reached, 'it ran them down across the house, never seeing them until the end');
  assert.equal(evs(g, 'monster:hunt').length, 1, 'one lock, never dropped');
});

test('unkillable before the Hearts are gone: spells do no damage and never banish it', () => {
  const g = makeGame(humans('parthius', 'soham'));
  const m = awake(g);
  m.damage(500, 'fire');
  assert.equal(m.hp, m.maxHp);
  assert.ok(!m.dead);
  assert.equal(evs(g, 'monster:damage').at(-1).immune, true);
  // Three elements in quick succession no longer drive it off.
  m.burn(10, 5, 0.1);
  m.stun(0.5);
  m.knockback(m.x - 1, m.z, 2, 0.3);
  run(g, 1);
  assert.notEqual(m.state, 'retreating');
  assert.equal(evs(g, 'monster:banished').length, 0);
  assert.equal(m.hp, m.maxHp, 'fire does not even scorch it');
});

test('ordinary crowd control only stalls a locked chase: Psychic Torment and Sacred Bind', () => {
  const g = makeGame(humans('injorath', 'soham'));
  const m = awake(g);
  const p = g.players.get('p0');
  m.hunt(p, 'test');
  m.torment(2, 6);
  assert.equal(m.state, 'hunting', 'the chase is not broken');
  assert.ok(m.st.tormentUntil - g.time <= AI.CC_CAP + 1e-9, 'and it only falters for a moment');
  m.stun(3.5);
  assert.equal(m.state, 'hunting');
  assert.ok(m.st.stunUntil - g.time <= AI.CC_CAP + 1e-9);
  m.freeze(30); // (a plain freeze, not Dawn)
  assert.ok(m.st.frozenUntil - g.time <= AI.CC_CAP + 1e-9);
  m.knockback(m.x - 1, m.z, 9, 1);
  assert.ok(m.st.knockLeft <= AI.KNOCK_CAP + 1e-9);
  assert.equal(m.targetId, 'p0');
});

test('enrage: hunting speed rises with every destroyed Heart', () => {
  const g = makeGame(humans('parthius'));
  const m = awake(g);
  const base = m.huntSpeed();
  for (const h of g.map.hearts.slice(0, 4)) g.destroyed.add(h.propId);
  assert.ok(Math.abs(m.huntSpeed() - (base + 4 * AI.ENRAGE_PER_HEART)) < 1e-9);
});

test('with a prisoner it guards the basement without camping the gate', () => {
  const g = makeGame(humans('parthius', 'soham'));
  const m = awake(g);
  const prisoner = g.players.get('p0');
  const pt = g.map.cell.points[0];
  Object.assign(prisoner, { x: pt.x, z: pt.z, floor: g.map.cell.floor, captured: true });
  const free = g.players.get('p1');
  free.light = false;
  free.crouch = true;
  const gate = g.props[g.map.ids.gate];
  m.banish('capture'); // what always follows a capture
  let basement = 0, nearGate = 0, ticks = 0;
  for (let t = 0; t < 180; t += 0.05) {
    g.step(0.05);
    if (m.state === 'hunting') m.setState('stalking'); // isolate the guarding behaviour
    if (m.hidden) continue;
    ticks++;
    if (m.floor === g.map.cell.floor) {
      basement++;
      if (Math.hypot(m.x - gate.x, m.z - gate.z) < 3) nearGate++;
    }
  }
  assert.ok(basement / ticks > 0.25, `prowls the basement (${basement}/${ticks})`);
  assert.ok(nearGate / ticks < 0.1, `does not camp the gate (${nearGate}/${ticks})`);
});

test('rescue: breaking the lock frees every prisoner, who can walk out', () => {
  const g = makeGame(humans('parthius', 'soham', 'kartavian'));
  const gate = g.props[g.map.ids.gate];
  for (const id of ['p0', 'p1']) g.capture(g.players.get(id), g.monster);
  run(g, 1.6);
  assert.deepEqual(g.prisoners().map((p) => p.id).sort(), ['p0', 'p1']);
  const rescuer = g.players.get('p2');
  Object.assign(rescuer, { x: gate.front.x, z: gate.front.z, floor: gate.floor });
  g.onInteract('p2', gate.id);
  assert.equal(rescuer.channel.duration, CHANNEL.gate);
  run(g, CHANNEL.gate + 0.1);
  assert.ok(g.propState[gate.id].open);
  assert.equal(g.prisoners().length, 0);
  assert.deepEqual(evs(g, 'freed')[0].ids.sort(), ['p0', 'p1']);

  // Walk a freed prisoner west through the open gate.
  const p = g.players.get('p0');
  let pos = { x: p.x, z: gate.z };
  for (let i = 0; i < 80; i++) pos = moveCircle(g.world, p.floor, pos.x, pos.z, -0.15, 0, PLAYER_RADIUS);
  assert.ok(pos.x < gate.front.x, 'out of the Cell');
});

test('the gate stays locked against a prisoner pushing on it', () => {
  const g = makeGame(humans('parthius', 'soham'));
  g.capture(g.players.get('p0'), g.monster);
  run(g, 1.6);
  const p = g.players.get('p0');
  const gate = g.props[g.map.ids.gate];
  let pos = { x: p.x, z: gate.z };
  for (let i = 0; i < 80; i++) pos = moveCircle(g.world, p.floor, pos.x, pos.z, -0.15, 0, PLAYER_RADIUS);
  assert.ok(pos.x > gate.collider.x, 'still inside');
});

test('everyone held at once → game over; Retry restores the phase at the Foyer', () => {
  const g = makeGame(humans('parthius', 'soham'));
  const m = awake(g);
  g.capture(g.players.get('p0'), m);
  run(g, 1.6);
  assert.notEqual(g.phase, PHASE.GAMEOVER, 'one free wizard left');
  g.capture(g.players.get('p1'), m);
  run(g, 1.6);
  assert.equal(g.phase, PHASE.GAMEOVER);
  assert.equal(evs(g, 'gameover').length, 1);

  g.restartPhase();
  assert.equal(g.phase, PHASE.HEARTS);
  for (const p of g.players.values()) {
    assert.ok(!p.captured);
    assert.equal(p.floor, g.map.spawn.floor);
  }
  assert.ok(m.hidden, 'the Amalgam gives you a head start');
  assert.equal(evs(g, 'restart').length, 1);
});

test('bots run to the Cage (down the stairs) and break the lock for a captured human', () => {
  const g = makeGame([{ id: 'h', wizardId: 'parthius' }, { id: 'b1', wizardId: 'soham', isBot: true }]);
  g.monster.nextHauntAt = Infinity; // keep the Amalgam out of it
  const h = g.players.get('h');
  g.capture(h, g.monster);
  run(g, 1.6);
  assert.ok(h.captured);
  const bot = g.players.get('b1');
  assert.equal(bot.floor, 0);
  const freed = run(g, 120, () => !h.captured);
  assert.ok(freed, `bot freed the prisoner (bot at floor ${bot.floor} ${bot.x.toFixed(1)},${bot.z.toFixed(1)})`);
  assert.ok(g.propState[g.map.ids.gate].open);
  assert.equal(evs(g, 'freed')[0].by, bot.name, 'the bot did it');
});

test('bot names follow their wizard when swapped', () => {
  const g = makeGame([{ id: 'h', wizardId: 'parthius' }, { id: 'b1', wizardId: 'soham', isBot: true, name: 'Soham (bot)' }]);
  g.debugWizard('h', 'soham');
  const bot = g.players.get('b1');
  assert.equal(bot.wizardId, 'parthius');
  assert.equal(bot.name, 'Parthius (bot)');
  assert.equal(evs(g, 'roster')[0].players.find((m) => m.id === 'b1').name, 'Parthius (bot)');
});

test('a prisoner can cast through the cage bars at the Amalgam outside', () => {
  const g = makeGame(humans('parthius', 'soham'));
  const m = awake(g);
  const gate = g.props[g.map.ids.gate];
  const p = g.players.get('p0');
  Object.assign(p, { x: tileCenter(gate.tx + 1), z: gate.z, floor: gate.floor, captured: true });
  m.place({ x: tileCenter(gate.tx - 4), z: gate.z, floor: gate.floor });
  m.hidden = false;
  m.setState('stalking');
  m.peekUntil = Infinity;
  g.spells.cast(p, yawFromDir(-1, 0));
  run(g, 1);
  const impact = evs(g, 'impact')[0];
  assert.equal(impact?.hit, 'amalgam', 'fireball flew between the bars');
  assert.equal(evs(g, 'monster:damage').at(-1).immune, true, '(it shrugs it off)');
});

test('debug: P cycles Husk → Haunt → Stalk → Hunt → Capture → Auto; K captures and frees', () => {
  const g = makeGame(humans('parthius', 'soham'));
  const p = g.players.get('p0');
  g.players.get('p1').floor = 1;
  const modes = [];
  for (let i = 0; i < 6; i++) {
    g.debugMode('p0');
    modes.push(evs(g, 'debug:mode').at(-1).mode);
    if (modes.at(-1) === 'husk') assert.ok(g.husk);
    if (modes.at(-1) === 'stalk') assert.ok(g.monster.state === 'stalking' && !g.monster.hidden && !g.husk);
    if (modes.at(-1) === 'hunt') assert.equal(g.monster.state, 'hunting');
    if (modes.at(-1) === 'capture') {
      assert.ok(run(g, 4, () => evs(g, 'capture').length > 0), 'capture test lunges at you');
      run(g, 1.6);
      assert.ok(p.captured);
      g.debugCapture('p0'); // K while held → rescue
      assert.ok(!p.captured);
    }
  }
  assert.deepEqual(modes, ['husk', 'haunt', 'stalk', 'hunt', 'capture', 'auto']);
  assert.equal(g.monster.state, 'dormant', 'auto before the Tome = dormant');

  // K when free: instant capture.
  const before = evs(g, 'capture').length;
  g.debugCapture('p0');
  assert.equal(evs(g, 'capture').length, before + 1);
  run(g, 1.6);
  assert.ok(p.captured);
});
