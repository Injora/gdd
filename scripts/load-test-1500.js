#!/usr/bin/env node
// Step 9: the 1,500-player load test (npm run test:scale1500).
//
// Boots HorCrux in cluster mode, then forks client-simulator processes that
// open 1,500 real Socket.io connections in 375 four-wizard covens: create /
// join (routed to the owning worker), pick wizards, ready up, start; then
// every wizard plays at 10 Hz for the measured window: walking and sprinting,
// toggling Lumos and the Disillusionment Charm, casting, and working Sin
// tasks (covens are made in debug mode so a wizard can step to a task: the
// teleport stands in for the walk), which sends the Keeper investigating.
//
// It asserts: 1,500 players connected and in game, 375 active rooms, 0
// errors, p95 server tick < 16 ms (the worst worker), memory < 1.5 GB (all
// server processes). Tunables: PLAYERS, WORKERS (default: half the cores, the
// rest drive the simulated clients), SIMULATORS, DURATION (s), PORT.

import { fork, spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYERS = Number(process.env.PLAYERS) || 1500;
const PER_COVEN = 4;
const COVENS = Math.ceil(PLAYERS / PER_COVEN);
const CORES = availableParallelism();
const WORKERS = process.env.WORKERS ?? String(Math.max(2, Math.floor(CORES / 2)));
const SIMULATORS = Number(process.env.SIMULATORS) || Math.max(2, Math.min(8, CORES - Number(WORKERS)));
const DURATION = Number(process.env.DURATION) || 65; // seconds of steady play (the tick ring holds the last 60 s)
const PORT = Number(process.env.PORT) || 43000 + Math.floor(Math.random() * 2000);
const URL = `http://localhost:${PORT}`;
const LIMITS = { tickP95: 16, rssBytes: 1.5 * 1024 ** 3 };
const WIZARDS = ['injorath', 'parthius', 'himandriel', 'sushantus', 'kartavian', 'soham', 'himanshu'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================================================================================
// Simulator process: runs a slice of the covens.
// =====================================================================================

async function simulator() {
  const { io } = await import('socket.io-client');
  const { covens, url } = JSON.parse(process.env.SIM);
  const stats = { connected: 0, inGame: 0, errors: 0, errorLog: [], snapshots: 0, bytes: 0, casts: 0, tasks: 0, invis: 0 };
  const err = (msg) => { stats.errors++; if (stats.errorLog.length < 10) stats.errorLog.push(msg); };
  const sockets = [];
  const report = () => process.send({ type: 'stats', stats });
  setInterval(report, 1000);

  const open = (coven) => new Promise((resolve) => {
    const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false, query: coven ? { coven } : {} });
    sockets.push(s);
    s.on('connect_error', (e) => { err(`connect: ${e.message}`); resolve(null); });
    s.once('hello', () => { stats.connected++; resolve(s); });
    s.on('disconnect', (reason) => { if (!s.closing) err(`disconnect: ${reason}`); });
  });
  const ask = (s, ev, data) => new Promise((resolve) => s.timeout(15000).emit(ev, data, (e, res) => resolve(e ? { ok: false, error: 'timeout' } : res)));

  // One coven: the host creates it, three guests join through its worker.
  const startCoven = async (n) => {
    const host = await open(null);
    if (!host) return [];
    const made = await ask(host, 'lobby:create', { name: `Host${n}`, debug: true });
    if (!made.ok) { err(`create: ${made.error}`); return []; }
    const members = [host];
    for (let k = 1; k < PER_COVEN; k++) {
      const g = await open(made.code);
      if (!g) continue;
      const j = await ask(g, 'lobby:join', { name: `W${n}_${k}`, code: made.code });
      if (!j.ok) { err(`join: ${j.error}`); continue; }
      members.push(g);
    }
    const players = members.map((s, k) => ({ s, k, host: k === 0, wizardId: WIZARDS[(n + k) % WIZARDS.length] }));
    for (const p of players) {
      const r = await ask(p.s, 'lobby:pick', { wizardId: p.wizardId });
      if (!r.ok) err(`pick: ${r.error}`);
    }
    for (const p of players) if (!p.host) p.s.emit('lobby:ready', { ready: true });
    await sleep(300);
    const starts = players.map((p) => new Promise((resolve) => p.s.once('game:start', (init) => { p.init = init; resolve(); })));
    const st = await ask(host, 'lobby:start', {});
    if (!st.ok) { err(`start: ${st.error}`); return []; }
    await Promise.race([Promise.all(starts), sleep(20000)]);
    for (const p of players) if (!p.init) err('no game:start');
    return players.filter((p) => p.init);
  };

  // Gather every coven (a few at a time, like real people arriving).
  const all = [];
  const queue = [...covens];
  await Promise.all(new Array(8).fill(0).map(async () => {
    while (queue.length) all.push(...await startCoven(queue.shift()));
  }));
  process.send({ type: 'ready', players: all.length });

  // Play.
  await new Promise((r) => process.once('message', (m) => m === 'go' && r()));
  for (const p of all) setupPlayer(p);
  stats.inGame = all.length;

  function setupPlayer(p) {
    const { init, s } = p;
    const map = init.map;
    const idx = Math.max(0, init.players.findIndex((m) => m.id === init.selfId));
    const sp = map.spawn.points[idx % map.spawn.points.length];
    const me = { x: sp.x, z: sp.z, floor: map.spawn.floor, yaw: map.spawn.yaw, tseq: 0, li: false, holdUntil: 0 };
    const tasks = map.props.filter((q) => q.interact === 'task' && q.front);
    const tome = map.props[map.ids.tome];
    s.on('game:teleport', (d) => Object.assign(me, { x: d.x, z: d.z, floor: d.floor, yaw: d.yaw, tseq: d.tseq }));
    s.on('game:s', (bin, delta) => { stats.snapshots++; stats.bytes += (bin.byteLength ?? 0) + (delta ? JSON.stringify(delta).length : 0); });
    const now = () => Date.now() / 1000;
    let next = { cast: now() + 2 + Math.random() * 5, invis: now() + 5 + Math.random() * 10, lumos: now() + Math.random() * 8, task: now() + 4 + Math.random() * 12 };
    if (p.host) {
      // The host reads the Tome: Phase II, the Keeper wakes.
      s.emit('debug:teleport', { x: tome.front.x, z: tome.front.z, floor: tome.floor, yaw: 0 });
      setTimeout(() => s.emit('p:interact', { propId: tome.id }), 600);
      me.holdUntil = now() + 3;
    }
    let dir = Math.random() * Math.PI * 2;
    setInterval(() => {
      const t = now();
      const still = t < me.holdUntil;
      let moving = false, sprint = false;
      if (!still) {
        if (Math.random() < 0.1) dir += (Math.random() - 0.5) * 2;
        sprint = Math.random() < 0.2;
        const step = (sprint ? 0.5 : 0.3) * (Math.random() < 0.8 ? 1 : 0);
        moving = step > 0;
        me.x += Math.cos(dir) * step;
        me.z += Math.sin(dir) * step;
        me.yaw = dir;
      }
      if (t > next.lumos) { me.li = !me.li; next.lumos = t + 6 + Math.random() * 8; }
      s.emit('p:state', { tseq: me.tseq, x: Math.round(me.x * 100) / 100, z: Math.round(me.z * 100) / 100, yaw: me.yaw, pitch: 0, cr: false, sp: sprint && moving, li: me.li, mv: moving });
      if (t > next.cast) { s.emit('p:cast', { yaw: me.yaw, pitch: 0, slot: Math.floor(Math.random() * 4) }); stats.casts++; next.cast = t + 4 + Math.random() * 6; }
      if (t > next.invis) { s.emit('p:invis'); stats.invis++; next.invis = t + 8 + Math.random() * 10; }
      if (t > next.task && tasks.length) {
        // Step to a Sin task and hold E on it (it pings the Keeper, which comes to look).
        const q = tasks[Math.floor(Math.random() * tasks.length)];
        s.emit('debug:teleport', { x: q.front.x, z: q.front.z, floor: q.floor, yaw: 0 });
        setTimeout(() => s.emit('p:interact', { propId: q.id }), 300);
        me.holdUntil = t + 2.5;
        stats.tasks++;
        next.task = t + 10 + Math.random() * 10;
      }
    }, 100 + Math.random() * 10);
  }

  await new Promise((r) => process.once('message', (m) => m === 'stop' && r()));
  for (const s of sockets) { s.closing = true; s.disconnect(); }
  report();
  setTimeout(() => process.exit(0), 300);
}

