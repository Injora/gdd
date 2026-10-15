// SEVEN HEARTS: THE FORBIDDEN CONVERGENCE — game server.
// Serves the browser client and runs authoritative lobbies/games over Socket.io.

import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Server } from 'socket.io';
import { LobbyManager } from './server/LobbyManager.js';

const root = path.dirname(fileURLToPath(import.meta.url));

/** Build (but don't start) the HTTP + Socket.io server. */
export function createGameServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { pingInterval: 10000, pingTimeout: 8000 });
  const lobbies = new LobbyManager(io);

  app.use(express.static(path.join(root, 'client')));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
  app.get('/healthz', (_req, res) => res.json({ ok: true, lobbies: lobbies.count }));

  io.on('connection', (socket) => lobbies.handleConnection(socket));
  return { app, httpServer, io, lobbies };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const PORT = Number(process.env.PORT) || 3666;
  const { httpServer } = createGameServer();
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} is already in use. Try: PORT=4000 npm start\n`);
      process.exit(1);
    }
    throw err;
  });
  httpServer.listen(PORT, () => {
    console.log(`\n  SEVEN HEARTS server listening`);
    console.log(`  Local:   http://localhost:${PORT}`);
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  LAN:     http://${a.address}:${PORT}`);
      }
    }
    console.log(`  Debug:   http://localhost:${PORT}/?debug=1\n`);
  });
}
