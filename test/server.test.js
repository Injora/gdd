// End-to-end smoke test: real server, real sockets, a full Phase 1 -> Phase 2
// run with bots, plus movement validation and stairs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server.js';
import { PHASE, HEART_COUNT } from '../shared/constants.js';

let server, url;
const sockets = [];

before(async () => {
  server = createGameServer();
  await new Promise((r) => server.httpServer.listen(0, r));
  url = `http://localhost:${server.httpServer.address().port}`;
});

after(async () => {
  for (const s of sockets) s.disconnect();
  server.io.close();
  await new Promise((r) => server.httpServer.close(r));
});

function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  return s;
}

const request = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
function waitFor(s, ev, pred = () => true, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { s.off(ev, fn); reject(new Error(`timeout waiting for ${ev}`)); }, ms);
    const fn = (d) => {
      if (!pred(d)) return;
      clearTimeout(timer);
      s.off(ev, fn);
      resolve(d);
    };
    s.on(ev, fn);
  });
}

test('solo coven: lobby -> tome -> six hearts -> convergence', async () => {
  const a = client();
  await waitFor(a, 'connect');

  const created = await request(a, 'lobby:create', { name: '<b>Tester</b>', solo: true });
  assert.ok(created.ok);
  const lobby = server.lobbies.lobbies.get(created.code);
  assert.equal(lobby.members.length, 3, 'two bots added for solo');
  assert.equal(lobby.members[0].name, 'bTester/b', 'name sanitized');

  // Humans take a wizard from a bot, the bot picks another.
  const botWizard = lobby.members[1].wizardId;
  assert.ok((await request(a, 'lobby:pick', { wizardId: botWizard })).ok);
  assert.equal(lobby.members[0].wizardId, botWizard);
  assert.notEqual(lobby.members[1].wizardId, botWizard);
  assert.ok(lobby.members[1].wizardId);

  // A second human joins, then leaves.
  const b = client();
  await waitFor(b, 'connect');
  assert.ok((await request(b, 'lobby:join', { code: created.code.toLowerCase(), name: 'Friend' })).ok);
  assert.equal(lobby.members.length, 4);
  assert.equal((await request(b, 'lobby:start')).ok, false, 'only host can start');
  b.disconnect();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(lobby.members.length, 3);

  const startP = waitFor(a, 'game:start');
  assert.ok((await request(a, 'lobby:start')).ok);
  const init = await startP;
  assert.equal(init.players.length, 3);
  assert.equal(init.phase, PHASE.TOME);
  assert.equal(init.map.hearts, undefined, 'hearts hidden from clients');

  const game = lobby.game;
  const me = game.players.get(a.id);
  const map = game.map;
  const putAt = (prop) => {
    const spot = prop.front ?? { x: prop.x, z: prop.z };
    me.x = spot.x;
    me.z = spot.z;
    me.floor = prop.floor;
  };
  const fastForward = () => { if (me.channel) me.channel.start -= 100; };

  // Too far from the Tome.
  const far = waitFor(a, 'game:event', (e) => e.type === 'whisper');
  a.emit('p:interact', { propId: map.ids.tome });
  assert.match((await far).text, /closer/);

  // Speed-hack is rejected with a teleport correction.
  const corr = waitFor(a, 'game:teleport');
  a.emit('p:state', { tseq: 0, x: me.x + 40, z: me.z, yaw: 0, pitch: 0 });
  const c = await corr;
  assert.equal(c.tseq, 1);
  assert.ok(Math.abs(c.x - me.x) < 1e-6);

  // Hearts can't be destroyed before reading the Tome.
  const firstHeart = map.props[map.hearts[0].propId];
  putAt(firstHeart);
  const early = waitFor(a, 'game:event', (e) => e.type === 'whisper');
  a.emit('p:interact', { propId: firstHeart.id });
  assert.match((await early).text, /do not yet know/);

  // Read the Tome.
  putAt(map.props[map.ids.tome]);
  const chan = waitFor(a, 'game:channel', (d) => d.propId === map.ids.tome);
  a.emit('p:interact', { propId: map.ids.tome });
  assert.equal((await chan).duration, 2);
  const tomeEv = waitFor(a, 'game:event', (e) => e.type === 'tome');
  fastForward();
  const tome = (await tomeEv).tome;
  assert.equal(tome.hearts.length, HEART_COUNT);
  assert.equal(game.phase, PHASE.HEARTS);

  // Destroy all six.
  for (const h of map.hearts) {
    const prop = map.props[h.propId];
    putAt(prop);
    const started = waitFor(a, 'game:channel', (d) => d.propId === prop.id);
    a.emit('p:interact', { propId: prop.id });
    await started;
    const done = waitFor(a, 'game:event', (e) => e.type === 'heart' && e.propId === prop.id);
    fastForward();
    await done;
  }
  assert.equal(game.destroyed.size, HEART_COUNT);
  assert.equal(game.phase, PHASE.CONVERGENCE);

  // Stairs take you to the basement.
  putAt(map.props[map.ids.stairsDown]);
  const down = waitFor(a, 'game:teleport', (d) => d.floor === 1);
  a.emit('p:interact', { propId: map.ids.stairsDown });
  const tp = await down;
  assert.equal(me.floor, 1);
  assert.equal(tp.tseq, me.tseq);

  // Bots follow the human down the stairs.
  await new Promise((r) => setTimeout(r, 3500));
  const bots = [...game.players.values()].filter((p) => p.isBot);
  assert.ok(bots.some((p) => p.floor === 1 || p.moving), 'bots are pursuing the leader');
});
