// Spell system: cooldowns for all seven abilities, every status effect against
// the Training Husk, Terra Spike barricades in collision + pathfinding,
// knockback wall-clamping, Void shield blocks, Soham's gate passive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/Game.js';
import { roomySeed } from './_seeds.js';
import { TrainingHusk } from '../server/TrainingHusk.js';
import { WIZARDS, WIZARD_BY_ID } from '../shared/wizards.js';
import { findPath, isPassable } from '../shared/pathfinding.js';
import { moveCircle, overlapsSolid } from '../shared/collision.js';
import { CHANNEL, PLAYER_RADIUS, TILE, TILE_WALL, tileCenter, yawFromDir } from '../shared/constants.js';

const EAST = yawFromDir(1, 0);

function makeGame(wizardIds) {
  const events = [];
  const io = {
    to: () => ({ emit: (name, data) => events.push({ name, data }) }),
    sockets: { sockets: new Map() },
  };
  const lobby = {
    room: 'test',
    seed: roomySeed(),
    members: wizardIds.map((w, i) => ({ id: `p${i}`, name: `P${i}`, wizardId: w, isBot: false })),
  };
  const game = new Game(io, lobby);
  game.events = events;
  return game;
}

const gameEvents = (game, type) => game.events.filter((e) => e.name === 'game:event' && e.data.type === type).map((e) => e.data);

function run(game, seconds) {
  for (let t = 0; t < seconds; t += 0.05) game.step(0.05);
}

/** A row of `len` tiles with open space above and below (a room interior). */
function openRow(game, len) {
  const f = game.map.floors[0];
  const ok = (x, y) => isPassable(f, x, y) && !overlapsSolid(game.world, 0, tileCenter(x), tileCenter(y), 0.95);
  for (let y = 2; y < f.h - 2; y++) {
    for (let x = 2; x < f.w - len - 2; x++) {
      let good = true;
      for (let k = 0; k < len && good; k++) good = ok(x + k, y) && ok(x + k, y - 1) && ok(x + k, y + 1);
      if (good) return { x, y };
    }
  }
  throw new Error('no open row found');
}

function place(body, tx, ty, floor = 0) {
  body.x = tileCenter(tx);
  body.z = tileCenter(ty);
  body.floor = floor;
}

/** One caster of `wizardId` at the start of an open row, a Husk `dist` tiles east. */
function duel(wizardId, dist, rowLen = 8) {
  // Random mansions don't always have a long open row: re-roll (rarely needed) until one does.
  let game, row;
  for (let tries = 0; !row; tries++) {
    game = makeGame([wizardId, 'himanshu' === wizardId ? 'soham' : 'himanshu']);
    try { row = openRow(game, rowLen); } catch (e) { if (tries > 20) throw e; }
  }
  const caster = game.players.get('p0');
  place(caster, row.x, row.y);
  place(game.players.get('p1'), row.x, row.y + 40); // out of the way
  game.players.get('p1').floor = 1;
  const husk = new TrainingHusk(game, tileCenter(row.x + dist), tileCenter(row.y), 0);
  husk.attackReadyAt = Infinity; // keep it from swiping during effect tests
  game.husk = husk;
  return { game, caster, husk, row };
}

// ---------------------------------------------------------------------------

for (const w of WIZARDS) {
  test(`${w.name}: ${w.ability.name} respects its ${w.ability.cooldown}s cooldown`, () => {
    const { game, caster } = duel(w.id, 3);
    const first = game.spells.cast(caster, EAST);
    assert.ok(first.ok, 'first cast succeeds');
    assert.equal(first.event.ability, w.ability.id);
    assert.equal(gameEvents(game, 'cast').length, 1, 'cast is broadcast');

    const again = game.spells.cast(caster, EAST);
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'cooldown');
    assert.ok(Math.abs(again.remaining - w.ability.cooldown) < 1e-6);

    game.time += w.ability.cooldown - 0.01;
    assert.equal(game.spells.cast(caster, EAST).ok, false, 'still cooling down');
    game.time += 0.02;
    assert.ok(game.spells.cast(caster, EAST).ok, 'ready again');
  });
}

test('casts are validated: bad aim and unknown wizard are rejected', () => {
  const { game, caster } = duel('parthius', 3);
  assert.equal(game.spells.cast(caster, NaN).reason, 'bad-aim');
  caster.wizardId = 'nobody';
  assert.equal(game.spells.cast(caster, EAST).reason, 'no-ability');
});

