// HorCrux — game server.
// Serves the browser client and runs authoritative lobbies/games over Socket.io.
//
// Step 9: one process (the default, and what the tests use), or a cluster:
// WORKERS=auto (one per core) or WORKERS=N starts a coordinator that hands
// every incoming connection to the worker owning its coven. Clients name the
// coven they want in the Socket.io URL (?coven=ABCD; see shared/shard.js), so
// all four wizards of a coven always land on the same worker. Requests that
// name no coven go to the least-loaded worker (which creates new covens).

import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces, availableParallelism } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cluster from 'node:cluster';
import net from 'node:net';
import path from 'node:path';
import { Server } from 'socket.io';
import { LobbyManager } from './server/LobbyManager.js';
import { scheduler } from './server/TickScheduler.js';
import { mapStats, cacheSize } from './server/MapCache.js';
import { shardOf } from './shared/shard.js';

const root = path.dirname(fileURLToPath(import.meta.url));

/** This process's load and health, for /metrics. */
export function processMetrics(lobbies) {
  const mem = process.memoryUsage();
  return {
    pid: process.pid,
    ...lobbies.stats(),
    tick: scheduler.stats(),
    maps: { cached: cacheSize(), ...mapStats },
    memory: { rss: mem.rss, heapUsed: mem.heapUsed },
  };
}

/**
 * Build (but don't start) the HTTP + Socket.io server.
 * @param shard { index, count } in cluster mode
 */
export function createGameServer({ shard = { index: 0, count: 1 } } = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    pingInterval: 10000,
    pingTimeout: 8000,
    maxHttpBufferSize: 64 * 1024, // no client message is anywhere near this
    perMessageDeflate: false, // binary snapshots are already compact; save the CPU
  });
  const lobbies = new LobbyManager(io, shard);

  app.use(express.static(path.join(root, 'client')));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
  app.get('/healthz', (_req, res) => res.json({ ok: true, lobbies: lobbies.count }));
  app.get('/metrics', (_req, res) => res.json({ workers: 1, ...processMetrics(lobbies) }));

  io.on('connection', (socket) => lobbies.handleConnection(socket));
  return { app, httpServer, io, lobbies };
}

/** WORKERS=auto | N  (default 1: a single process). */
export function workerCount(env = process.env.WORKERS) {
  if (!env) return 1;
  if (env === 'auto') return Math.max(1, availableParallelism());
  return Math.max(1, Math.floor(Number(env)) || 1);
}

/** The coven a request names, from its first line: GET /socket.io/?coven=ABCD&… */
export function covenOf(head) {
  const line = head.slice(0, head.indexOf('\r\n') >>> 0);
  const m = /[?&]coven=([A-Za-z]{4})(?:[&\s]|$)/.exec(line);
  return m ? m[1].toUpperCase() : null;
}

// ---- cluster mode -------------------------------------------------------------------

