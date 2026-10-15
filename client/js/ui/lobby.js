// Title screen and lobby (coven) screen.

import { WIZARDS, WIZARD_BY_ID } from '/shared/wizards.js';

const $ = (id) => document.getElementById(id);

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* storage unavailable (private mode etc.) */ }
  return null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export class LobbyUI {
  constructor(net, { debug }) {
    this.net = net;
    this.debug = debug;
    this.state = null;
    this.soloMode = false;

    $('input-name').value = storage('sixhearts.name') ?? '';
    $('btn-create').onclick = () => this.create(false);
    $('btn-solo').onclick = () => this.create(true);
    $('btn-join').onclick = () => this.join();
    $('input-code').addEventListener('keydown', (e) => e.key === 'Enter' && this.join());
    $('input-name').addEventListener('keydown', (e) => e.key === 'Enter' && this.create(false));

    $('btn-add-bot').onclick = () => this.act('lobby:bot:add');
    $('btn-ready').onclick = () => net.emit('lobby:ready', { ready: !this.me()?.ready });
    $('btn-start').onclick = () => this.act('lobby:start');
    $('chk-solo').onchange = (e) => net.emit('lobby:solo', { allowSolo: e.target.checked });
    $('btn-leave').onclick = () => {
      net.emit('lobby:leave');
      this.showTitle();
    };

    net.on('lobby:state', (s) => this.render(s));

    const autoCode = new URLSearchParams(location.search).get('join');
    if (autoCode) $('input-code').value = autoCode.toUpperCase();
  }

  name() {
    const n = $('input-name').value.trim();
    storage('sixhearts.name', n);
    return n;
  }

  error(msg) { $('title-error').textContent = msg || ''; }

  async create(solo) {
    this.error('');
    const res = await this.net.request('lobby:create', { name: this.name(), solo, debug: this.debug });
    if (!res?.ok) return this.error(res?.error);
    this.soloMode = solo;
    this.showLobby();
  }

  async join() {
    this.error('');
    const code = $('input-code').value.trim();
    if (!code) return this.error('Enter a coven code.');
    const res = await this.net.request('lobby:join', { name: this.name(), code });
    if (!res?.ok) return this.error(res?.error);
    this.soloMode = false;
    this.showLobby();
  }

  async act(event, data) {
    const res = await this.net.request(event, data);
    if (res && !res.ok && res.error) $('lobby-status').textContent = res.error;
  }

  /** Our socket id. The lobby state can arrive before the create/join reply, so never cache it. */
  get selfId() { return this.net.id; }

  me() { return this.state?.members.find((m) => m.id === this.selfId); }

  showTitle(message) {
    $('screen-lobby').classList.add('hidden');
    $('screen-title').classList.remove('hidden');
    this.state = null;
    this.error(message);
  }

  showLobby() {
    $('screen-title').classList.add('hidden');
    $('screen-lobby').classList.remove('hidden');
  }

  hide() {
    $('screen-title').classList.add('hidden');
    $('screen-lobby').classList.add('hidden');
  }

  render(s) {
    this.state = s;
    if (s.inGame) return;
    $('lobby-code').textContent = s.code;
    const me = this.me();
    const isHost = s.hostId === this.selfId;

    // Wizard cards
    const grid = $('wizard-grid');
    grid.innerHTML = '';
    for (const w of WIZARDS) {
      const holder = s.members.find((m) => m.wizardId === w.id);
      const mine = holder?.id === this.selfId;
      const card = document.createElement('button');
      card.className = 'wizard-card' + (mine ? ' mine' : '');
      card.style.setProperty('--wiz', w.color);
      card.disabled = !!holder && !holder.isBot && !mine;
      card.innerHTML = `
        <div class="head"><div class="sigil"></div><div>
          <h4>${escapeHtml(w.name)}</h4>
          <div class="element">${escapeHtml(w.element)}</div>
        </div></div>
        <div class="title">${escapeHtml(w.title)}</div>
        <div class="ability"><b>${escapeHtml(w.ability.name)}.</b> ${escapeHtml(w.ability.description)}</div>
        <div class="cd">Cooldown ${w.ability.cooldown}s</div>
        ${holder ? `<div class="owner">${mine ? 'Your wizard' : `Chosen by ${escapeHtml(holder.name)}`}</div>` : ''}`;
      card.onclick = () => this.act('lobby:pick', { wizardId: w.id });
      grid.appendChild(card);
    }

    // Roster
    const roster = $('roster');
    roster.innerHTML = '';
    for (let i = 0; i < s.max; i++) {
      const m = s.members[i];
      const li = document.createElement('li');
      if (!m) {
        li.className = 'empty';
        li.textContent = i < s.min ? 'Awaiting a soul…' : 'Empty (optional)';
      } else {
        const w = WIZARD_BY_ID[m.wizardId];
        if (w) li.style.setProperty('--wiz', w.color);
        const tag = m.isBot ? 'BOT' : m.id === s.hostId ? 'HOST' : m.ready ? 'READY' : 'NOT READY';
        const ready = m.isBot || m.ready || m.id === s.hostId;
        li.innerHTML = `<span class="dot"></span>
          <span class="who">${escapeHtml(m.name)}${m.id === this.selfId ? ' (you)' : ''}<small>${w ? escapeHtml(w.name) : 'choosing…'}</small></span>
          <span class="tag ${ready ? 'ready' : ''}">${tag}</span>`;
        if (m.isBot && isHost) {
          const x = document.createElement('button');
          x.className = 'remove';
          x.title = 'Remove bot';
          x.textContent = '✕';
          x.onclick = () => this.act('lobby:bot:remove', { botId: m.id });
          li.appendChild(x);
        }
      }
      roster.appendChild(li);
    }

    // Controls
    $('btn-add-bot').classList.toggle('hidden', !isHost);
    $('btn-add-bot').disabled = s.members.length >= s.max;
    $('chk-solo').parentElement.classList.toggle('hidden', !isHost);
    $('chk-solo').checked = s.allowSolo;
    $('btn-ready').classList.toggle('hidden', isHost);
    $('btn-ready').disabled = !me?.wizardId;
    $('btn-ready').textContent = me?.ready ? 'Not ready' : 'Ready';
    $('btn-ready').classList.toggle('active', !!me?.ready);
    $('btn-start').classList.toggle('hidden', !isHost);
    $('btn-start').disabled = !!s.startBlocker;
    $('lobby-status').textContent = s.startBlocker
      ? s.startBlocker
      : isHost ? 'The coven is gathered.' : 'Waiting for the host to begin…';
  }
}
