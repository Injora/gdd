// Step 6: the seven Hearts. Each is sealed by a 3-part room task; broken open,
// it locks its room behind blood-runes and releases one of the Seven Deadly
// Sins. Slay the Sin and the Heart dies with it; the doors open.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/Game.js';
import { findPath } from '../shared/pathfinding.js';
import { moveCircle, overlapsSolid } from '../shared/collision.js';
import { roomAt } from '../shared/mapgen.js';
import { PHASE, HEART_COUNT, PLAYER_RADIUS, TILE, tileCenter, yawFromDir } from '../shared/constants.js';
import { TASKS, TASK_STEPS } from '../shared/lore.js';
import { SINS, SIN_IDS, SIN_ULT_BONUS } from '../shared/sins.js';
import { ULT } from '../shared/wizards.js';

function makeGame(members, seed = 4242) {
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
const at = (p, prop) => {
  const spot = prop.front ?? { x: prop.x, z: prop.z };
  Object.assign(p, { x: spot.x, z: spot.z, floor: prop.floor });
};

/** Tome read; the Keeper out of the way. */
function hearts(g) {
  g.tomeReadBy = 'test';
  g.setPhase(PHASE.HEARTS);
  g.monster.hideFor(1e6);
  return g;
}

/** Do one task prop to completion (mirrors take several turns). */
function doTask(g, p, tid) {
  at(p, g.props[tid]);
  for (let k = 0; k < 4 && !g.propState[tid]?.done; k++) {
    g.onInteract(p.id, tid);
    run(g, 3, () => !p.channel);
  }
}

/** Every task of a heart done, then the heart opened with p standing at it. */
function openHeart(g, p, heart) {
  for (const tid of heart.tasks) doTask(g, p, tid);
  at(p, g.props[heart.propId]);
  g.onInteract(p.id, heart.propId);
  run(g, 3, () => g.arenas.has(heart.propId));
  return g.arenas.get(heart.propId);
}

/** Start the arena of the heart holding `sin`, with the given players inside. */
function arenaOf(g, sin, players) {
  const heart = g.map.hearts.find((h) => h.sin === sin);
  for (const tid of heart.tasks) g.propState[tid] = { done: true };
  g.propState[heart.propId] = { unsealed: true };
  const prop = g.props[heart.propId];
  for (const p of players) at(p, prop);
  g.startArena(heart, players[0]);
  const a = g.arenas.get(heart.propId);
  return { heart, a, demon: a.demon, room: a.room };
}

/** A clear spot in `room` `dist` units from (x, z) along `ang`, or the nearest one that is clear. */
function spotNear(g, room, x, z, dist, ang = 0) {
  let best = null;
  for (let yy = room.y; yy < room.y + room.h; yy++) {
    for (let xx = room.x; xx < room.x + room.w; xx++) {
      const pt = { x: tileCenter(xx), z: tileCenter(yy) };
      if (overlapsSolid(g.world, room.floor, pt.x, pt.z, 0.6)) continue;
      const want = { x: x + Math.cos(ang) * dist, z: z + Math.sin(ang) * dist };
      const d = Math.hypot(pt.x - want.x, pt.z - want.z);
      if (!best || d < best.d) best = { pt, d };
    }
  }
  return best.pt;
}

// ---------------------------------------------------------------------------

test('room tasks: three wards per Heart; nothing works before the Tome; mirrors need turning', () => {
  const g = makeGame(humans('parthius', 'soham'));
  const p = g.players.get('p0');
  const heart = g.map.hearts[0];
  at(p, g.props[heart.tasks[0]]);
  g.onInteract('p0', heart.tasks[0]);
  assert.equal(p.channel, null, 'cold before the Tome');

  hearts(g);
  // The Heart itself won't open while sealed.
  at(p, g.props[heart.propId]);
  g.onInteract('p0', heart.propId);
  assert.equal(p.channel, null);
  for (const [i, tid] of heart.tasks.entries()) {
    const prop = g.props[tid];
    assert.equal(prop.task, heart.task);
    at(p, prop);
    g.onInteract('p0', tid);
    assert.equal(p.channel.duration, TASKS[heart.task].time);
    doTask(g, p, tid);
    assert.ok(g.propState[tid].done);
    assert.equal(evs(g, 'task').at(-1).progress, i + 1);
  }
  assert.ok(g.propState[heart.propId].unsealed);
  const ev = evs(g, 'heart:unsealed')[0];
  assert.equal(ev.propId, heart.propId);
  assert.equal(ev.sin, heart.sin);

  // Mirrors: each needs 1–3 turns.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g2 = hearts(makeGame(humans('parthius'), seed));
    const h = g2.map.hearts.find((x) => x.task === 'mirror');
    if (!h) continue;
    const q = g2.players.get('p0');
    const tid = h.tasks[0];
    const turns = g2.props[tid].turns;
    at(q, g2.props[tid]);
    for (let k = 1; k <= turns; k++) {
      g2.onInteract('p0', tid);
      run(g2, 1, () => !q.channel);
      assert.equal(!!g2.propState[tid]?.done, k === turns, `turn ${k}/${turns}`);
    }
    return;
  }
});

