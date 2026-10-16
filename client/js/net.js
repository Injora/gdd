// Thin wrapper around the Socket.io client (loaded as a global by index.html).
//
// Step 9: in cluster mode each coven lives on one worker process. The server
// says which worker this socket reached ('hello'); joining a coven that
// another worker owns reconnects there first (?coven=CODE routes it), and
// every handler registered through `net.on` moves to the new socket.

import { shardOf } from '/shared/shard.js';

const handlers = new Map(); // event -> Set(fn)
let shard = { index: 0, count: 1 };

function connect(coven = null) {
  const s = window.io({ transports: ['websocket'], query: coven ? { coven } : {}, forceNew: true });
  s.on('hello', (h) => { shard = { index: h.shard, count: h.shards }; });
  for (const [event, fns] of handlers) for (const fn of fns) s.on(event, fn);
  return s;
}

let socket = connect();

export const net = {
  get socket() { return socket; },
  get id() { return socket.id; },
  emit: (event, data) => socket.emit(event, data),
  on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    socket.on(event, fn);
  },
  off(event, fn) {
    handlers.get(event)?.delete(fn);
    socket.off(event, fn);
  },
  /** Make sure this socket is on the worker that owns coven `code` (a no-op on a single server). */
  async route(code) {
    if (shard.count <= 1 || shardOf(code, shard.count) === shard.index) return;
    const old = socket;
    old.removeAllListeners();
    old.disconnect();
    socket = connect(code);
    await new Promise((resolve) => {
      const done = () => { socket.off('hello', done); resolve(); };
      socket.on('hello', done);
      setTimeout(done, 5000);
    });
  },
  /** Emit with an acknowledgement callback, as a Promise. */
  request(event, data, timeoutMs = 6000) {
    return new Promise((resolve) => {
      socket.timeout(timeoutMs).emit(event, data, (err, res) => {
        resolve(err ? { ok: false, error: 'The server did not answer. Is it running?' } : res);
      });
    });
  },
};
