// In-game DOM overlay: objective, hearts tracker, room titles, interaction
// prompt + channel bar, banners, whispers, team list, stamina, journal.

import { WIZARD_BY_ID } from '/shared/wizards.js';
import { PHASE, HEART_COUNT, STAMINA } from '/shared/constants.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ELEMENT_GLYPHS = {
  Black: '\u263E',
  Fire: '\u2668',
  Water: '\u2652',
  Earth: '\u25B2',
  Wind: '\u2248',
  White: '\u2600',
  'Anti-magic': '\u2205',
};

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

  // ---- spell widget ---------------------------------------------------------------

  setSpell(wizard) {
    const el = $('hud-spell');
    el.style.setProperty('--wiz', wizard.color);
    el.querySelector('.spell-name').textContent = wizard.ability.name;
    el.querySelector('.spell-wiz').textContent = `${wizard.title} \u00b7 ${wizard.element}`;
    el.querySelector('.dial-glyph').textContent = ELEMENT_GLYPHS[wizard.element] ?? '\u2726';
    el.title = wizard.ability.description;
    this._cd = null;
  }

  /** remaining/duration in seconds; call every frame. */
  cooldown(remaining, duration) {
    const key = remaining > 0 ? Math.ceil(remaining * 10) : 0;
    if (key === this._cd) return;
    this._cd = key;
    const el = $('hud-spell');
    const frac = remaining > 0 && duration > 0 ? remaining / duration : 0;
    el.querySelector('.arc').style.strokeDashoffset = `${175.93 * frac}`;
    el.querySelector('.dial-time').textContent = remaining > 0 ? (remaining >= 10 ? Math.ceil(remaining) : remaining.toFixed(1)) : '';
    el.classList.toggle('cooling', remaining > 0);
    el.classList.toggle('ready', remaining <= 0);
  }

  denied() {
    const el = $('hud-spell');
    el.classList.remove('denied');
    void el.offsetWidth;
    el.classList.add('denied');
  }

  /** Full-screen flash: 'torment' | 'white' | 'hit' | 'blocked'. */
  screen(kind, strength = 1) {
    const el = $('screen-fx');
    el.className = 'screen-fx';
    void el.offsetWidth;
    el.style.setProperty('--fx-strength', String(strength));
    el.classList.add(kind);
  }

  caption(text, ms = 3000) {
    const el = $('hud-caption');
    el.textContent = text;
    this.flash(el, 'show', ms);
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
