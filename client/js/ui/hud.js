// In-game DOM overlay: objective, hearts tracker, room titles, interaction
// prompt + channel bar, banners, whispers, team list, stamina, journal.

import { WIZARD_BY_ID } from '/shared/wizards.js';
import { PHASE, HEART_COUNT, STAMINA } from '/shared/constants.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const OBJECTIVES = {
  [PHASE.TOME]: ['Phase I · The Tome', 'Somewhere in this house is the Ritual Book. Find it. Read it.'],
  [PHASE.HEARTS]: ['Phase II · The Six Hearts', 'Find and destroy the six Hearts hidden among the mansion’s things. [J] Journal'],
  [PHASE.CONVERGENCE]: ['Phase II · Complete', 'Six hearts are silent. Return to the Ritual Altar together.'],
  [PHASE.ARCHON]: ['Phase III · The Archon', 'Seven elements. One body. Drag it into Hell.'],
};

export class HUD {
  constructor() {
    this.root = $('hud');
    this.timers = {};
    this.lastRoom = null;
    this.hearts = null;
    this.destroyed = new Set();
    this.journalOpen = false;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  flash(el, cls, ms) {
    el.classList.add(cls);
    clearTimeout(this.timers[el.id]);
    this.timers[el.id] = setTimeout(() => el.classList.remove(cls), ms);
  }

  setPhase(phase) {
    const [title, text] = OBJECTIVES[phase] ?? ['', ''];
    let extra = '';
    if (phase === PHASE.HEARTS) extra = ` <b>${this.destroyed.size}/${HEART_COUNT}</b>`;
    $('hud-objective').innerHTML = `<small>${esc(title)}</small>${esc(text)}${extra}`;
    this.phase = phase;
  }

  room(name) {
    if (!name || name === this.lastRoom) return;
    this.lastRoom = name;
    const el = $('hud-room');
    el.textContent = name;
    this.flash(el, 'show', 2600);
  }

  prompt(text, hold) {
    const el = $('hud-prompt');
    $('hud-crosshair').classList.toggle('active', !!text);
    el.innerHTML = text ? `<kbd>${hold ? 'Hold E' : 'E'}</kbd>${esc(text)}` : '';
  }

  progress(frac) {
    const el = $('hud-progress');
    if (frac === null) return el.classList.add('hidden');
    el.classList.remove('hidden');
    el.firstElementChild.style.width = `${Math.min(100, frac * 100)}%`;
  }

  banner(title, sub = '', ms = 4200) {
    const el = $('hud-banner');
    el.querySelector('h2').textContent = title;
    el.querySelector('p').textContent = sub;
    this.flash(el, 'show', ms);
  }

  whisper(text, ms = 4500) {
    const el = $('hud-whisper');
    el.textContent = text;
    this.flash(el, 'show', ms);
  }

  stamina(v) {
    const el = $('hud-stamina');
    el.firstElementChild.style.width = `${(v / STAMINA.max) * 100}%`;
    el.classList.toggle('full', v >= STAMINA.max - 0.5);
  }

  light(on) {
    $('hud-light').textContent = on ? '' : 'WAND DARK [F]';
  }

  team(roster, positions, selfId, roomName) {
    const ul = $('hud-team');
    const html = roster
      .filter((m) => m.id !== selfId)
      .map((m) => {
        const w = WIZARD_BY_ID[m.wizardId];
        const p = positions.get(m.id);
        const where = p ? roomName(p) : 'gone';
        return `<li style="--wiz:${w?.color ?? '#555'}"><span class="dot"></span>${esc(m.name)} <span class="where">${esc(where)}</span></li>`;
      })
      .join('');
    if (html !== this._teamHtml) {
      ul.innerHTML = html;
      this._teamHtml = html;
    }
  }

  setHearts(hearts) {
    this.hearts = hearts;
    const el = $('hud-hearts');
    el.classList.remove('hidden');
    this.renderHearts();
  }

  heartDestroyed(propId) {
    this.destroyed.add(propId);
    this.renderHearts();
    this.setPhase(this.phase);
  }

  renderHearts() {
    if (!this.hearts) return;
    $('hud-hearts').innerHTML = this.hearts
      .map((h) => `<span class="h ${this.destroyed.has(h.propId) ? 'dead' : ''}" title="${esc(h.name)}">♥</span>`)
      .join('');
    this.renderJournal();
  }

  setJournal(tome) {
    this.tome = tome;
    this.renderJournal();
  }

  renderJournal() {
    if (!this.tome) return;
    $('journal-text').innerHTML = this.tome.text.map((p) => `<p>${esc(p)}</p>`).join('');
    $('journal-hearts').innerHTML = this.tome.hearts
      .map((h) => `<li class="${this.destroyed.has(h.propId) ? 'done' : ''}"><b>${esc(h.name)}.</b> ${esc(h.clue)}</li>`)
      .join('');
  }

  toggleJournal(open = !this.journalOpen) {
    if (open && !this.tome) {
      this.whisper('Your journal is empty. You have not found the Tome.');
      return false;
    }
    this.journalOpen = open;
    $('journal').classList.toggle('hidden', !open);
    return open;
  }
}
