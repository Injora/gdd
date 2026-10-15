// Phase III–IV: the Forbidden Spell, Soul Merge, the Archon vs the Unbound
// Amalgam, the Hell Portal, victory; plus a full playthrough.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/Game.js';
import { FINALE as F, MASTERIES } from '../shared/finale.js';
import { ARCHON_COOLDOWN_SCALE } from '../shared/wizards.js';
import { PHASE, yawFromDir } from '../shared/constants.js';
import { overlapsSolid } from '../shared/collision.js';
import { doHeartTasks } from './_tasks.js';

function makeGame(members) {
  const events = [];
  const io = { to: () => ({ emit: (name, data) => events.push({ name, data }) }), sockets: { sockets: new Map() } };
  const game = new Game(io, {
    room: 't', hostId: members[0].id,
    members: members.map((m) => ({ name: m.id.toUpperCase(), isBot: false, ...m })),
  });
  game.events = events;
  game.monster.nextHauntAt = Infinity;
  return game;
}
const humans = (...w) => w.map((wizardId, i) => ({ id: `p${i}`, wizardId }));
const evs = (g, type) => g.events.filter((e) => e.name === 'game:event' && e.data.type === type).map((e) => e.data);
const run = (g, s, until) => { for (let t = 0; t < s; t += 0.05) { g.step(0.05); if (until?.()) return true; } return false; };

/** Everyone at the altar, chanting. */
function chantAll(g) {
  const altar = g.props[g.map.ids.altar];
  for (const p of g.players.values()) {
    Object.assign(p, { x: altar.front.x, z: altar.front.z, floor: altar.floor });
    g.onInteract(p.id, altar.id);
  }
}

/** Straight to the boss fight. */
function toBoss(wizards = ['parthius', 'soham']) {
  const g = makeGame(humans(...wizards));
  g.debugFinale();
  g.monster.hideFor(1e6); // keep it out of the ritual
  chantAll(g);
  run(g, F.RITUAL_TIME + F.MERGE_TIME + 0.3);
  return g;
}

test('the Forbidden Spell needs every voice; the chant decays when one stops', () => {
  const g = makeGame(humans('parthius', 'soham'));
  g.debugFinale();
  assert.equal(g.phase, PHASE.CONVERGENCE);
  g.monster.hideFor(1e6);
  const altar = g.props[g.map.ids.altar];
  const [a, b] = ['p0', 'p1'].map((id) => g.players.get(id));
  Object.assign(a, { x: altar.front.x, z: altar.front.z, floor: altar.floor });
  g.onInteract('p0', altar.id);
  assert.ok(g.finale.chanting(a));
  run(g, 3);
  assert.equal(g.finale.ritual, 0, 'one voice is not enough');
  Object.assign(b, { x: altar.front.x, z: altar.front.z, floor: altar.floor });
  g.onInteract('p1', altar.id);
  run(g, 3);
  assert.ok(Math.abs(g.finale.ritual - 0.5) < 0.05);
  g.onCancel('p1');
  run(g, 1);
  assert.ok(g.finale.ritual < 0.5, 'decays');
  g.onInteract('p1', altar.id);
  assert.ok(run(g, 5, () => g.phase === PHASE.ARCHON), 'merged');
  assert.equal(evs(g, 'merge').length, 1);
});

test('Soul Merge: one Archon at the altar, the Unbound Amalgam rises after 3s', () => {
  const g = makeGame(humans('parthius', 'soham'));
  g.debugFinale();
  g.monster.hideFor(1e6);
  chantAll(g);
  run(g, F.RITUAL_TIME + 0.1);
  const A = g.finale.archon;
  assert.ok(A);
  assert.equal(A.hp, F.ARCHON_HP);
  assert.equal(A.driverId, 'p0', 'the host drives');
  assert.equal(g.cooldownScale, ARCHON_COOLDOWN_SCALE);
  assert.ok(g.monster.hidden);
  run(g, F.MERGE_TIME + 0.2);
  assert.equal(g.finale.stage, 'boss');
  assert.equal(evs(g, 'boss:start').length, 1);
  const m = g.monster;
  assert.ok(!m.hidden && m.state === 'boss' && m.bossHp === F.BOSS_HP);
  const room = g.map.rooms[g.map.ids.altarRoom];
  assert.equal(g.map.floors[m.floor].roomIds[Math.floor(m.z / 2) * g.map.floors[m.floor].w + Math.floor(m.x / 2)], room.id, 'in the Chapel');
  for (const p of g.players.values()) assert.ok(p.x === A.x && p.z === A.z, 'everyone is the Archon');
});

