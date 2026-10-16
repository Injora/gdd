// Thin wrapper around the Socket.io client (loaded as a global by index.html).
//
// Step 9: in cluster mode each coven lives on one worker process. The server
// says which worker this socket reached ('hello'); joining a coven that
// another worker owns reconnects there first (?coven=CODE routes it), and
// every handler registered through `net.on` moves to the new socket.

import { shardOf } from '/shared/shard.js';
import { NET_VERSION } from '/shared/netcodec.js';

const handlers = new Map(); // event -> Set(fn)
let shard = { index: 0, count: 1 };

/**
 * The server runs different code than this page (it was started before an
 * update, or the page is stale): snapshots would never decode, so nothing
 * else in the world would ever appear. Say so instead of failing silently.
 */
function versionMismatch(why) {
  if (document.getElementById('version-mismatch')) return;
  const el = document.createElement('div');
  el.id = 'version-mismatch';
  el.textContent = `${why} Restart the server (Ctrl+C, then npm start) and reload this page.`;
  document.body.appendChild(el);
}

function connect(coven = null) {
  const s = window.io({ transports: ['websocket'], query: coven ? { coven } : {}, forceNew: true });
  let greeted = false;
  s.on('hello', (h) => {
    greeted = true;
    shard = { index: h.shard, count: h.shards };
    if (h.net !== NET_VERSION) versionMismatch(`The server speaks network protocol v${h.net ?? 0}, this page v${NET_VERSION}.`);
  });
  // A server from before Step 9 never says hello, and sends JSON snapshots as 'game:snap'.
  s.on('connect', () => setTimeout(() => { if (!greeted && s.connected) versionMismatch('The server is running an older version of HorCrux.'); }, 4000));
  s.on('game:snap', () => versionMismatch('The server is running an older version of HorCrux.'));
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
