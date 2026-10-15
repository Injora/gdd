// Step 7 (v3.0): the labels the client shows (map, tracker, billboard) agree
// with the server's task rules; the Keeper's footsteps; the full Tome.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/Game.js';
import { PHASE, FOOTSTEPS, footstepCloseness, keeperStepGain } from '../shared/constants.js';
import { heartStatus, taskPrompt, promptLine, trackerText, tasksDone } from '../shared/heartinfo.js';
import { TASKS } from '../shared/lore.js';
import { SIN_IDS } from '../shared/sins.js';
import { use, at } from './_tasks.js';

function makeGame(seed = 4242) {
  const events = [];
  const io = { to: () => ({ emit: (name, data) => events.push({ name, data }) }), sockets: { sockets: new Map() } };
  const game = new Game(io, {
    room: 't', hostId: 'p0', seed,
    members: [{ id: 'p0', name: 'P0', wizardId: 'parthius', isBot: false }, { id: 'p1', name: 'P1', wizardId: 'soham', isBot: false }],
  });
  game.events = events;
  game.monster.nextHauntAt = Infinity;
  game.tomeReadBy = 't';
  game.setPhase(PHASE.HEARTS);
  game.monster.hideFor(1e6);
  return game;
}
const run = (g, s, until) => { for (let t = 0; t < s; t += 0.05) { g.step(0.05); if (until?.()) return true; } return false; };

test('the Tome names every Heart: its Sin, room, floor, three tasks (and the sink for carry tasks)', () => {
  const g = makeGame();
  const tome = g.tomeInfo();
  assert.equal(tome.hearts.length, 7);
  assert.deepEqual(tome.hearts.map((h) => h.sin).sort(), [...SIN_IDS].sort());
  for (const h of tome.hearts) {
    assert.equal(h.tasks.length, 3);
    assert.ok(h.roomName && Number.isInteger(h.floor) && Number.isInteger(h.roomId));
    assert.equal(!!TASKS[h.sin].carry, h.sink !== null && h.sink !== undefined, `${h.sin} sink`);
    for (const id of h.tasks) assert.equal(g.clientMap.props[id].task, h.sin, 'the client map knows which Sin a task belongs to');
  }
  assert.match(tome.text.join(' '), /weigh the stolen gold/);
});

test('heart status and the top-right tracker follow the task progress, the lockdown and the kill', () => {
  const g = makeGame();
  const p = g.players.get('p0');
  const h = g.tomeInfo().hearts.find((x) => x.sin === 'greed');
  let st = heartStatus(h, g.propState, g.destroyed);
  assert.equal(st.state, 'sealed');
  assert.equal(trackerText(st), 'MASTER STUDY (GREED) — Weigh Stolen Gold Ingots on Mammon’s Scale: 0 / 3');
  use(g, p, h.tasks[0], run);
  use(g, p, h.sink, run);
  st = heartStatus(h, g.propState, g.destroyed);
  assert.equal(st.done, 1);
  assert.match(trackerText(st), /: 1 \/ 3$/);
  for (const id of h.tasks.slice(1)) { use(g, p, id, run); use(g, p, h.sink, run); }
  assert.equal(heartStatus(h, g.propState, g.destroyed).state, 'unsealed');
  g.startArena(g.map.hearts.find((x) => x.sin === 'greed'), p);
  const locked = new Set([...g.arenas.values()].map((a) => a.heart.propId));
  assert.equal(heartStatus(h, g.propState, g.destroyed, locked).state, 'lockdown');
  assert.match(trackerText(heartStatus(h, g.propState, g.destroyed, locked)), /LOCKDOWN/);
  const demon = [...g.arenas.values()][0].demon;
  demon.eruptUntil = 0;
  demon.damage(1e6, 'test');
  run(g, 0.1);
  assert.equal(heartStatus(h, g.propState, g.destroyed).state, 'slain');
});

test('the billboard prompt mirrors the server: "[Hold E] <Action> (Progress X/3)", take vs place, hands full', () => {
  const g = makeGame();
  const p = g.players.get('p0');
  const hearts = g.tomeInfo().hearts;
  const pride = hearts.find((x) => x.sin === 'pride');
  const mirror = g.clientMap.props[pride.tasks[0]];
  let pr = taskPrompt(mirror, pride, g.propState, g.destroyed);
  assert.equal(promptLine(pr), '[Hold E] Shatter Vanity Mirror (Progress 0/3)');
  assert.equal(promptLine(taskPrompt(mirror, pride, g.propState, g.destroyed, { tomeRead: false })), 'It means nothing to you yet (Progress 0/3)');
  use(g, p, mirror.id, run);
  pr = taskPrompt(mirror, pride, g.propState, g.destroyed);
  assert.equal(pr.hold, false);
  assert.equal(promptLine(pr), 'The mirror lies in shards (Progress 1/3)');

  const gl = hearts.find((x) => x.sin === 'gluttony');
  const platter = g.clientMap.props[gl.tasks[0]];
  const furnace = g.clientMap.props[gl.sink];
  assert.equal(promptLine(taskPrompt(platter, gl, g.propState, g.destroyed)), '[Hold E] Take Rotting Feast Platter (Progress 0/3)');
  assert.equal(taskPrompt(furnace, gl, g.propState, g.destroyed).hold, false, 'nothing to dump yet');
  assert.match(taskPrompt(furnace, gl, g.propState, g.destroyed).action, /Bring a Rotting Feast Platter/);
  use(g, p, platter.id, run);
  assert.equal(p.carry.kind, 'platter');
  const carry = p.carry.kind;
  assert.equal(promptLine(taskPrompt(furnace, gl, g.propState, g.destroyed, { carry })), '[Hold E] Dump Cursed Feast Platter (Progress 0/3)');
  assert.equal(taskPrompt(g.clientMap.props[gl.tasks[1]], gl, g.propState, g.destroyed, { carry }).action, 'Your hands are full');
  assert.equal(taskPrompt(platter, gl, g.propState, g.destroyed).action, 'Empty. Someone is carrying it');
  // …and whatever the prompt offers with hold=true, the server accepts.
  at(p, g.props[furnace.id]);
  g.onInteract('p0', furnace.id);
  assert.ok(p.channel, 'the furnace takes it');
  run(g, 3, () => !p.channel);
  assert.equal(tasksDone(gl, g.propState), 1);
});

test('the Keeper’s footsteps: heard from 28 units, swelling exponentially to 5; silent beyond', () => {
  assert.equal(FOOTSTEPS.range, 28);
  assert.equal(footstepCloseness(28.01), 0);
  assert.equal(footstepCloseness(Infinity), 0);
  assert.equal(footstepCloseness(FOOTSTEPS.near), 1);
  assert.equal(footstepCloseness(2), 1);
  assert.equal(keeperStepGain(30), 0);
  const far = keeperStepGain(28), mid = keeperStepGain(16.5), near = keeperStepGain(5);
  assert.ok(far > 0.1, `audible at the edge (${far})`);
  assert.ok(near > far * 10, 'much louder up close');
  assert.ok(mid < (far + near) / 2, 'exponential, not linear');
  assert.ok(keeperStepGain(10, true) > keeperStepGain(10), 'louder when it hunts');
});