test('Dark Torment Bolt: 11 damage, interrupts the chase 2s, reveals 6s, screams', () => {
  const { game, caster, husk } = duel('injorath', 6);
  game.spells.cast(caster, EAST);
  assert.equal(husk.hp, 100 - WIZARD_BY_ID.injorath.spells[0].damage);
  assert.ok(husk.isTormented() && husk.isRevealed());
  assert.equal(gameEvents(game, 'monster:scream').length, 1);
  const before = { x: husk.x, z: husk.z };
  run(game, 1.5);
  assert.ok(Math.hypot(husk.x - before.x, husk.z - before.z) < 0.05, 'does not chase while tormented');
  run(game, 0.7);
  assert.ok(!husk.isTormented(), 'torment ends after 2s');
  assert.ok(husk.isRevealed(), 'still visible through walls');
  run(game, 4);
  assert.ok(!husk.isRevealed(), 'reveal ends after 6s');
});

test('Psychic Torment misses targets outside the aim cone', () => {
  const { game, caster, husk } = duel('injorath', 6);
  game.spells.cast(caster, yawFromDir(-1, 0)); // aim west, husk is east
  assert.ok(!husk.isTormented());
});

test('Ignis Blast: projectile travels, hits, burns (DOT + slow), leaves a scorch', () => {
  const { game, caster, husk } = duel('parthius', 6);
  const a = WIZARD_BY_ID.parthius.ability;
  game.spells.cast(caster, EAST);
  assert.equal(game.spells.projectiles.length, 1);
  run(game, 1);
  const impact = gameEvents(game, 'impact')[0];
  assert.ok(impact, 'impact broadcast');
  assert.equal(impact.hit, 'husk');
  assert.equal(impact.scorch, a.scorchDuration);
  assert.ok(husk.isBurning());
  assert.ok(Math.abs(husk.speedMultiplier() - (1 - a.burnSlow)) < 1e-9);
  run(game, a.burnDuration + 0.5);
  assert.ok(!husk.isBurning());
  const expected = 100 - a.damage - a.burnDps * a.burnDuration;
  assert.ok(Math.abs(husk.hp - expected) < 0.2, `hp ${husk.hp} ≈ ${expected}`);
});

test('Ignis Blast explodes on walls and never passes through them', () => {
  const { game, caster } = duel('parthius', 6);
  game.husk = null;
  game.spells.cast(caster, yawFromDir(0, -1)); // north, toward the room wall
  run(game, 3);
  const impact = gameEvents(game, 'impact')[0];
  assert.ok(impact && impact.hit === null);
  assert.ok(!overlapsSolid(game.world, 0, impact.x, impact.z, 0.05), 'impact point is in open space');
});

test('Tidal Surge: chip damage, 40% slow for 4s, puddle slows turning', () => {
  const { game, caster, husk } = duel('himandriel', 4);
  const a = WIZARD_BY_ID.himandriel.ability;
  game.spells.cast(caster, EAST);
  assert.equal(husk.hp, 100 - a.damage);
  assert.ok(Math.abs(husk.speedMultiplier() - (1 - a.slow)) < 1e-9);
  assert.equal(game.spells.zones.length, 1);
  game.step(0.05);
  assert.equal(husk.turnMultiplier(), 1 - a.turnSlow, 'standing in the puddle');
  run(game, a.puddleDuration + 0.4);
  assert.equal(game.spells.zones.length, 0, 'puddle dries');
  assert.equal(husk.speedMultiplier(), 1);
  assert.equal(husk.turnMultiplier(), 1);
});

test('Sacred Judgment Ray: 12 damage, stuns and blinds in place for 2.5s', () => {
  const { game, caster, husk } = duel('soham', 5);
  husk.attackReadyAt = 0;
  game.spells.cast(caster, EAST);
  assert.ok(husk.isStunned());
  assert.equal(husk.hp, 100 - WIZARD_BY_ID.soham.spells[0].damage);
  const before = { x: husk.x, z: husk.z };
  run(game, 2.3);
  assert.ok(Math.hypot(husk.x - before.x, husk.z - before.z) < 1e-6, 'frozen in place');
  assert.equal(gameEvents(game, 'husk:hit').length, 0, 'no attacks while stunned');
  run(game, 0.4);
  assert.ok(!husk.isStunned());
});

test('Gale Force Cannon: 11 damage, pushes 5 units straight back from the caster in open space', () => {
  const { game, caster, husk } = duel('kartavian', 3, 12);
  const start = husk.x;
  game.spells.cast(caster, EAST);
  assert.ok(husk.isKnocked());
  run(game, 0.5);
  assert.ok(Math.abs(husk.x - start - 5) < 0.05, `moved ${husk.x - start}`);
  assert.equal(husk.hp, 100 - WIZARD_BY_ID.kartavian.spells[0].damage);
});