test('breaking a Heart open seals its room: no one leaves, the Keeper cannot enter, a Sin erupts', () => {
  const g = hearts(makeGame(humans('parthius', 'soham')));
  const p = g.players.get('p0');
  const out = g.players.get('p1');
  const heart = g.map.hearts[0];
  const a = openHeart(g, p, heart);
  assert.ok(a, 'arena started');
  const room = a.room;
  const start = evs(g, 'arena:start')[0];
  assert.equal(start.sin, heart.sin);
  assert.deepEqual(start.inside, ['p0']);
  assert.ok(start.tiles.length >= 1);
  const demon = g.demons.find((d) => d.id === start.demonId);
  assert.equal(demon.sin, heart.sin);
  assert.equal(demon.hp, SINS[heart.sin].hp);
  assert.ok(demon.hp >= 120 && demon.hp <= 160);
  assert.ok(g.inArena(p));

  // Nobody walks out: every opening is a wall now, for movement and for paths.
  const f = g.map.floors[room.floor];
  const inside = [Math.floor(p.x / TILE), Math.floor(p.z / TILE)];
  const isOpening = (x, y) => a.tiles.some(([tx, ty]) => tx === x && ty === y);
  for (const [tx, ty] of a.tiles) {
    assert.ok(overlapsSolid(g.world, room.floor, tileCenter(tx), tileCenter(ty), PLAYER_RADIUS), 'blood-runes block the doorway');
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = tx + dx, y = ty + dy;
      if (isOpening(x, y) || f.roomIds[y * f.w + x] === room.id || f.tiles[y * f.w + x] === 0) continue;
      assert.equal(findPath(f, ...inside, x, y, 1e6), null, 'no path out');
    }
  }
  // The Keeper outside can't touch anyone in there.
  const m = g.monster;
  m.hidden = false;
  m.setState('stalking');
  const [ox, oy] = a.tiles[0];
  m.place({ x: tileCenter(ox), z: tileCenter(oy), floor: room.floor });
  assert.equal(g.damagePlayer(p, 30, m, 'lunge'), 'none');
  m.hunt(p, 'test');
  assert.notEqual(m.state, 'hunting', 'it cannot lock on to someone behind the runes');
  // Someone outside can't get in either.
  let outside = null;
  for (const [tx, ty] of a.tiles) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = tx + dx, y = ty + dy;
      if (!outside && !isOpening(x, y) && f.roomIds[y * f.w + x] !== room.id && f.tiles[y * f.w + x] !== 0 &&
        !overlapsSolid(g.world, room.floor, tileCenter(x), tileCenter(y), PLAYER_RADIUS)) outside = { x: tileCenter(x), z: tileCenter(y) };
    }
  }
  at(out, { ...outside, floor: room.floor });
  const tgt = demon;
  let pos = { x: out.x, z: out.z };
  for (let i = 0; i < 60; i++) pos = moveCircle(g.world, room.floor, pos.x, pos.z, (tgt.x - pos.x) * 0.05, (tgt.z - pos.z) * 0.05, PLAYER_RADIUS);
  assert.notEqual(roomAt(g.map, room.floor, pos.x, pos.z)?.id, room.id, 'locked out');
});

