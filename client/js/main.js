// Entry point: title -> lobby -> game.

import { net } from './net.js';
import { LobbyUI } from './ui/lobby.js';
import { GameClient } from './game.js';

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
if (debug) document.body.classList.add('debug');

let game = null;

const lobby = new LobbyUI(net, { debug });

net.on('game:start', (init) => {
  lobby.hide();
  game?.dispose();
  game = new GameClient({
    canvas: document.getElementById('game-canvas'),
    net,
    init,
    debug: debug || lobby.soloMode,
  });
});

// The host returned everyone to the coven after a game over.
net.on('game:end', () => {
  game?.dispose();
  game = null;
  lobby.showLobby();
});

net.on('disconnect', () => {
  if (game) {
    game.dispose();
    game = null;
  }
  lobby.showTitle('Lost contact with the server. Refresh to reconnect.');
});
