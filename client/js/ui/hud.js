// In-game DOM overlay: objective, hearts tracker, room titles, interaction
// prompt + channel bar, banners, whispers, team list, stamina, journal.

import { WIZARD_BY_ID } from '/shared/wizards.js';
import { PHASE, HEART_COUNT, STAMINA } from '/shared/constants.js';
import { ULT } from '/shared/wizards.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SPELL_GLYPHS = {
  psychic_torment: '\u263E', dimension_slash: '\u263D', black_hole: '\u25C9', shadow_step: '\u2601', abyssal_mind_fracture: '\u2620',
  ignis_blast: '\u2668', calidus_brachium: '\u270A', sol_linea: '\u2600', phoenix_dash: '\u2735', fiendfyre_dragon: '\u2652',
  tidal_surge: '\u2652', water_spear: '\u2191', riptide_geyser: '\u058D', slipstream: '\u25CE', abyssal_deluge: '\u2248',
  terra_spike: '\u25B2', devils_snare: '\u2698', golem_boulder: '\u25CF', earthen_rampart: '\u25A3', yggdrasil: '\u2E19',
  gale_force: '\u2248', kamaitachi: '\u263E', vacuum_tempest: '\u058E', zephyr_glide: '\u27B3', sylph_dragon: '\u2652',
  sacred_bind: '\u2600', arrows_of_judgment: '\u2694', solar_nova: '\u2726', flash_step: '\u26A1', dawn_sacred_order: '\u2609',
  black_divider: '\u2694', black_slash: '\u263D', bull_thrust: '\u2648', aegis_void: '\u2205', devil_union: '\u2742',
};

/** 272 → "4:32" */
export const ultClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const OBJECTIVES = {
  [PHASE.TOME]: ['Phase I · The Tome', 'Somewhere in this house is the Ritual Book. Find it. Read it.'],
  [PHASE.HEARTS]: ['Phase II · The Seven Hearts', 'Do each Sin’s three room tasks, break its Heart open, slay the Sin. [M] Map · [J] Journal'],
  [PHASE.CONVERGENCE]: ['Phase II · Complete', 'Seven hearts are silent. Return to the Ritual Altar together.'],
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

  /** The centre dot grows a ring when it's on something you can use. */
  crosshair(active) {
    if (active === this._cross) return;
    this._cross = active;
    $('hud-crosshair').classList.toggle('active', active);
  }

  prompt(text, hold) {
    const el = $('hud-prompt');
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

  /** A Heart died (by heart type). */
  heartDestroyed(type) {
    this.destroyed.add(type);
    this.renderHearts();
    this.setPhase(this.phase);
  }

  renderHearts() {
    if (!this.hearts) return;
    $('hud-hearts').innerHTML = this.hearts
      .map((h) => `<span class="h ${this.destroyed.has(h.type) ? 'dead' : ''}" title="${esc(h.name)}">♥</span>`)
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
      .map((h) => `<li class="${this.destroyed.has(h.type) ? 'done' : ''}"><b>${esc(h.name)}.</b> ${esc(h.clue)}</li>`)
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
    ult.title += ' (charges over 5 minutes; once per game)';
    bar.appendChild(ult);
    this.ultEl = ult;
    $('hud-wizard').textContent = `${wizard.name} \u00b7 ${wizard.title} \u00b7 ${wizard.element}`;
    this._cdKeys = [];
    this._ultKey = null;
    this.select(this.selected ?? 0);
  }

  /** Highlight the selected slot (0–3, or 'ult'): number keys and R only select. */
  select(slot) {
    this.selected = slot;
    this.slots?.forEach((el, i) => el.classList.toggle('selected', i === slot));
    this.ultEl?.classList.toggle('selected', slot === 'ult');
    const sp = slot === 'ult' ? this.wizard?.ultimate : this.wizard?.spells[slot];
    if (sp) $('hud-spellname').textContent = slot === 'ult' ? `ULTIMATE · ${sp.name}` : sp.name;
  }

  /** The Disillusionment Charm (V): an infinite toggle, no cooldown. */
  invis(on) {
    if (on === this._invisOn) return;
    this._invisOn = on;
    const el = $('hud-invis');
    el.classList.toggle('active', on);
    el.querySelector('.time').textContent = on ? 'ON' : '';
    $('screen-invis').classList.toggle('on', on);
  }

  /** The Keeper's footsteps: a proximity bar (0..1) and a ripple on each footfall. */
  footsteps(closeness, step = false) {
    const el = $('hud-footsteps');
    const key = Math.round(closeness * 40);
    if (key !== this._stepKey) {
      this._stepKey = key;
      el.classList.toggle('show', closeness > 0);
      el.classList.toggle('near', closeness > 0.6);
      el.querySelector('i').style.width = `${Math.round(closeness * 100)}%`;
    }
    if (step && closeness > 0) {
      const r = el.querySelector('.ripple');
      r.classList.remove('go');
      void r.offsetWidth;
      r.style.setProperty('--k', String(0.4 + closeness * 0.6));
      r.classList.add('go');
    }
  }

  /** Top right: the task tracker for the Heart room you're standing in (or null). */
  tracker(text, color = null, state = 'sealed') {
    const el = $('hud-tracker');
    const key = `${text}|${state}`;
    if (key === this._trackKey) return;
    this._trackKey = key;
    el.classList.toggle('show', !!text);
    if (!text) return;
    el.dataset.state = state;
    el.style.setProperty('--sin', color ?? '#f6d26a');
    el.textContent = text;
  }

  /** The Keeper's capture screen (1.5s). */
  captureScreen(on) {
    $('capture-screen').classList.toggle('show', on);
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

  /** Charging (an MM:SS countdown to READY), READY, or EXPENDED (once per game). */
  ult(charge, expended = false) {
    const left = Math.max(0, Math.ceil(((ULT.MAX - charge) / ULT.MAX) * ULT.CHARGE_TIME));
    const key = expended ? 'x' : charge >= ULT.MAX ? 'r' : left;
    if (key === this._ultKey || !this.ultEl) return;
    this._ultKey = key;
    this.ultEl.style.setProperty('--charge', String(expended ? 0 : Math.min(1, charge / ULT.MAX)));
    this.ultEl.querySelector('.pct').textContent = expended ? 'EXPENDED' : charge >= ULT.MAX ? 'READY' : ultClock(left);
    this.ultEl.classList.toggle('ready', !expended && charge >= ULT.MAX);
    this.ultEl.classList.toggle('expended', expended);
  }

  denied(slot) {
    const el = slot === 'ult' ? this.ultEl : slot === 'invis' ? $('hud-invis') : this.slots?.[slot ?? this.selected];
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

  boss(hp, max, ward, text, title = 'THE UNBOUND MALPHAS AMALGAM', color = null, enraged = false) {
    const el = $('hud-boss');
    el.classList.toggle('hidden', hp === null);
    if (hp === null) return;
    el.querySelector('span').textContent = title;
    el.style.setProperty('--boss', color ?? '#c0102a');
    el.querySelector('i').style.width = `${Math.max(0, (hp / max) * 100)}%`;
    el.classList.toggle('ward', !!ward);
    el.classList.toggle('enraged', enraged);
    el.querySelector('small').textContent = text;
  }

  selectMastery(key) { this._mastery = key; }

  /** Archon form: show the 7 Masteries (the selected one highlighted; click fires it). */
  masteries(list, readyMap, selected = this._mastery) {
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
      node.classList.toggle('selected', M.key === selected);
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