test('only the driver moves the Archon; everyone looks and casts independently', () => {
  const g = toBoss();
  const A = g.finale.archon;
  const x0 = A.x;
  g.onPlayerState('p1', { x: A.x + 1, z: A.z, yaw: 1.2, pitch: 0.1, tseq: 0 });
  assert.equal(A.x, x0, 'passenger cannot steer');
  assert.equal(g.players.get('p1').yaw, 1.2, 'but can look');
  g.finale.archon.lastAt = Date.now() - 200;
  g.onPlayerState('p0', { x: A.x + 0.5, z: A.z, yaw: 0, pitch: 0, tseq: 0 });
  assert.ok(Math.abs(A.x - x0 - 0.5) < 1e-9, 'driver steers');
  g.step(0.05);
  assert.equal(g.players.get('p1').x, A.x);
});

test('the boss fights back (orbs, shockwaves, charges); a fallen Archon is a game over; Retry re-merges', () => {
  const g = toBoss();
  const A = g.finale.archon;
  const m = g.monster;
  m.place({ x: A.x + 4, z: A.z, floor: A.floor }); // in its face
  assert.ok(run(g, 15, () => evs(g, 'archon:hit').length >= 3));
  const kinds = new Set(evs(g, 'archon:hit').map((e) => e.kind));
  assert.ok(kinds.size >= 1);
  assert.ok(A.hp < F.ARCHON_HP);
  A.hp = 1;
  g.finale.damageArchon(10, 'orb');
  assert.equal(g.phase, PHASE.GAMEOVER);
  assert.equal(evs(g, 'gameover').at(-1).archon, true);
  g.restartPhase();
  assert.equal(g.phase, PHASE.ARCHON);
  assert.equal(g.finale.stage, 'merge');
  assert.equal(A.hp, F.ARCHON_HP);
  run(g, F.MERGE_TIME + 0.2);
  assert.equal(g.finale.stage, 'boss');
  assert.equal(m.bossHp, F.BOSS_HP);
});

test('Masteries: shared cooldowns across the coven; face-value damage; spells hit 2.5× harder', () => {
  const g = toBoss();
  const m = g.monster;
  const A = g.finale.archon;
  m.place({ x: A.x + 5, z: A.z, floor: A.floor });
  const yaw = yawFromDir(1, 0);
  assert.ok(g.finale.mastery(g.players.get('p0'), 4, yaw).ok);
  assert.equal(m.bossHp, F.BOSS_HP - MASTERIES[3].damage);
  const again = g.finale.mastery(g.players.get('p1'), 4, yaw);
  assert.equal(again.reason, 'cooldown', 'one body, one cooldown');
  const hp = m.bossHp;
  m.damage(4, 'fire');
  assert.equal(m.bossHp, hp - 4 * F.BOSS_SPELL_SCALE);
  for (const M of MASTERIES) assert.ok(M.cooldown > 0 && M.damage > 0 && M.key >= 1 && M.key <= 7);
});

test('wards at 66% and 40% block damage until they fade or Anti-Magic Slash breaks them', () => {
  const g = toBoss();
  const m = g.monster;
  const A = g.finale.archon;
  m.place({ x: A.x + 4, z: A.z, floor: A.floor });
  m.damage(F.BOSS_HP * 0.35 / F.BOSS_SPELL_SCALE, 'fire');
  assert.equal(evs(g, 'boss:ward').length, 1);
  const hp = m.bossHp;
  m.damage(10, 'fire');
  assert.equal(m.bossHp, hp, 'warded');
  assert.ok(evs(g, 'boss:warded').length > 0);
  g.finale.mastery(g.players.get('p0'), 7, yawFromDir(1, 0));
  assert.ok(m.bossHp < hp, 'anti-magic unmade the ward and struck');
});

test('no crowd control holds the Unbound one past 2.5s (even Dawn)', () => {
  const g = toBoss(['soham', 'parthius']);
  const p = g.players.get('p0');
  p.ult = 100;
  const m = g.monster;
  g.spells.cast(p, 0, 0, 'ult');
  assert.ok(m.isFrozen());
  run(g, F.BOSS_CC_CAP + 0.2);
  assert.ok(!m.isFrozen());
});