test('Gale Force: knockback is clamped by walls (never out of bounds)', () => {
  const game = makeGame(['kartavian', 'himanshu']);
  const f = game.map.floors[0];
  // Find a floor tile whose east neighbour is a wall, with open floor to the west.
  let spot = null;
  for (let y = 1; y < f.h - 1 && !spot; y++) {
    for (let x = 4; x < f.w - 1 && !spot; x++) {
      const open = [0, 1, 2, 3].every((k) => isPassable(f, x - k, y)) && !overlapsSolid(game.world, 0, tileCenter(x), tileCenter(y), 0.6);
      if (open && f.tiles[y * f.w + x + 1] === TILE_WALL) spot = { x, y };
    }
  }
  assert.ok(spot);
  const caster = game.players.get('p0');
  place(caster, spot.x - 3, spot.y);
  game.players.get('p1').floor = 1;
  const husk = new TrainingHusk(game, tileCenter(spot.x), tileCenter(spot.y), 0);
  husk.attackReadyAt = Infinity;
  game.husk = husk;
  game.spells.cast(caster, EAST);
  run(game, 1);
  const wallX = (spot.x + 1) * TILE;
  assert.ok(husk.x <= wallX - husk.radius + 1e-6, `stopped at the wall (${husk.x} vs ${wallX})`);
  assert.ok(!overlapsSolid(game.world, 0, husk.x, husk.z, husk.radius - 1e-3), 'not embedded in geometry');
});

test('Terra Spike damages; Earthen Rampart (utility) raises a barricade that blocks movement and pathfinding, then crumbles', () => {
  const { game, caster, husk, row } = duel('sushantus', 3, 9);
  game.spells.cast(caster, EAST, 0, 0);
  assert.equal(husk.hp, 100 - WIZARD_BY_ID.sushantus.spells[0].damage);
  const a = WIZARD_BY_ID.sushantus.spells[3];
  const f = game.map.floors[0];
  game.spells.cast(caster, EAST, 0, 3);
  assert.ok(game.spells.buffCodes(caster).includes('granite'), 'granite armour');
  const wall = gameEvents(game, 'cast')[1].wall;
  assert.ok(wall, 'barricade raised');
  assert.equal(wall.tiles.length, a.wallTiles);
  for (const [tx, ty] of wall.tiles) {
    assert.equal(tx, row.x + a.wallDistance, 'wall stands wallDistance tiles ahead');
    assert.ok(!isPassable(f, tx, ty), 'pathfinding sees the barricade');
  }

  // Pathing from caster to the husk never steps through a barricade tile.
  const path = findPath(f, row.x, row.y, row.x + 5, row.y, 1e6);
  const blocked = new Set(wall.tiles.map(([x, y]) => `${x},${y}`));
  if (path) assert.ok(path.every(([x, y]) => !blocked.has(`${x},${y}`)), 'path routes around');

  // Walking straight east stops at the barricade.
  let pos = { x: caster.x, z: caster.z };
  for (let i = 0; i < 60; i++) pos = moveCircle(game.world, 0, pos.x, pos.z, 0.2, 0, PLAYER_RADIUS);
  assert.ok(pos.x <= (row.x + a.wallDistance) * TILE - PLAYER_RADIUS + 1e-6, 'blocked by stone');

  run(game, a.wallDuration + 0.1);
  assert.equal(gameEvents(game, 'barrier:end').length, 1);
  for (const [tx, ty] of wall.tiles) assert.ok(isPassable(f, tx, ty), 'crumbled');
  pos = { x: caster.x, z: caster.z };
  for (let i = 0; i < 30; i++) pos = moveCircle(game.world, 0, pos.x, pos.z, 0.2, 0, PLAYER_RADIUS);
  assert.ok(pos.x > (row.x + a.wallDistance + 1) * TILE, 'walkable again');
});

test('Earthen Rampart never entombs a wizard standing in the wall line', () => {
  const { game, caster, row } = duel('sushantus', 7, 9);
  const ally = game.players.get('p1');
  place(ally, row.x + 2, row.y);
  game.spells.cast(caster, EAST, 0, 3);
  const wall = gameEvents(game, 'cast')[0].wall;
  assert.ok(!wall || wall.tiles.every(([x, y]) => !(x === row.x + 2 && y === row.y)));
});

test('Aegis of the Void: shields allies within 3 units; husk swipes are blocked', () => {
  const game = makeGame(['himanshu', 'soham', 'parthius']);
  const row = openRow(game, 8);
  const [caster, near, far] = ['p0', 'p1', 'p2'].map((id) => game.players.get(id));
  place(caster, row.x, row.y);
  place(near, row.x + 1, row.y); // 2 units
  place(far, row.x + 3, row.y); // 6 units
  const res = game.spells.cast(caster, EAST, 0, 3); // (utility: slot 4)
  assert.deepEqual(res.event.shielded.sort(), ['p0', 'p1']);
  assert.ok(game.spells.isShielded(near) && !game.spells.isShielded(far));

  const husk = new TrainingHusk(game, near.x, near.z - 1.2, 0);
  game.husk = husk;
  husk.action = 'windup';
  husk.attackTarget = near.id;
  husk.windupUntil = game.time;
  game.step(0.05);
  assert.equal(gameEvents(game, 'husk:blocked').length, 1);
  assert.ok(husk.isBlocked() && husk.isKnocked(), 'rebounds off the shield');

  run(game, 3.2);
  assert.ok(!game.spells.isShielded(near), 'shield expires after 3s');
  husk.st.staggerUntil = 0;
  husk.action = 'windup';
  husk.attackTarget = far.id;
  husk.x = far.x;
  husk.z = far.z - 1.2;
  husk.windupUntil = game.time;
  game.step(0.05);
  assert.equal(gameEvents(game, 'husk:hit').at(-1)?.targetId, far.id, 'unshielded wizard is hit');
});