// =====================================================================================
// Main: the server, the simulators, the measurements.
// =====================================================================================

async function main() {
  console.log(`HorCrux load test: ${PLAYERS} players in ${COVENS} covens · server WORKERS=${WORKERS} · ${SIMULATORS} client simulators · ${CORES} cores`);
  const server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, WORKERS, PORT: String(PORT), QUIET: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const serverErrors = [];
  server.stderr.on('data', (d) => { const t = String(d).trim(); if (t) serverErrors.push(t.slice(0, 300)); });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    server.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
  });
  const metrics = () => fetch(`${URL}/metrics`).then((r) => r.json()).catch(() => null);
  const expect = WORKERS === 'auto' ? CORES : Number(WORKERS);
  for (let i = 0; i < 100 && ((await metrics())?.reporting ?? 1) !== expect; i++) await sleep(200);

  // Simulators.
  const sims = [];
  const simStats = new Map();
  for (let i = 0; i < SIMULATORS; i++) {
    const covens = [];
    for (let n = i; n < COVENS; n += SIMULATORS) covens.push(n);
    const child = fork(fileURLToPath(import.meta.url), ['--simulator'], { env: { ...process.env, SIM: JSON.stringify({ covens, url: URL }) }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.on('message', (m) => { if (m?.type === 'stats') simStats.set(i, m.stats); });
    sims.push(child);
  }
  const t0 = Date.now();
  const ready = await Promise.all(sims.map((c) => new Promise((r) => c.on('message', (m) => m?.type === 'ready' && r(m.players)))));
  const seated = ready.reduce((a, b) => a + b, 0);
  console.log(`gathered: ${seated} wizards seated in their covens in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const c of sims) c.send('go');

  // Steady play.
  let peak = { rss: 0 };
  const start = Date.now();
  let last = null;
  while (Date.now() - start < DURATION * 1000) {
    await sleep(5000);
    last = await metrics();
    if (!last) continue;
    peak.rss = Math.max(peak.rss, last.memory.rss);
    const sims = [...simStats.values()];
    const sum = (f) => sims.reduce((a, s) => a + (s[f] || 0), 0);
    console.log(`  t+${Math.round((Date.now() - start) / 1000)}s  players ${last.players}  rooms ${last.rooms}  tick p95 ${last.tick.p95.toFixed(2)}ms (cycle ${last.tick.cycleP95.toFixed(1)}, max ${last.tick.max.toFixed(1)})  rss ${(last.memory.rss / 1024 ** 2).toFixed(0)} MB  ` +
      `snapshots ${sum('snapshots')}  casts ${sum('casts')}  tasks ${sum('tasks')}  V ${sum('invis')}  client errors ${sum('errors')}`);
  }
  const final = await metrics();
  const sims2 = [...simStats.values()];
  const clientErrors = sims2.reduce((a, s) => a + s.errors, 0);
  const connected = sims2.reduce((a, s) => a + s.connected, 0);
  const snapshots = sims2.reduce((a, s) => a + s.snapshots, 0);
  const bytes = sims2.reduce((a, s) => a + s.bytes, 0);
  for (const c of sims) c.send('stop');
  await sleep(1500);
  server.kill();

  const errors = clientErrors + (final?.errors ?? 0) + serverErrors.length;
  const perPlayerRate = bytes / Math.max(1, final?.players ?? 1) / DURATION;
  console.log('\n— results —');
  console.log(`connected players: ${connected} (in game: ${final.players})`);
  console.log(`active rooms:      ${final.rooms}`);
  console.log(`errors:            ${errors} (client ${clientErrors}, tick ${final.errors}, server stderr ${serverErrors.length})`);
  console.log(`tick time:         p95 ${final.tick.p95.toFixed(2)} ms · p99 ${final.tick.p99.toFixed(2)} ms · max ${final.tick.max.toFixed(1)} ms per tick slot (worst worker, last 60 s; ${final.tick.slots} staggered slots per 50 ms tick)`);
  console.log(`                   full 50 ms cycle p95 ${final.tick.cycleP95.toFixed(2)} ms · ${(final.tick.perRoom * 1000).toFixed(0)} µs per room per tick (sim + snapshot + send)`);
  console.log(`memory:            ${(final.memory.rss / 1024 ** 2).toFixed(0)} MB RSS (peak ${(peak.rss / 1024 ** 2).toFixed(0)} MB) across ${final.workers} workers + coordinator`);
  console.log(`network:           ${snapshots} snapshots received · ${(perPlayerRate / 1024).toFixed(2)} KB/s per player downstream`);
  for (const w of final.perWorker) console.log(`  worker ${w.worker}: ${w.rooms} rooms, ${w.players} players, slot p95 ${w.p95.toFixed(2)} ms, cycle p95 ${w.cycleP95.toFixed(2)} ms, ${(w.rss / 1024 ** 2).toFixed(0)} MB`);
  for (const e of [...serverErrors.slice(0, 5), ...sims2.flatMap((s) => s.errorLog).slice(0, 5)]) console.log(`  ! ${e}`);

  const fail = [];
  if (connected < PLAYERS || final.players < PLAYERS) fail.push(`expected ${PLAYERS} players (connected ${connected}, in game ${final.players})`);
  if (final.rooms < COVENS) fail.push(`expected ${COVENS} active rooms (${final.rooms})`);
  if (errors) fail.push(`${errors} errors`);
  if (!(final.tick.p95 < LIMITS.tickP95)) fail.push(`p95 tick ${final.tick.p95.toFixed(2)} ms ≥ ${LIMITS.tickP95} ms`);
  if (!(peak.rss < LIMITS.rssBytes)) fail.push(`memory ${(peak.rss / 1024 ** 2).toFixed(0)} MB ≥ 1536 MB`);
  if (fail.length) {
    console.error(`\n✗ ${fail.join('; ')}`);
    process.exit(1);
  }
  console.log(`\n✓ ${PLAYERS} players · ${COVENS} rooms · 0 errors · p95 tick ${final.tick.p95.toFixed(2)} ms < ${LIMITS.tickP95} ms · ${(peak.rss / 1024 ** 2).toFixed(0)} MB < 1536 MB`);
  process.exit(0);
}

if (process.argv.includes('--simulator')) simulator();
else main().catch((e) => { console.error(e); process.exit(1); });