test('the Hell Portal opens at 20%; it crawls away, binds hold it, the Soul Grapple drags it under; victory', () => {
  const g = toBoss();
  const m = g.monster;
  const A = g.finale.archon;
  g.finale.wardsUsed = 2;
  m.damage(F.BOSS_HP * 0.85 / F.BOSS_SPELL_SCALE, 'fire');
  assert.equal(g.finale.stage, 'portal');
  assert.equal(evs(g, 'portal:open').length, 1);
  m.damage(9999, 'fire');
  assert.equal(m.bossHp, 1, 'it cannot die, only be dragged under');

  const P = g.finale.portal;
  A.hp = 1e6;
  // Somewhere in the open, 5 units from the rift.
  const open = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * Math.PI) / 4)
    .find((a) => [5, 7].every((r) => !overlapsSolid(g.world, P.floor, P.x + Math.cos(a) * r, P.z + Math.sin(a) * r, m.radius)));
  m.place({ x: P.x + Math.cos(open) * 5, z: P.z + Math.sin(open) * 5, floor: P.floor });
  const d0 = Math.hypot(m.x - P.x, m.z - P.z);
  run(g, 1.5);
  assert.ok(Math.hypot(m.x - P.x, m.z - P.z) > d0, `claws away from the rift (${d0.toFixed(2)} → ${Math.hypot(m.x - P.x, m.z - P.z).toFixed(2)}, dir ${open?.toFixed(2)}, ${JSON.stringify(m.st)} ${m.action})`);

  for (const p of g.players.values()) g.finale.setGrapple(p, true);
  g.onPlayerState('p0', { x: A.x, z: A.z, yaw: 0, pitch: 0 });
  assert.ok(run(g, 20, () => g.finale.stage === 'sealing'), 'dragged to the rift');
  assert.equal(evs(g, 'sealing').length, 1);
  assert.ok(run(g, F.SEAL_TIME + 0.3, () => g.phase === PHASE.EPILOGUE));
  const v = evs(g, 'victory')[0];
  assert.ok(v);
  assert.deepEqual(v.coven.map((c) => c.wizardId).sort(), ['parthius', 'soham']);
});

test('full playthrough: Tome → seven Hearts (tasks, Sins) → the chant (a bot walks to the altar) → Archon → portal → epilogue', () => {
  const g = makeGame([{ id: 'h', wizardId: 'himanshu' }, { id: 'b', wizardId: 'kartavian', isBot: true }]);
  const h = g.players.get('h');
  const tome = g.props[g.map.ids.tome];
  Object.assign(h, { x: tome.front.x, z: tome.front.z, floor: tome.floor });
  g.onInteract('h', tome.id);
  run(g, 2.2);
  assert.equal(g.phase, PHASE.HEARTS);
  g.monster.hideFor(1e6); // a focused flow test: the Amalgam keeps out of it
  for (const heart of g.map.hearts) {
    const at = (prop) => {
      const spot = prop.front ?? { x: prop.x, z: prop.z };
      Object.assign(h, { x: spot.x, z: spot.z, floor: prop.floor });
    };
    doHeartTasks(g, h, heart, run);
    for (const tid of heart.tasks) assert.ok(g.propState[tid]?.done, `task ${tid} done`);
    const prop = g.props[heart.propId];
    at(prop);
    g.onInteract('h', prop.id);
    assert.ok(run(g, 3, () => g.arenas.has(prop.id)), `${heart.name}: its Sin erupts`);
    const demon = g.arenas.get(prop.id).demon;
    demon.eruptUntil = 0;
    demon.damage(9999, 'test');
    assert.ok(run(g, 1, () => g.destroyed.has(prop.id)), `destroyed ${heart.name}`);
  }
  assert.equal(g.phase, PHASE.CONVERGENCE);

  const altar = g.props[g.map.ids.altar];
  Object.assign(h, { x: altar.front.x, z: altar.front.z, floor: altar.floor });
  g.onInteract('h', altar.id);
  assert.ok(run(g, 150, () => g.phase === PHASE.ARCHON), 'the bot came and chanted');
  assert.ok(run(g, F.MERGE_TIME + 0.5, () => g.finale.stage === 'boss'));

  g.finale.archon.hp = 1e6;
  // The human fires Masteries whenever ready; the bot fights on its own.
  const won = run(g, 400, () => {
    const f = g.finale;
    if (f.inFight()) {
      const m = g.monster;
      const yaw = yawFromDir(m.x - f.archon.x, m.z - f.archon.z);
      // (the human leaves the Wind Dragon to Kartavian, the bot, who channels their own element)
      for (const M of MASTERIES) if (M.element !== 'wind' && (f.masteryReady[M.id] ?? 0) <= f.t) f.mastery(h, M.key, yaw);
      if (f.stage === 'portal') f.setGrapple(h, true);
    }
    return g.phase === PHASE.EPILOGUE;
  });
  assert.ok(won, `sealed (stage ${g.finale.stage}, boss ${g.monster.bossHp})`);
  assert.ok(evs(g, 'mastery').some((e) => e.by === 'b'), 'the bot used Masteries too');
});
