// Step 9: cluster mode. A coordinator routes every connection to the worker
// that owns the coven it names; covens on other workers are invisible.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { io as connect } from 'socket.io-client';
import { shardOf } from '../shared/shard.js';
import { NET_VERSION } from '../shared/netcodec.js';
import { covenOf, workerCount } from '../server.js';

const WORKERS = 3;
const PORT = 41000 + Math.floor(Math.random() * 2000);
const url = `http://localhost:${PORT}`;
let server;
const sockets = [];

before(async () => {
  server = spawn(process.execPath, ['server.js'], { env: { ...process.env, WORKERS: String(WORKERS), PORT: String(PORT), QUIET: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('cluster did not start')), 15000);
    server.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
  });
  // Wait for every worker to report in.
  for (let i = 0; i < 50; i++) {
    const m = await fetch(`${url}/metrics`).then((r) => r.json()).catch(() => null);
    if (m?.reporting === WORKERS) return;
    await new Promise((r) => setTimeout(r, 200));
  }
});

after(() => {
  for (const s of sockets) s.disconnect();
  server?.kill();
});

const client = (coven) => {
  const s = connect(url, { transports: ['websocket'], forceNew: true, query: coven ? { coven } : {} });
  sockets.push(s);
  return s;
};
const hello = (s) => new Promise((r) => s.once('hello', r));
const request = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));

test('routing helpers: the coven named in the request line, the worker count', () => {
  assert.equal(covenOf('GET /socket.io/?coven=abcd&EIO=4&transport=websocket HTTP/1.1\r\nHost: x'), 'ABCD');
  assert.equal(covenOf('GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\n'), null);
  assert.equal(covenOf('GET /?covenant=ABCDE HTTP/1.1\r\n'), null);
  assert.equal(workerCount(undefined), 1);
  assert.equal(workerCount('4'), 4);
  assert.ok(workerCount('auto') >= 1);
  const counts = new Array(4).fill(0);
  for (const c of ['ABCD', 'QWER', 'ZXCV', 'MNBV', 'HJKL', 'TYUP', 'PLKM', 'RSTU']) counts[shardOf(c, 4)]++;
  assert.ok(counts.filter(Boolean).length >= 3, 'codes spread over the workers');
});

test('a coven created on any worker is joined through its owner; other workers cannot see it', async () => {
  const host = client();
  const h = await hello(host);
  assert.equal(h.shards, WORKERS);
  assert.equal(h.net, NET_VERSION, 'hello names the snapshot protocol (the client warns on a mismatch)');
  const made = await request(host, 'lobby:create', { name: 'Host' });
  assert.ok(made.ok);
  assert.equal(shardOf(made.code, WORKERS), h.shard, 'its code shards to the worker that made it');

  const guest = client(made.code);
  const gh = await hello(guest);
  assert.equal(gh.shard, h.shard, 'routed to the owner');
  const joined = await request(guest, 'lobby:join', { name: 'Guest', code: made.code });
  assert.ok(joined.ok, joined.error);

  // A socket that lands on another worker does not know that coven.
  const other = (h.shard + 1) % WORKERS;
  let wrongCode = null;
  for (const c of ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE', 'FFFF', 'GGGG', 'HHHH']) if (shardOf(c, WORKERS) === other) { wrongCode = c; break; }
  const stranger = client(wrongCode);
  assert.equal((await hello(stranger)).shard, other);
  const miss = await request(stranger, 'lobby:join', { name: 'Lost', code: made.code });
  assert.equal(miss.ok, false);

  await new Promise((r) => setTimeout(r, 1300)); // workers report every second
  const m = await fetch(`${url}/metrics`).then((r) => r.json());
  assert.equal(m.workers, WORKERS);
  assert.ok(m.lobbies >= 1 && m.sockets >= 3, JSON.stringify(m));
  assert.equal(m.perWorker.length, WORKERS);
});

test('the rate limiter throttles a flooding socket', async () => {
  const s = client();
  await hello(s);
  for (let i = 0; i < 300; i++) s.emit('p:ping');
  await new Promise((r) => setTimeout(r, 1500));
  const m = await fetch(`${url}/metrics`).then((r) => r.json());
  assert.ok(m.throttled > 0, 'excess packets dropped');
});