function runPrimary(PORT, count) {
  const workers = [];
  let shuttingDown = false;
  // A clean shutdown: the workers finish their current tick and exit.
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const w of workers) w.process.kill('SIGTERM');
    let left = workers.length;
    for (const w of workers) w.once('exit', () => { if (--left === 0) process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  const load = new Map(); // worker index -> last metrics
  const assigned = new Array(count).fill(0); // new connections routed since its last report
  const spawn = (index) => {
    const w = cluster.fork({ WORKER_INDEX: String(index), WORKER_COUNT: String(count), ...(process.env.PROFILE_DIR ? { NODE_OPTIONS: `--cpu-prof --cpu-prof-dir=${process.env.PROFILE_DIR}` } : {}) });
    w.on('message', (msg) => {
      if (msg?.type !== 'metrics') return;
      load.set(index, msg.metrics);
      assigned[index] = 0;
    });
    w.on('exit', (code) => {
      if (shuttingDown) return;
      console.error(`  worker ${index} exited (${code}); restarting`);
      workers[index] = spawn(index);
    });
    return w;
  };
  for (let i = 0; i < count; i++) workers.push(spawn(i));

  // New covens go where there are the fewest sockets (as last reported, plus what we've sent since).
  const leastLoaded = () => {
    const score = (i) => (load.get(i)?.sockets ?? 0) + assigned[i];
    let best = 0;
    for (let i = 1; i < count; i++) if (score(i) < score(best)) best = i;
    assigned[best]++;
    return best;
  };
  const metrics = () => {
    const all = [...load.values()];
    const sum = (f) => all.reduce((a, m) => a + (f(m) || 0), 0);
    return {
      workers: count,
      reporting: all.length,
      lobbies: sum((m) => m.lobbies), games: sum((m) => m.games), sockets: sum((m) => m.sockets),
      players: sum((m) => m.tick.players), rooms: sum((m) => m.tick.rooms),
      errors: sum((m) => m.tick.errors), throttled: sum((m) => m.throttled), kicked: sum((m) => m.kicked),
      tick: {
        p95: Math.max(0, ...all.map((m) => m.tick.p95)), p99: Math.max(0, ...all.map((m) => m.tick.p99)), max: Math.max(0, ...all.map((m) => m.tick.max)),
        cycleP95: Math.max(0, ...all.map((m) => m.tick.cycleP95)), perRoom: Math.max(0, ...all.map((m) => m.tick.perRoom)), slots: all[0]?.tick.slots ?? 1,
      },
      memory: { rss: sum((m) => m.memory.rss) + process.memoryUsage().rss, heapUsed: sum((m) => m.memory.heapUsed) },
      perWorker: [...load.entries()].sort((a, b) => a[0] - b[0]).map(([i, m]) => ({ worker: i, rooms: m.tick.rooms, players: m.tick.players, p95: m.tick.p95, cycleP95: m.tick.cycleP95, rss: m.memory.rss })),
    };
  };

  // Every connection is read up to its first request line, then handed (with
  // the bytes already read) to the worker that owns the coven it names.
  const server = net.createServer({ pauseOnConnect: true }, (conn) => {
    let head = Buffer.alloc(0);
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      const text = head.toString('latin1');
      if (!text.includes('\r\n') && head.length < 8192) return;
      conn.off('data', onData);
      conn.pause();
      if (text.startsWith('GET /metrics')) {
        const body = JSON.stringify(metrics());
        conn.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
        return;
      }
      const coven = covenOf(text);
      const index = coven ? shardOf(coven, count) : leastLoaded();
      if (coven) assigned[index]++; // (joins load a worker too: count them until it next reports)
      workers[index].send({ type: 'conn', head: head.toString('base64') }, conn);
    };
    conn.on('data', onData);
    conn.on('error', () => conn.destroy());
    conn.resume();
  });
  server.listen(PORT, () => {
    console.log(`\n  HorCrux server listening (cluster: ${count} workers)`);
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Metrics: http://localhost:${PORT}/metrics\n`);
  });
  return server;
}

function runWorker() {
  const index = Number(process.env.WORKER_INDEX);
  const count = Number(process.env.WORKER_COUNT);
  const { httpServer, lobbies } = createGameServer({ shard: { index, count } });
  process.on('message', (msg, conn) => {
    if (msg?.type !== 'conn' || !conn) return;
    conn.unshift(Buffer.from(msg.head, 'base64')); // replay what the coordinator read
    httpServer.emit('connection', conn);
    conn.resume();
  });
  setInterval(() => process.send?.({ type: 'metrics', metrics: processMetrics(lobbies) }), 1000).unref();
  const bye = () => { lobbies.close(); process.exit(0); };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (cluster.isWorker && process.env.WORKER_INDEX !== undefined) {
  runWorker();
} else if (isMain) {
  const PORT = Number(process.env.PORT) || 3666;
  const count = workerCount();
  if (count > 1) {
    runPrimary(PORT, count);
  } else {
    const { httpServer } = createGameServer();
    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n  Port ${PORT} is already in use. Try: PORT=4000 npm start\n`);
        process.exit(1);
      }
      throw err;
    });
    httpServer.listen(PORT, () => {
      console.log(`\n  HorCrux server listening`);
      console.log(`  Local:   http://localhost:${PORT}`);
      for (const addrs of Object.values(networkInterfaces())) {
        for (const a of addrs ?? []) {
          if (a.family === 'IPv4' && !a.internal) console.log(`  LAN:     http://${a.address}:${PORT}`);
        }
      }
      console.log(`  Debug:   http://localhost:${PORT}/?debug=1\n`);
    });
  }
}