test('slaying the Sin destroys its Heart for good, grants the coven Ult charge and opens the doors', () => {
  const g = hearts(makeGame(humans('parthius', 'soham')));
  const p = g.players.get('p0');
  const q = g.players.get('p1');
  const heart = g.map.hearts[2];
  const a = openHeart(g, p, heart);
  const demon = a.demon;
  run(g, 2.5); // the eruption
  assert.ok(!demon.er);
  const ult0 = q.ult;
  // Fight it with real spells until it falls.
  p.ult = 0;
  for (let i = 0; i < 400 && !demon.dead; i++) {
    p.yaw = yawFromDir(demon.x - p.x, demon.z - p.z);
    p.hp = 100;
    for (const slot of [0, 1, 2, 3]) g.spells.cast(p, p.yaw, 0, slot);
    run(g, 0.25);
  }
  assert.ok(demon.dead, 'the Sin fell');
  assert.ok(g.destroyed.has(heart.propId));
  assert.ok(g.propState[heart.propId].destroyed);
  const end = evs(g, 'arena:end')[0];
  assert.equal(end.won, true);
  assert.equal(evs(g, 'heart').at(-1).sin, heart.sin);
  assert.ok(q.ult - ult0 >= ULT.HEART + SIN_ULT_BONUS - 1, 'team Ult charge');
  assert.ok(!g.arenas.has(heart.propId));
  const f = g.map.floors[a.room.floor];
  for (const [tx, ty] of a.tiles) assert.ok(!overlapsSolid(g.world, a.room.floor, tileCenter(tx), tileCenter(ty), PLAYER_RADIUS), 'the runes fade');
  assert.ok(findPath(f, Math.floor(p.x / TILE), Math.floor(p.z / TILE), ...a.tiles[0], 1e6));
  run(g, 3.5);
  assert.ok(!g.demons.includes(demon), 'its body is gone');
});

test('if everyone inside is taken, the Sin withdraws into its Heart (still unsealed) and the doors open', () => {
  const g = hearts(makeGame(humans('parthius', 'soham')));
  const p = g.players.get('p0');
  const { heart, demon } = arenaOf(g, 'wrath', [p]);
  run(g, 3);
  p.hp = 1;
  assert.equal(g.damagePlayer(p, 10, demon, 'sin'), 'captured', 'a Sin that breaks you hands you to the Keeper');
  const cap = evs(g, 'capture').at(-1);
  assert.equal(cap.sin, 'wrath');
  run(g, 0.2);
  const end = evs(g, 'arena:end').at(-1);
  assert.equal(end.won, false);
  assert.ok(g.propState[heart.propId].unsealed && !g.destroyed.has(heart.propId));
  assert.ok(!g.demons.includes(demon));
  run(g, 1.6);
  assert.ok(p.captured, 'in the cage');
});

test('every Sin erupts with its own kit (120–160 HP, telegraphed attacks)', () => {
  for (const sin of SIN_IDS) {
    const g = hearts(makeGame(humans('soham', 'parthius')));
    const p = g.players.get('p0');
    g.players.get('p1').floor = 1;
    const { demon, room } = arenaOf(g, sin, [p]);
    assert.ok(demon.maxHp >= 120 && demon.maxHp <= 160, sin);
    assert.equal(demon.snapshot().sin, sin);
    assert.ok(demon.snapshot().er, 'erupting');
    const spot = spotNear(g, room, demon.x, demon.z, 4, Math.PI / 3);
    Object.assign(p, spot);
    p.hp = 100;
    let struck = false;
    for (let t = 0; t < 14 && !struck; t += 0.05) {
      p.hp = Math.max(p.hp, 60);
      g.step(0.05);
      struck = evs(g, 'sin:attack').some((e) => e.stage === 'strike' || e.kind === 'mimic') || (sin === 'envy' && g.time > 4);
      if (sin === 'envy' && g.time > 3 && !struck) demon.damage(5, 'fire'); // Envy needs an element to copy
    }
    assert.ok(struck, `${sin} attacked`);
  }
});