test('Husk crumbles at 0 HP and re-forms after 3s', () => {
  const { game, husk } = duel('parthius', 4);
  husk.damage(150, 'test');
  assert.ok(husk.dead);
  assert.equal(gameEvents(game, 'husk:crumble').length, 1);
  run(game, 3.1);
  assert.ok(!husk.dead && husk.hp === husk.maxHp);
});

test('Soham breaks the Cell lock twice as fast', () => {
  const game = makeGame(['soham', 'parthius']);
  const gate = game.props[game.map.ids.gate];
  for (const id of ['p0', 'p1']) {
    const p = game.players.get(id);
    p.floor = 1;
    p.x = gate.front.x;
    p.z = gate.front.z;
    game.onInteract(id, gate.id);
  }
  assert.equal(game.players.get('p0').channel.duration, CHANNEL.gate / 2);
  assert.equal(game.players.get('p1').channel.duration, CHANNEL.gate);
  run(game, CHANNEL.gate / 2 + 0.1);
  assert.ok(game.propState[gate.id].open, 'Soham opened the gate');
  assert.ok(gameEvents(game, 'gate').some((e) => e.open));
});

test('debug wizard hot-swap trades wizards and resets cooldowns', () => {
  const game = makeGame(['parthius', 'soham']);
  const p0 = game.players.get('p0');
  game.spells.cast(p0, EAST);
  game.debugWizard('p0', 'soham');
  assert.equal(p0.wizardId, 'soham');
  assert.equal(game.players.get('p1').wizardId, 'parthius');
  assert.deepEqual(p0.cooldowns, {});
  assert.equal(gameEvents(game, 'roster').length, 1);
});

test('bots cast their own spell at a nearby husk', () => {
  const game = makeGame(['parthius']);
  const lobbyBot = { id: 'b1', name: 'bot', wizardId: 'himandriel', isBot: true };
  // Rebuild with a bot seat.
  const g2 = new Game(game.io, { room: 'x', members: [{ id: 'h', name: 'H', wizardId: 'parthius', isBot: false }, lobbyBot] });
  g2.events = [];
  g2.io = { to: () => ({ emit: (name, data) => g2.events.push({ name, data }) }), sockets: { sockets: new Map() } };
  const row = openRow(g2, 8);
  place(g2.players.get('h'), row.x, row.y);
  place(g2.players.get('b1'), row.x + 1, row.y);
  g2.husk = new TrainingHusk(g2, tileCenter(row.x + 5), tileCenter(row.y), 0);
  run(g2, 0.2);
  const cast = g2.events.find((e) => e.data?.type === 'cast' && e.data.caster === 'b1');
  assert.ok(cast, 'bot cast a spell');
  assert.ok(WIZARD_BY_ID.himandriel.spells.some((sp) => sp.id === cast.data.ability), `a Water spell (${cast.data.ability})`);
});

test('bots close into spell range before casting (short-range Earth bot)', () => {
  const g = new Game({ to: () => ({ emit() {} }), sockets: { sockets: new Map() } }, {
    room: 'x',
    members: [{ id: 'h', name: 'H', wizardId: 'parthius', isBot: false }, { id: 'b1', name: 'bot', wizardId: 'sushantus', isBot: true }],
  });
  const events = [];
  g.io = { to: () => ({ emit: (name, data) => events.push(data) }), sockets: { sockets: new Map() } };
  const row = openRow(g, 9);
  place(g.players.get('h'), row.x, row.y);
  place(g.players.get('b1'), row.x, row.y);
  g.husk = new TrainingHusk(g, tileCenter(row.x + 7), tileCenter(row.y), 0); // 14 units: out of Terra Spike's 6
  g.husk.attackReadyAt = Infinity;
  g.husk.baseSpeed = 0;
  run(g, 5);
  const cast = events.find((e) => e?.type === 'cast' && e.caster === 'b1');
  assert.ok(cast, 'bot walked into range and cast');
  assert.ok(WIZARD_BY_ID.sushantus.spells.some((sp) => sp.id === cast.ability), `an Earth spell (${cast.ability})`);
});
