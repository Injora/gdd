// Lobbies ("covens"): create/join by code, wizard selection, bots, ready-up,
// and the hand-off into a Game.

import { WIZARDS, WIZARD_BY_ID } from '../shared/wizards.js';
import { MIN_PLAYERS, MAX_PLAYERS } from '../shared/constants.js';
import { Game } from './Game.js';
import { botName } from './names.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
let botCounter = 0;

function sanitizeName(name) {
  const clean = String(name ?? '').replace(/[<>&"'`]/g, '').trim().slice(0, 16);
  return clean || `Wanderer${Math.floor(Math.random() * 900 + 100)}`;
}

class Lobby {
  constructor(code, hostId) {
    this.code = code;
    this.room = `coven:${code}`;
    this.hostId = hostId;
    this.members = []; // { id, name, wizardId, ready, isBot }
    this.allowSolo = false;
    this.debug = false; // enables debug:* commands (teleport, husk, wizard swap)
    this.game = null;
  }

  get humans() { return this.members.filter((m) => !m.isBot); }
  member(id) { return this.members.find((m) => m.id === id); }
  takenBy(wizardId) { return this.members.find((m) => m.wizardId === wizardId); }
  freeWizards() { return WIZARDS.filter((w) => !this.takenBy(w.id)); }

  /** Why the host cannot start yet, or null if they can. */
  startBlocker() {
    if (this.members.length < MIN_PLAYERS && !this.allowSolo) {
      return `Need ${MIN_PLAYERS}–${MAX_PLAYERS} wizards (add bots, or enable solo debug).`;
    }
    if (this.members.some((m) => !m.wizardId)) return 'Every member must choose a wizard.';
    if (this.humans.some((m) => m.id !== this.hostId && !m.ready)) return 'Waiting for everyone to be ready.';
    return null;
  }

  view() {
    return {
      code: this.code,
      hostId: this.hostId,
      allowSolo: this.allowSolo,
      inGame: !!this.game,
      members: this.members.map(({ id, name, wizardId, ready, isBot }) => ({ id, name, wizardId, ready, isBot })),
      startBlocker: this.startBlocker(),
      min: MIN_PLAYERS,
      max: MAX_PLAYERS,
    };
  }
}

export class LobbyManager {
  constructor(io) {
    this.io = io;
    this.lobbies = new Map();
    this.socketLobby = new Map(); // socket.id -> code
  }

  get count() { return this.lobbies.size; }

  newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.lobbies.has(code)) return code;
    }
  }

  broadcast(lobby) {
    this.io.to(lobby.room).emit('lobby:state', lobby.view());
  }

  lobbyOf(socket) {
    return this.lobbies.get(this.socketLobby.get(socket.id));
  }

  handleConnection(socket) {
    const reply = (cb, payload) => typeof cb === 'function' && cb(payload);
    const hostInGame = (fn) => (data) => {
      const lobby = this.lobbyOf(socket);
      if (lobby?.game && lobby.hostId === socket.id) fn(lobby, data ?? {});
    };
    const hostOnly = (fn) => (data, cb) => {
      const lobby = this.lobbyOf(socket);
      if (!lobby || lobby.hostId !== socket.id || lobby.game) return reply(cb, { ok: false, error: 'Only the host can do that.' });
      fn(lobby, data ?? {}, cb);
    };

    socket.on('lobby:create', (data, cb) => {
      this.leave(socket);
      const lobby = new Lobby(this.newCode(), socket.id);
      lobby.allowSolo = !!data?.solo;
      lobby.debug = !!(data?.solo || data?.debug);
      this.lobbies.set(lobby.code, lobby);
      this.join(socket, lobby, sanitizeName(data?.name));
      if (data?.solo) {
        this.addBot(lobby);
        this.addBot(lobby);
        this.broadcast(lobby);
      }
      reply(cb, { ok: true, code: lobby.code, selfId: socket.id });
    });

    socket.on('lobby:join', (data, cb) => {
      const code = String(data?.code ?? '').toUpperCase().trim();
      const lobby = this.lobbies.get(code);
      if (!lobby) return reply(cb, { ok: false, error: `No coven gathers under the code ${code || '????'}.` });
      if (lobby.game) return reply(cb, { ok: false, error: 'That ritual has already begun.' });
      if (lobby.members.length >= MAX_PLAYERS) {
        const bot = lobby.members.find((m) => m.isBot);
        if (!bot) return reply(cb, { ok: false, error: 'That coven is full.' });
        lobby.members.splice(lobby.members.indexOf(bot), 1); // humans take priority over bots
      }
      this.leave(socket);
      this.join(socket, lobby, sanitizeName(data?.name));
      reply(cb, { ok: true, code: lobby.code, selfId: socket.id });
    });

    socket.on('lobby:leave', () => this.leave(socket));

    socket.on('lobby:pick', (data, cb) => {
      const lobby = this.lobbyOf(socket);
      const me = lobby?.member(socket.id);
      const wizard = WIZARD_BY_ID[data?.wizardId];
      if (!me || lobby.game || !wizard) return reply(cb, { ok: false });
      const holder = lobby.takenBy(wizard.id);
      if (holder && holder.id !== me.id) {
        if (!holder.isBot) return reply(cb, { ok: false, error: `${holder.name} already walks as ${wizard.name}.` });
        // Bots yield their wizard to humans and pick another.
        holder.wizardId = null;
        me.wizardId = wizard.id;
        holder.wizardId = lobby.freeWizards()[0]?.id ?? null;
        holder.name = botName(holder.wizardId);
      } else {
        me.wizardId = wizard.id;
      }
      me.ready = false;
      this.broadcast(lobby);
      reply(cb, { ok: true });
    });

    socket.on('lobby:ready', (data) => {
      const lobby = this.lobbyOf(socket);
      const me = lobby?.member(socket.id);
      if (!me || lobby.game) return;
      me.ready = !!data?.ready && !!me.wizardId;
      this.broadcast(lobby);
    });

    socket.on('lobby:bot:add', hostOnly((lobby, _d, cb) => {
      if (lobby.members.length >= MAX_PLAYERS) return reply(cb, { ok: false, error: 'The coven is full.' });
      this.addBot(lobby);
      this.broadcast(lobby);
      reply(cb, { ok: true });
    }));

    socket.on('lobby:bot:remove', hostOnly((lobby, data, cb) => {
      const bot = lobby.member(data.botId);
      if (bot?.isBot) lobby.members.splice(lobby.members.indexOf(bot), 1);
      this.broadcast(lobby);
      reply(cb, { ok: true });
    }));

    socket.on('lobby:solo', hostOnly((lobby, data) => {
      lobby.allowSolo = !!data.allowSolo;
      this.broadcast(lobby);
    }));

    socket.on('lobby:start', hostOnly((lobby, _d, cb) => {
      const blocker = lobby.startBlocker();
      if (blocker) return reply(cb, { ok: false, error: blocker });
      this.startGame(lobby);
      reply(cb, { ok: true });
    }));

    // In-game traffic is forwarded to the lobby's Game.
    socket.on('p:state', (data) => this.lobbyOf(socket)?.game?.onPlayerState(socket.id, data));
    socket.on('p:interact', (data) => this.lobbyOf(socket)?.game?.onInteract(socket.id, data?.propId, data?.entityId));
    socket.on('p:cancel', () => this.lobbyOf(socket)?.game?.onCancel(socket.id));
    socket.on('p:cast', (data) => this.lobbyOf(socket)?.game?.onCast(socket.id, data));
    socket.on('p:ping', () => this.lobbyOf(socket)?.game?.onPing(socket.id));

    // After a game over the host chooses: retry the phase, or back to the coven.
    socket.on('game:restart', hostInGame((lobby, data) => {
      if (data.mode === 'lobby') lobby.game.end();
      else lobby.game.restartPhase();
    }));

    // Debug overrides, only in covens created as solo tests or with ?debug=1.
    const debugGame = () => {
      const lobby = this.lobbyOf(socket);
      return lobby?.debug ? lobby.game : null;
    };
    socket.on('debug:teleport', (data) => debugGame()?.debugTeleport(socket.id, data));
    socket.on('debug:husk', () => debugGame()?.debugHusk(socket.id));
    socket.on('debug:mode', () => debugGame()?.debugMode(socket.id));
    socket.on('debug:capture', () => debugGame()?.debugCapture(socket.id));
    socket.on('debug:ult', () => debugGame()?.debugUlt(socket.id));
    socket.on('debug:wizard', (data) => debugGame()?.debugWizard(socket.id, data?.wizardId));

    socket.on('disconnect', () => this.leave(socket));
  }

  join(socket, lobby, name) {
    lobby.members.push({ id: socket.id, name, wizardId: null, ready: false, isBot: false });
    this.socketLobby.set(socket.id, lobby.code);
    socket.join(lobby.room);
    this.broadcast(lobby);
  }

  leave(socket) {
    const lobby = this.lobbyOf(socket);
    this.socketLobby.delete(socket.id);
    if (!lobby) return;
    socket.leave(lobby.room);
    const i = lobby.members.findIndex((m) => m.id === socket.id);
    if (i >= 0) lobby.members.splice(i, 1);
    lobby.game?.removePlayer(socket.id);

    if (lobby.humans.length === 0) {
      lobby.game?.stop();
      this.lobbies.delete(lobby.code);
      return;
    }
    if (lobby.hostId === socket.id) lobby.hostId = lobby.humans[0].id;
    if (!lobby.game) this.broadcast(lobby);
  }

  addBot(lobby) {
    const wizard = lobby.freeWizards()[0];
    if (!wizard || lobby.members.length >= MAX_PLAYERS) return;
    lobby.members.push({
      id: `bot-${++botCounter}`,
      name: botName(wizard.id),
      wizardId: wizard.id,
      ready: true,
      isBot: true,
    });
  }

  startGame(lobby) {
    lobby.game = new Game(this.io, lobby, () => {
      lobby.game = null;
      for (const m of lobby.members) m.ready = m.isBot;
      this.io.to(lobby.room).emit('game:end');
      this.broadcast(lobby);
    });
    lobby.game.start();
  }
}