test('Pride reflects spells cast at its face; flanking it or stunning it gets through', () => {
  const g = hearts(makeGame(humans('parthius', 'soham')));
  const p = g.players.get('p0');
  const s = g.players.get('p1');
  const { demon, room } = arenaOf(g, 'pride', [p, s]);
  demon.eruptUntil = 0;
  demon.timers.lance = Infinity;
  // Face-on: the fireball turns back on its caster.
  const front = spotNear(g, room, demon.x, demon.z, 3.5, Math.PI / 2);
  Object.assign(p, front);
  demon.yaw = yawFromDir(p.x - demon.x, p.z - demon.z);
  p.hp = 100;
  const hp0 = demon.hp;
  g.spells.cast(p, yawFromDir(demon.x - p.x, demon.z - p.z), 0, 0);
  run(g, 0.6);
  assert.equal(demon.hp, hp0, 'reflected');
  assert.equal(evs(g, 'sin:reflect').length, 1);
  assert.ok(p.hp < 100, 'the caster is scorched');
  // From behind it lands.
  const back = spotNear(g, room, demon.x, demon.z, 3.5, -Math.PI / 2);
  Object.assign(p, back);
  demon.yaw = yawFromDir(front.x - demon.x, front.z - demon.z);
  p.cooldowns = {};
  g.spells.cast(p, yawFromDir(demon.x - p.x, demon.z - p.z), 0, 0);
  run(g, 0.6);
  assert.ok(demon.hp < hp0, 'flanked');
  // Stunned, it can't reflect even face-on.
  const hp1 = demon.hp;
  Object.assign(p, front);
  demon.yaw = yawFromDir(p.x - demon.x, p.z - demon.z);
  demon.stun(2);
  p.cooldowns = {};
  g.spells.cast(p, yawFromDir(demon.x - p.x, demon.z - p.z), 0, 0);
  run(g, 0.6);
  assert.ok(demon.hp < hp1, 'stunned: no mirror');
});

test('Greed drains Ult charge; Lust and Gluttony drag wizards in; Envy throws elements back; Wrath speeds up; Sloth weighs the room down', () => {
  // Greed
  {
    const g = hearts(makeGame(humans('soham', 'parthius')));
    const p = g.players.get('p0');
    g.players.get('p1').floor = 1;
    const { demon, room } = arenaOf(g, 'greed', [p]);
    Object.assign(p, spotNear(g, room, demon.x, demon.z, 5, 1));
    p.ult = 80;
    assert.ok(run(g, 12, () => evs(g, 'sin:impact').some((e) => e.hits.includes('p0'))), 'molten gold landed on you');
    assert.ok(p.ult <= 80 - SINS.greed.gold.drain + ULT.PASSIVE * 12, `Ult charge stolen (${p.ult})`);
  }
  // Lust
  {
    const g = hearts(makeGame(humans('soham', 'parthius')));
    const p = g.players.get('p0');
    g.players.get('p1').floor = 1;
    const { demon, room } = arenaOf(g, 'lust', [p]);
    demon.baseSpeed = 0;
    demon.S = { ...demon.S, speed: 0 };
    Object.assign(p, spotNear(g, room, demon.x, demon.z, 6, 2));
    assert.ok(run(g, 12, () => evs(g, 'sin:attack').some((e) => e.kind === 'ribbons' && e.stage === 'strike' && e.hits.includes('p0'))), 'ribbons');
    assert.ok(p.impulseUntil > g.time - 0.5, 'dragged toward it');
  }
  // Gluttony: acid that spreads, then the vacuum
  {
    const g = hearts(makeGame(humans('soham', 'parthius')));
    const p = g.players.get('p0');
    g.players.get('p1').floor = 1;
    const { demon, room } = arenaOf(g, 'gluttony', [p]);
    Object.assign(p, spotNear(g, room, demon.x, demon.z, 6, 0.5));
    assert.ok(run(g, 12, () => demon.hazards.some((h) => h.k === 'acid')), 'acid pool');
    const pool = demon.hazards.find((h) => h.k === 'acid');
    const r0 = pool.r;
    run(g, 1);
    assert.ok(pool.r > r0, 'it spreads');
    assert.ok(run(g, 12, () => evs(g, 'sin:attack').some((e) => e.kind === 'vacuum' && e.stage === 'strike')), 'vacuum');
  }
  // Envy
  {
    const g = hearts(makeGame(humans('soham', 'parthius')));
    const p = g.players.get('p0');
    g.players.get('p1').floor = 1;
    const { demon, room } = arenaOf(g, 'envy', [p]);
    demon.eruptUntil = 0;
    Object.assign(p, spotNear(g, room, demon.x, demon.z, 4, 0.3));
    demon.damage(5, 'water');
    const wave = demon.hazards.find((h) => h.k === 'wave');
    assert.equal(wave.el, 'water', 'it copies the element that struck it');
    p.hp = 100;
    assert.ok(run(g, 3, () => wave.hit.has('p0')), 'the counter-wave rolls over you');
    assert.ok(p.hp < 100);
  }
  // Wrath
  {
    const g = hearts(makeGame(humans('soham', 'parthius')));
    const p = g.players.get('p0');
    const { demon } = arenaOf(g, 'wrath', [p]);
    const calm = demon.pace();
    demon.hp = demon.maxHp * 0.25;
    assert.ok(demon.pace() > calm * 1.9, 'bleeding makes it faster');
  }
  // Sloth
  {
    const g = hearts(makeGame(humans('soham', 'parthius')));
    const p = g.players.get('p0');
    arenaOf(g, 'sloth', [p]);
    run(g, 0.2);
    assert.ok(g.spells.buffCodes(p).includes('sloth'), 'the heavy sleep settles over the room');
  }
});

