// In-game DOM overlay: objective, hearts tracker, room titles, interaction
// prompt + channel bar, banners, whispers, team list, stamina, journal.

import { WIZARD_BY_ID } from '/shared/wizards.js';
import { PHASE, HEART_COUNT, STAMINA } from '/shared/constants.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SPELL_GLYPHS = {
  psychic_torment: '\u263E', dimension_slash: '\u263D', black_hole: '\u25C9', shadow_step: '\u2601', abyssal_mind_fracture: '\u2620',
  ignis_blast: '\u2668', calidus_brachium: '\u270A', sol_linea: '\u2600', phoenix_aura: '\u2735', fiendfyre_dragon: '\u2652',
  tidal_surge: '\u2652', water_spear: '\u2191', sea_cradle: '\u25CE', riptide_vortex: '\u058D', abyssal_deluge: '\u2248',
  terra_spike: '\u25B2', devils_snare: '\u2698', golem_boulder: '\u25CF', granite_skin: '\u25A3', yggdrasil: '\u2E19',
  gale_force: '\u2248', kamaitachi: '\u263E', zephyr_tailwind: '\u27B3', vacuum_tempest: '\u058E', sylph_dragon: '\u2652',
  sacred_bind: '\u2600', arrows_of_judgment: '\u2694', patronus_beacon: '\u2726', flash_step: '\u26A1', dawn_sacred_order: '\u2609',
  aegis_void: '\u2205', black_slash: '\u2694', null_zone: '\u29B8', bull_thrust: '\u2648', devil_union: '\u2742',
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

  light(on) { this.lumos(on); }

  team(roster, positions, selfId, roomName) {
    const ul = $('hud-team');
    const html = roster
      .filter((m) => m.id !== selfId)
      .map((m) => {
        const w = WIZARD_BY_ID[m.wizardId];
        const p = positions.get(m.id);
        const where = p ? roomName(p) : 'gone';
        const held = p?.cap ? ' <span class="held">HELD</span>' : p?.cg ? ' <span class="held">TAKEN</span>' : '';
        const hp = p ? `<span class="hpbar"><i style="width:${Math.max(0, Math.min(100, p.hp ?? 100))}%"></i></span>` : '';
        return `<li style="--wiz:${w?.color ?? '#555'}"><span class="dot"></span>${esc(m.name)}${held} ${hp} <span class="where">${esc(where)}</span></li>`;
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

  // ---- hotbar: 4 spells + Ultimate --------------------------------------------------

  setWizard(wizard) {
    this.wizard = wizard;
    const bar = $('hud-hotbar');
    bar.style.setProperty('--wiz', wizard.color);
    $('hud-bottom').style.setProperty('--wiz', wizard.color);
    bar.innerHTML = '';
    this.slots = wizard.spells.map((sp, i) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.style.setProperty('--wiz', wizard.color);
      el.title = `${sp.name}: ${sp.description}`;
      el.innerHTML = `<span class="glyph">${SPELL_GLYPHS[sp.id] ?? '\u2726'}</span><span class="key">${i + 1}</span><div class="cd"></div><span class="time"></span>`;
      bar.appendChild(el);
      return el;
    });
    const ult = document.createElement('div');
    ult.className = 'slot ult';
    ult.style.setProperty('--wiz', wizard.color);
    ult.title = `ULTIMATE: ${wizard.ultimate.name}: ${wizard.ultimate.description}`;
    ult.innerHTML = `<div class="charge"></div><span class="glyph">${SPELL_GLYPHS[wizard.ultimate.id] ?? '\u2605'}</span><span class="key">R</span><span class="pct"></span>`;
    bar.appendChild(ult);
    this.ultEl = ult;
    $('hud-wizard').textContent = `${wizard.name} \u00b7 ${wizard.title} \u00b7 ${wizard.element}`;
    this._cdKeys = [];
    this._ultKey = null;
    this.select(this.selected ?? 0);
  }

  select(slot) {
    this.selected = slot;
    this.slots?.forEach((el, i) => el.classList.toggle('selected', i === slot));
    const sp = this.wizard?.spells[slot];
    if (sp) $('hud-spellname').textContent = sp.name;
  }

  /** remaining/duration (seconds) per slot; call every frame. */
  cooldowns(list) {
    list.forEach(({ remaining, duration }, i) => {
      const key = remaining > 0 ? Math.ceil(remaining * 10) : 0;
      if (this._cdKeys[i] === key) return;
      this._cdKeys[i] = key;
      const el = this.slots?.[i];
      if (!el) return;
      el.style.setProperty('--cd', remaining > 0 && duration > 0 ? String(remaining / duration) : '0');
      el.querySelector('.time').textContent = remaining > 0 ? (remaining >= 10 ? Math.ceil(remaining) : remaining.toFixed(1)) : '';
    });
  }

  ult(charge) {
    const key = Math.floor(charge);
    if (key === this._ultKey || !this.ultEl) return;
    this._ultKey = key;
    this.ultEl.style.setProperty('--charge', String(Math.min(1, charge / 100)));
    this.ultEl.querySelector('.pct').textContent = charge >= 100 ? 'READY' : `${key}%`;
    this.ultEl.classList.toggle('ready', charge >= 100);
  }

  denied(slot) {
    const el = slot === 'ult' ? this.ultEl : this.slots?.[slot ?? this.selected];
    if (!el) return;
    el.classList.remove('denied');
    void el.offsetWidth;
    el.classList.add('denied');
  }

  hp(value) {
    const key = Math.ceil(value);
    if (key === this._hp) return;
    this._hp = key;
    const el = $('hud-hp');
    el.querySelector('.fill').style.width = `${Math.max(0, Math.min(100, value))}%`;
    el.querySelector('span').textContent = key;
    el.classList.toggle('low', value <= 40);
  }

  lumos(on) {
    const el = $('hud-lumos');
    el.textContent = on ? 'LUMOS' : 'NOX';
    el.classList.toggle('on', on);
  }

  buffs(codes) {
    const key = codes.join(',');
    if (key === this._buffKey) return;
    this._buffKey = key;
    const order = ['union', 'shadow', 'phoenix', 'granite', 'cradle', 'tailwind'];
    const show = order.find((c) => codes.includes(c));
    $('buff-fx').className = `buff-fx${show ? ` ${show}` : ''}`;
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

  // ---- Phase III ------------------------------------------------------------------

  ritual(progress, text) {
    const el = $('hud-ritual');
    el.classList.toggle('hidden', progress === null);
    if (progress === null) return;
    el.querySelector('i').style.width = `${Math.round(progress * 100)}%`;
    el.querySelector('small').textContent = text;
  }

  boss(hp, max, ward, text) {
    const el = $('hud-boss');
    el.classList.toggle('hidden', hp === null);
    if (hp === null) return;
    el.querySelector('i').style.width = `${Math.max(0, (hp / max) * 100)}%`;
    el.classList.toggle('ward', !!ward);
    el.querySelector('small').textContent = text;
  }

  /** Archon form: show the 7 Masteries instead of nothing. */
  masteries(list, readyMap) {
    const el = $('hud-masteries');
    if (!list) {
      el.classList.add('hidden');
      return;
    }
    if (el.classList.contains('hidden')) {
      el.classList.remove('hidden');
      el.innerHTML = list.map((M) => `<div class="slot" style="--wiz:${M.color}" data-id="${M.id}" title="${esc(M.name)}">
        <span class="glyph">${M.glyph}</span><span class="key">${M.key}</span><div class="cd"></div><span class="time"></span><span class="name">${esc(M.name)}</span></div>`).join('');
    }
    for (const node of el.querySelectorAll('.slot')) {
      const M = list.find((m) => m.id === node.dataset.id);
      const left = readyMap?.[M.id] ?? 0;
      node.style.setProperty('--cd', String(left > 0 ? left / M.cooldown : 0));
      node.querySelector('.time').textContent = left > 0 ? left.toFixed(1) : '';
    }
  }

  gameOver(show, isHost) {
    $('gameover').classList.toggle('hidden', !show);
    $('btn-retry').disabled = !isHost;
    $('btn-to-lobby').disabled = !isHost;
    $('gameover-wait').textContent = isHost ? '' : 'Waiting for the host to choose\u2026';
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
