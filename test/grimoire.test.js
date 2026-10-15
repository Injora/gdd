// Step 4.5: the 35-spell grimoire, Ultimates + charge, player HP, Lumos,
// and the tougher Amalgam (enrage, tendrils, barricade smashing, phantoms).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/Game.js';
import { roomySeed } from './_seeds.js';
import { TrainingHusk } from '../server/TrainingHusk.js';
import { AI } from '../server/Monster.js';
import { WIZARDS, WIZARD_BY_ID, ULT } from '../shared/wizards.js';
import { isPassable } from '../shared/pathfinding.js';
import { overlapsSolid, lineOfSight } from '../shared/collision.js';
import { HP, PHASE, tileCenter, yawFromDir, worldToTile } from '../shared/constants.js';
import { SIN_ULT_BONUS } from '../shared/sins.js';

const EAST = yawFromDir(1, 0);

function makeGame(members) {
  const events = [];
  const io = { to: () => ({ emit: (name, data) => events.push({ name, data }) }), sockets: { sockets: new Map() } };
  const game = new Game(io, {
    room: 't', hostId: members[0].id, seed: roomySeed(),
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

/** Caster (wizard w) at the west end of an open row, a fresh Husk `dist` tiles east, others on floor 1. */
function duel(w, dist = 4, extra = []) {
  const g = makeGame(humans(w, ...extra));
  const row = openRow(g, 10);
  const p = g.players.get('p0');
  put(p, row.x, row.y);
  p.yaw = EAST;
  for (const [i] of extra.entries()) g.players.get(`p${i + 1}`).floor = 1;
  const husk = new TrainingHusk(g, tileCenter(row.x + dist), tileCenter(row.y), 0);
  husk.attackReadyAt = Infinity;
  husk.baseSpeed = 0;
  g.husk = husk;
  return { g, p, husk, row };
}

/** The Amalgam awake and visible at (tx, ty), deterministic. */
function amalgamAt(g, tx, ty) {
  g.tomeReadBy = 't';
  g.setPhase(PHASE.HEARTS);
  const m = g.monster;
  m.awaken();
  m.aggression = 0;
  m.place({ x: tileCenter(tx), z: tileCenter(ty), floor: 0 });
  m.hidden = false;
  m.setState('stalking');
  return m;
}

// ---------------------------------------------------------------------------
// The book itself

test('35 spells: 7 wizards × (4 normal + 1 Ultimate), unique ids, all implemented', async () => {
  const { SpellSystem } = await import('../server/SpellSystem.js');
  const handlers = new SpellSystem({}).handlers;
  const ids = WIZARDS.flatMap((w) => [...w.spells, w.ultimate].map((s) => s.id));
  assert.equal(ids.length, 35);
  assert.equal(new Set(ids).size, 35);
  for (const id of ids) assert.equal(typeof handlers[id], 'function', `handler for ${id}`);
  for (const w of WIZARDS) {
    assert.equal(w.spells.length, 4);
    assert.ok(w.ultimate.ultimate);
    for (const s of w.spells) assert.ok(s.cooldown > 0 && s.name && s.description && s.bot, s.id);
  }
});

for (const w of WIZARDS) {
  test(`${w.name}: all four spells cast, broadcast and start their own cooldowns`, () => {
    for (let slot = 0; slot < 4; slot++) {
      const { g, p } = duel(w.id, 4, ['soham']);
      const s = w.spells[slot];
      const res = g.spells.cast(p, EAST, 0, slot);
      assert.ok(res.ok, `${s.id}: ${res.reason}`);
      assert.equal(res.event.ability, s.id);
      assert.equal(evs(g, 'cast').at(-1).slot, slot);
      assert.equal(g.spells.cast(p, EAST, 0, slot).reason, 'cooldown');
      for (let o = 0; o < 4; o++) if (o !== slot) assert.equal(g.spells.cooldownLeft(p, w.spells[o].id), 0, 'other slots unaffected');
      run(g, 1.2); // scheduled hits, projectiles, zones all tick without throwing
    }
  });
}

test('Ultimates need 100% charge, spend it, and refuse (free) without a target', () => {
  const { g, p } = duel('parthius');
  assert.equal(g.spells.cast(p, EAST, 0, 'ult').reason, 'charge');
  p.ult = ULT.MAX;
  g.husk = null; // no monster anywhere
  assert.equal(g.spells.cast(p, EAST, 0, 'ult').reason, 'no-target');
  assert.equal(p.ult, ULT.MAX, 'nothing spent');
  const { g: g2, p: p2 } = duel('parthius');
  p2.ult = ULT.MAX;
  assert.ok(g2.spells.cast(p2, EAST, 0, 'ult').ok);
  assert.equal(p2.ult, 0);
});

test('Ultimate charge: +8 per landed spell (once per cast), +25 per Heart (+20 for its Sin), +20 per rescue, chases, passive', () => {
  const { g, p } = duel('kartavian', 3);
  g.spells.cast(p, EAST, 0, 1); // three Kamaitachi blades, one credit
  run(g, 1.5);
  assert.equal(Math.round(p.ult), ULT.HIT);

  const g2 = makeGame(humans('parthius', 'soham'));
  const a = g2.players.get('p0'), b = g2.players.get('p1');
  g2.tomeReadBy = 'x';
  g2.setPhase(PHASE.HEARTS);
  g2.destroyHeart(g2.map.hearts[0], a.name); // (its Sin slain: see hearts.test.js)
  assert.equal(Math.round(a.ult), ULT.HEART + SIN_ULT_BONUS);
  assert.equal(Math.round(b.ult), ULT.HEART + SIN_ULT_BONUS, 'team-wide');

  g2.capture(b, g2.monster);
  run(g2, 1.6);
  const before = a.ult;
  g2.openGate(a.name, a);
  assert.ok(Math.abs(a.ult - before - ULT.RESCUE) < 0.5);

  const g3 = makeGame(humans('parthius'));
  g3.tomeReadBy = 'x';
  const q = g3.players.get('p0');
  run(g3, 5);
  assert.ok(Math.abs(q.ult - ULT.PASSIVE * 5) < 0.2, 'passive trickle after the Tome');
  g3.monster.state = 'hunting';
  g3.monster.targetId = 'p0';
  const v = q.ult;
  g3.updateVitals(1);
  assert.ok(Math.abs(q.ult - v - ULT.CHASED - ULT.PASSIVE) < 0.01, 'surviving a chase');
});

// ---------------------------------------------------------------------------
// Lumos & HP

test('Lumos (F): the Amalgam sees you 50% further away', () => {
  const g = makeGame(humans('parthius'));
  const p = g.players.get('p0');
  // Any two floor tiles 10 apart (20 units) in a straight, clear line.
  const f = g.map.floors[0];
  let pair = null;
  for (let y = 1; y < f.h - 1 && !pair; y++) {
    for (let x = 1; x < f.w - 11 && !pair; x++) {
      if (isPassable(f, x, y) && isPassable(f, x + 10, y) &&
        lineOfSight(g.map, 0, tileCenter(x), tileCenter(y), tileCenter(x + 10), tileCenter(y))) pair = { x, y };
    }
  }
  assert.ok(pair, 'found a 20-unit sightline');
  put(p, pair.x, pair.y);
  const m = amalgamAt(g, pair.x + 10, pair.y); // 20 units
  m.yaw = yawFromDir(-1, 0);
  p.light = false;
  assert.equal(m.canSee(p), false, 'plain wand: seen at 16u');
  p.light = true;
  assert.equal(m.canSee(p), true, 'Lumos: seen at 24u');
});

test('HP: claws deal 30; at ≤ 40 HP the next hit captures; the Cell stabilises you at 50', () => {
  const g = makeGame(humans('parthius', 'soham'));
  const p = g.players.get('p0');
  const m = amalgamAt(g, 10, 10);
  assert.equal(g.damagePlayer(p, AI.CLAW_DAMAGE, m, 'claw'), 'hit');
  assert.equal(p.hp, 70);
  g.damagePlayer(p, AI.CLAW_DAMAGE, m, 'claw');
  assert.equal(p.hp, 40);
  assert.equal(g.damagePlayer(p, AI.CLAW_DAMAGE, m, 'claw'), 'captured');
  run(g, 1.6);
  assert.ok(p.captured);
  assert.equal(p.hp, HP.CELL);
});

test('HP: the shockwave splash only captures at 0 HP; the heavy lunge always captures', () => {
  const g = makeGame(humans('parthius', 'soham', 'himandriel'));
  const [a, b, c] = ['p0', 'p1', 'p2'].map((id) => g.players.get(id));
  const m = amalgamAt(g, 10, 10);
  a.hp = 30;
  assert.equal(g.damagePlayer(a, AI.SHOCK_DAMAGE, m, 'shockwave'), 'hit');
  assert.equal(a.hp, 15);
  assert.equal(g.damagePlayer(a, AI.SHOCK_DAMAGE, m, 'shockwave'), 'captured', 'knocked to 0');
  assert.equal(b.hp, 100);
  assert.equal(g.damagePlayer(b, 30, m, 'lunge'), 'captured');
  assert.ok(c.hp === 100 && !c.capturing);
});

test('HP: Granite Skin −60%, Sea Dragon’s Cradle absorbs 40, Void shield blocks, Devil Union nullifies', () => {
  const g = makeGame(humans('sushantus', 'himandriel', 'himanshu'));
  const [a, b, c] = ['p0', 'p1', 'p2'].map((id) => g.players.get(id));
  const m = amalgamAt(g, 10, 10);
  g.spells.addBuff(a, 'granite', 6);
  g.damagePlayer(a, 30, m, 'claw');
  assert.equal(a.hp, 88);
  g.spells.addBuff(b, 'cradle', 10, { hp: 40 });
  g.damagePlayer(b, 30, m, 'claw');
  assert.equal(b.hp, 100, 'absorbed');
  g.damagePlayer(b, 30, m, 'claw');
  assert.equal(b.hp, 80, '10 left in the cradle, 20 through');
  c.shieldUntil = Infinity;
  assert.equal(g.damagePlayer(c, 30, m, 'lunge'), 'blocked');
  c.shieldUntil = 0;
  g.spells.addBuff(c, 'union', 30);
  assert.equal(g.damagePlayer(c, 30, m, 'lunge'), 'immune');
  assert.equal(c.hp, 100);
  assert.ok(m.isBlocked(), 'the Amalgam recoils');
});

test('HP regenerates slowly out of combat, only up to 60', () => {
  const g = makeGame(humans('parthius'));
  const p = g.players.get('p0');
  p.hp = 30;
  p.lastHurtAt = g.time;
  run(g, HP.REGEN_DELAY - 0.5);
  assert.equal(p.hp, 30, 'no regen right after a hit');
  run(g, 40);
  assert.equal(p.hp, HP.REGEN_CAP);
});

// ---------------------------------------------------------------------------
// Normal spells: one mechanic each

test('Black: Dimension Slash shrinks its reach; Black Hole drags it in; Shadow Step hides you', () => {
  let { g, p, husk } = duel('injorath', 5);
  g.spells.cast(p, EAST, 0, 1);
  run(g, 0.6);
  assert.ok(husk.reachScale() < 1 && husk.hp < 100);

  ({ g, p, husk } = duel('injorath', 6));
  g.spells.cast(p, EAST, 0, 2);
  g.step(0.05);
  assert.ok(husk.isPulled());
  const well = g.spells.zones.find((z) => z.kind === 'gravity');
  husk.x += 3;
  run(g, 1);
  assert.ok(Math.hypot(husk.x - well.x, husk.z - well.z) < 1, 'dragged into the singularity');

  const g2 = makeGame(humans('injorath', 'soham'));
  const q = g2.players.get('p0');
  g2.players.get('p1').floor = 1;
  const row = openRow(g2, 8);
  put(q, row.x, row.y);
  const m = amalgamAt(g2, row.x + 4, row.y);
  m.yaw = yawFromDir(-1, 0);
  assert.ok(m.canSee(q));
  g2.spells.cast(q, EAST, 0, 3);
  assert.equal(m.canSee(q), false, 'unseen before it locks on');
  assert.ok(g2.spells.buffCodes(q).includes('shadow'));
  // Too late once it has locked on: it still tracks you.
  q.buffs = {};
  m.hunt(q, 'test');
  q.cooldowns = {};
  g2.spells.cast(q, EAST, 0, 3);
  assert.equal(m.state, 'hunting');
  assert.equal(m.targetId, 'p0');
});

test('Fire: Calidus Brachium lands 3 fists; Sol Linea leaves a burning line; Phoenix Aura burns on contact', () => {
  let { g, p, husk } = duel('parthius', 2);
  g.spells.cast(p, EAST, 0, 1);
  run(g, 0.7);
  assert.equal(evs(g, 'spell:hit').length, 3);
  assert.equal(husk.hp, 94);

  ({ g, p, husk } = duel('parthius', 6));
  g.spells.cast(p, EAST, 0, 2);
  assert.ok(husk.isBurning() && husk.hp <= 94);
  assert.equal(g.spells.zones.filter((z) => z.kind === 'burnline').length, 1);

  ({ g, p, husk } = duel('parthius', 1));
  g.spells.cast(p, EAST, 0, 3);
  husk.st.burnUntil = 0;
  g.step(0.05);
  assert.ok(husk.isBurning(), 'touching the aura');
});

test('Water: Spear pins; Cradle shields allies; Riptide trap erupts when stepped on', () => {
  let { g, p, husk } = duel('himandriel', 6);
  g.spells.cast(p, EAST, 0, 1);
  run(g, 0.5);
  assert.ok(husk.isPinned() && !husk.canMove());

  ({ g, p, husk } = duel('himandriel', 3));
  g.spells.cast(p, EAST, 0, 2);
  assert.ok(g.spells.hasBuff(p, 'cradle'));

  ({ g, p, husk } = duel('himandriel', 9));
  g.spells.cast(p, EAST, 0, 3);
  const trap = g.spells.zones.find((z) => z.kind === 'riptide');
  run(g, 0.3);
  assert.ok(trap.armed, 'waits');
  husk.x = trap.x;
  husk.z = trap.z;
  g.step(0.05);
  assert.equal(evs(g, 'zone:trigger').length, 1);
  assert.ok(husk.isLifted());
});

test('Earth: Devil’s Snare roots; Golem Boulder leaves slowing debris; Granite Skin armours allies', () => {
  let { g, p, husk } = duel('sushantus', 4);
  g.spells.cast(p, EAST, 0, 1);
  g.step(0.05);
  assert.ok(husk.isRooted());

  ({ g, p, husk } = duel('sushantus', 5));
  g.spells.cast(p, EAST, 0, 2);
  run(g, 1);
  assert.equal(husk.hp, 94);
  assert.ok(g.spells.zones.some((z) => z.kind === 'debris'));
  assert.ok(husk.isSlowed());

  ({ g, p } = duel('sushantus', 5));
  g.spells.cast(p, EAST, 0, 3);
  assert.ok(g.spells.hasBuff(p, 'granite'));
});

test('Wind: Kamaitachi blades home in; Tailwind hastes allies; Vacuum Tempest lifts', () => {
  let { g, p, husk } = duel('kartavian', 5);
  g.spells.cast(p, yawFromDir(1, 0.6), 0, 1); // aimed off-target: they curve in
  run(g, 1.5);
  assert.equal(evs(g, 'impact').filter((e) => e.hit === 'husk').length, 3);

  ({ g, p, husk } = duel('kartavian', 4));
  g.spells.cast(p, EAST, 0, 2);
  assert.ok(g.spells.hasBuff(p, 'tailwind'));

  ({ g, p, husk } = duel('kartavian', 5));
  g.spells.cast(p, EAST, 0, 3);
  assert.ok(husk.isLifted() && !husk.canAct());
});

test('White: five Arrows of Judgment; Patronus heals 4/s; Flash Step blinks 6u and blinds', () => {
  let { g, p, husk } = duel('soham', 6);
  g.spells.cast(p, EAST, 0, 1);
  run(g, 2);
  assert.equal(evs(g, 'impact').filter((e) => e.hit === 'husk').length, 5);

  ({ g, p } = duel('soham', 6));
  p.hp = 50;
  p.lastHurtAt = g.time;
  g.spells.cast(p, EAST, 0, 2);
  run(g, 2);
  assert.ok(p.hp >= 57 && p.hp <= 59, `healed ${p.hp}`);

  ({ g, p, husk } = duel('soham', 3, ['parthius']));
  const x0 = p.x;
  g.spells.cast(p, EAST, 0, 3);
  assert.ok(Math.abs(p.x - x0 - 6) < 0.01, 'blinked 6 units');
  assert.ok(husk.isStunned(), 'the afterimage blinds');
});

test('Anti-magic: Black Slash cancels the windup and strips enrage; Null Zone; Bull Thrust knocks back and taunts', () => {
  const g = makeGame(humans('himanshu', 'soham'));
  const p = g.players.get('p0');
  const other = g.players.get('p1');
  const row = openRow(g, 10);
  put(p, row.x, row.y);
  put(other, row.x + 9, row.y);
  const m = amalgamAt(g, row.x + 3, row.y);
  for (const h of g.map.hearts.slice(0, 5)) g.destroyed.add(h.propId);
  const enraged = m.huntSpeed();
  m.hunt(p, 'test');
  m.startAttack('claw', p);
  g.spells.cast(p, EAST, 0, 1);
  assert.equal(m.action, null, 'windup cut');
  assert.ok(m.isCalm() && m.huntSpeed() < enraged);

  g.spells.cast(p, EAST, 0, 2);
  assert.ok(g.spells.zones.some((z) => z.kind === 'null'));

  m.hunt(other, 'test');
  m.targetId = other.id;
  m.place({ x: tileCenter(row.x + 3), z: tileCenter(row.y), floor: 0 });
  const mx = m.x;
  g.spells.cast(p, EAST, 0, 3);
  assert.equal(m.targetId, p.id, 'taunted');
  run(g, 0.4);
  assert.ok(m.x > mx + 1.5, 'knocked back');
});

// ---------------------------------------------------------------------------
// Ultimates

test('Black Ultimate: 10s mind fracture: locked in place clawing at itself, its sight-lock wiped', () => {
  const g = makeGame(humans('injorath', 'soham'));
  const p = g.players.get('p0');
  g.players.get('p1').floor = 1;
  const row = openRow(g, 10);
  put(p, row.x, row.y);
  const m = amalgamAt(g, row.x + 6, row.y);
  p.ult = 100;
  m.hunt(p, 'test');
  assert.ok(g.spells.cast(p, EAST, 0, 'ult').ok);
  const pos = { x: m.x, z: m.z };
  run(g, 5);
  assert.ok(m.isConfused());
  assert.ok(Math.hypot(m.x - pos.x, m.z - pos.z) < 0.01, 'locked in place');
  assert.notEqual(m.state, 'hunting', 'the lock is gone');
  assert.equal(evs(g, 'monster:lockbroken')[0].reason, 'fracture');
  assert.equal(m.hp, m.maxHp, 'still unkillable');
  run(g, 5.5);
  assert.ok(!m.isConfused());
});

test('Fire Ultimate: the Fiendfyre dragon is an entity that hunts the monster down and detonates', () => {
  const { g, p, husk } = duel('parthius', 9);
  p.ult = 100;
  g.spells.cast(p, EAST, 0, 'ult');
  assert.equal(g.spells.snapshotEntities()[0].k, 'fire_dragon');
  assert.ok(run(g, 4, () => husk.hp < 70));
  assert.ok(evs(g, 'impact').some((e) => e.ability === 'fiendfyre_dragon'));
  assert.equal(g.spells.entities.length, 0);
});

test('Water Ultimate: the whole mansion floods for 25s; the monster wades at 35% everywhere', () => {
  const { g, p, husk } = duel('himandriel', 9);
  p.ult = 100;
  g.spells.cast(p, EAST, 0, 'ult');
  assert.ok(Math.abs(husk.speedMultiplier() - 0.35) < 1e-9);
  assert.ok(g.snapshot().fl > 24);
  run(g, 25.2);
  assert.equal(husk.speedMultiplier(), 1);
  assert.equal(evs(g, 'flood:end').length, 1);
});

test('Earth Ultimate: the Tree of Life bears one fruit per wizard; E heals 60', () => {
  const { g, p } = duel('sushantus', 9, ['parthius', 'soham']);
  p.ult = 100;
  g.spells.cast(p, EAST, 0, 'ult');
  const tree = g.spells.entities[0];
  assert.equal(tree.kind, 'tree');
  assert.equal(tree.fruits, 3);
  assert.equal(g.snapshot().ents[0].n, 3);
  p.hp = 30;
  g.onInteract('p0', null, tree.id);
  assert.equal(p.hp, 90);
  assert.equal(tree.fruits, 2);
  assert.equal(evs(g, 'tree:eat').at(-1).fruits, 2);
});

test('Wind Ultimate: the Sylph dragon seizes the monster and sweeps it to the farthest room', () => {
  const { g, p, husk } = duel('kartavian', 8);
  p.ult = 100;
  const d0 = Math.hypot(husk.x - p.x, husk.z - p.z);
  g.spells.cast(p, EAST, 0, 'ult');
  assert.equal(g.spells.entities[0].kind, 'wind_dragon');
  assert.ok(run(g, 4, () => husk.isCarried()), 'seized');
  assert.ok(run(g, 20, () => !husk.isCarried()), 'dropped');
  assert.ok(Math.hypot(husk.x - p.x, husk.z - p.z) > d0 + 15, 'far away');
  assert.ok(!overlapsSolid(g.world, 0, husk.x, husk.z, husk.radius - 0.05));
});

test('White Ultimate: Dawn floods the mansion with light and freezes the monster in chains for 30s', () => {
  const { g, p, husk } = duel('soham', 6);
  p.ult = 100;
  g.spells.cast(p, EAST, 0, 'ult');
  assert.ok(husk.isFrozen() && !husk.canAct());
  assert.ok(g.snapshot().dw > 29);
  run(g, 29.5);
  assert.ok(husk.isFrozen());
  run(g, 0.8);
  assert.ok(!husk.isFrozen());
  assert.equal(evs(g, 'dawn:end').length, 1);
});

test('Anti-magic Ultimate: 30s of Devil Union: every wizard is immune; attackers recoil', () => {
  const g = makeGame(humans('himanshu', 'soham'));
  const [a, b] = ['p0', 'p1'].map((id) => g.players.get(id));
  b.floor = 1;
  const m = amalgamAt(g, 10, 10);
  a.ult = 100;
  g.spells.cast(a, EAST, 0, 'ult');
  for (const p of [a, b]) assert.equal(g.damagePlayer(p, 30, m, 'lunge'), 'immune', 'all floors');
  run(g, 30.1);
  assert.equal(g.damagePlayer(b, 30, m, 'claw'), 'hit');
});

// ---------------------------------------------------------------------------
// The tougher Amalgam

test('Enrage: hunt speed 4.8 → 5.64 u/s at seven Hearts; aggression climbs', () => {
  const g = makeGame(humans('parthius'));
  const m = amalgamAt(g, 10, 10);
  m.aggression = AI.AGGRO_CHANCE;
  assert.equal(m.huntSpeed(), 4.8);
  const a0 = m.aggressionNow();
  for (const h of g.map.hearts) g.destroyed.add(h.propId);
  assert.ok(Math.abs(m.huntSpeed() - 5.64) < 1e-9);
  assert.ok(m.aggressionNow() > a0);
});

test('At 2+ Hearts it lashes a Shadow Tendril (7u, 20 HP) at wizards out of claw reach', () => {
  const g = makeGame(humans('parthius', 'soham'));
  g.players.get('p1').floor = 1;
  const p = g.players.get('p0');
  const row = openRow(g, 8);
  put(p, row.x, row.y);
  const m = amalgamAt(g, row.x + 3, row.y); // 6 units
  for (const h of g.map.hearts.slice(0, 2)) g.destroyed.add(h.propId);
  m.hunt(p, 'test');
  m.baseSpeed = 0;
  const lashed = run(g, 3, () => evs(g, 'monster:attack').some((e) => e.kind === 'tendril' && e.stage === 'strike'));
  assert.ok(lashed);
  assert.ok(evs(g, 'player:hit').some((e) => e.kind === 'tendril' && e.amount === 20));
});

test('At 4+ Hearts it smashes an Earth barricade in two hits, and conjures phantoms', () => {
  const g = makeGame(humans('sushantus', 'soham'));
  g.players.get('p1').floor = 1;
  const p = g.players.get('p0');
  const row = openRow(g, 10);
  put(p, row.x, row.y);
  const m = amalgamAt(g, row.x + 4, row.y);
  for (const h of g.map.hearts.slice(0, 4)) g.destroyed.add(h.propId);
  g.spells.cast(p, EAST, 0, 0); // wall 2 tiles ahead, between them
  assert.equal(g.spells.barriers.length, 1);
  m.hunt(p, 'test');
  assert.ok(run(g, 4, () => evs(g, 'barrier:end').length > 0), 'barricade crumbled');
  assert.equal(evs(g, 'barrier:hit').length, 2);
  assert.ok(evs(g, 'barrier:end')[0].smashed);

  m.setState('stalking');
  m.phantomAt = g.time;
  for (let i = 0; i < 5 && !evs(g, 'monster:phantoms').length; i++) { m.phantomAt = g.time; m.spawnPhantoms(p); }
  assert.ok(evs(g, 'monster:phantoms').length > 0);
});

test('hunted to ≤ 40 HP, the Amalgam grabs and captures', () => {
  const g = makeGame(humans('parthius', 'soham'));
  const p = g.players.get('p0');
  g.players.get('p1').floor = 1;
  const row = openRow(g, 8);
  put(p, row.x, row.y);
  const m = amalgamAt(g, row.x + 3, row.y);
  m.hunt(p, 'test');
  assert.ok(run(g, 15, () => p.capturing > 0 || p.captured), 'taken');
  const hits = evs(g, 'player:hit');
  assert.ok(hits.length >= 1 || evs(g, 'monster:attack').some((e) => e.kind === 'lunge'));
});