test('Sin crowd control is capped at 3s; the wind dragon slams it instead of carrying it off', () => {
  const g = hearts(makeGame(humans('soham', 'parthius')));
  const p = g.players.get('p0');
  const { demon, room } = arenaOf(g, 'sloth', [p]);
  demon.eruptUntil = 0;
  demon.freeze(30);
  assert.ok(demon.st.frozenUntil - g.time <= 3 + 1e-9);
  demon.sweep([{ x: 0, z: 0 }], 9, 1);
  assert.ok(!demon.isCarried());
  assert.equal(roomAt(g.map, room.floor, demon.x, demon.z)?.id, room.id);
});

test('all seven Hearts: Convergence only after every Sin is slain', () => {
  const g = hearts(makeGame(humans('parthius', 'soham')));
  const p = g.players.get('p0');
  for (const heart of g.map.hearts) {
    const a = openHeart(g, p, heart);
    assert.ok(a, heart.name);
    assert.equal(g.phase, PHASE.HEARTS);
    a.demon.eruptUntil = 0;
    a.demon.damage(9999, 'test');
    run(g, 0.1);
  }
  assert.equal(g.destroyed.size, HEART_COUNT);
  assert.equal(g.phase, PHASE.CONVERGENCE);
  assert.equal(evs(g, 'arena:end').filter((e) => e.won).length, HEART_COUNT);
  assert.equal(new Set(evs(g, 'arena:start').map((e) => e.sin)).size, 7, 'all seven Sins');
  assert.equal(TASK_STEPS, 3);
});

test('debug L: opens the nearest Heart (or a named Sin) and pulls the coven into the arena; L again slays it', () => {
  const g = makeGame(humans('parthius', 'soham'));
  g.debugArena('p0', { sin: 'lust' });
  assert.equal(g.phase, PHASE.HEARTS);
  const a = [...g.arenas.values()][0];
  assert.equal(a.heart.sin, 'lust');
  for (const p of g.players.values()) assert.ok(a.demon.inArena(p), `${p.id} inside`);
  a.demon.eruptUntil = 0;
  g.debugArena('p0');
  run(g, 0.1);
  assert.ok(g.destroyed.has(a.heart.propId));
});
