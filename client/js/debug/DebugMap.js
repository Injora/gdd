// Top-down debug overlay (?debug=1 or solo test, toggle with M): tiles, rooms,
// props, Hearts (once revealed), every player, and tabs to look at (and
// click-teleport to) any of the three floors.

import { TILE, TILE_WALL, TILE_DOOR, TILE_VOID, FLOOR_ORDER, FLOOR_LABELS } from '/shared/constants.js';
import { WIZARD_BY_ID } from '/shared/wizards.js';

const SCALE = 6;
const TABS = 22; // px strip at the top with the floor tabs

export class DebugMap {
  /** @param onPick (floor, x, z) => void, called when the map is clicked */
  constructor(canvas, map, onPick) {
    this.canvas = canvas;
    this.onPick = onPick;
    this.viewFloor = null; // null = follow the player
    canvas.onclick = (e) => {
      const r = canvas.getBoundingClientRect();
      const k = canvas.width / r.width;
      const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
      if (py < TABS) {
        const i = Math.floor(px / (canvas.width / FLOOR_ORDER.length));
        this.viewFloor = FLOOR_ORDER[Math.max(0, Math.min(FLOOR_ORDER.length - 1, i))];
        this.floor = -1;
        return;
      }
      const s = TILE / SCALE;
      this.onPick?.(this.floor, px * s, (py - TABS) * s);
    };
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.visible = false;
    this.floor = -1;
    this.base = null;
  }

  toggle() {
    this.visible = !this.visible;
    this.canvas.classList.toggle('hidden', !this.visible);
    if (!this.visible) this.viewFloor = null;
  }

  drawBase(floor) {
    const f = this.map.floors[floor];
    const c = document.createElement('canvas');
    c.width = 60 * SCALE;
    c.height = 60 * SCALE + TABS;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        const t = f.tiles[i];
        ctx.fillStyle = t === TILE_WALL ? '#000' : t === TILE_VOID ? '#120a1a' : f.blocked[i] ? '#3a2a22' : t === TILE_DOOR ? '#4a3a2a' : f.roomIds[i] >= 0 ? '#2a2420' : '#1d1a24';
        ctx.fillRect(x * SCALE, TABS + y * SCALE, SCALE, SCALE);
      }
    }
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8a7f70';
    for (const r of this.map.rooms) {
      if (r.floor === floor) ctx.fillText(r.name, (r.cx + 0.5) * SCALE, TABS + (r.cy + 0.5) * SCALE - 8);
    }
    // Floor tabs
    const tw = c.width / FLOOR_ORDER.length;
    FLOOR_ORDER.forEach((fl, i) => {
      ctx.fillStyle = fl === floor ? '#4a3418' : '#1a120a';
      ctx.fillRect(i * tw + 1, 1, tw - 2, TABS - 2);
      ctx.fillStyle = fl === floor ? '#f6d26a' : '#8a7f70';
      ctx.font = '11px Georgia, serif';
      ctx.fillText(FLOOR_LABELS[fl], i * tw + tw / 2, 15);
    });
    this.base = c;
    this.floor = floor;
    this.canvas.width = c.width;
    this.canvas.height = c.height;
  }

  draw(playerFloor, players, roster, heartIds, destroyed) {
    if (!this.visible) return;
    const floor = this.viewFloor ?? playerFloor;
    if (this.floor !== floor) this.drawBase(floor);
    const ctx = this.ctx;
    ctx.drawImage(this.base, 0, 0);
    const s = SCALE / TILE;
    for (const p of this.map.props) {
      if (p.floor !== floor || !p.interact) continue;
      let color = '#777';
      if (p.kind === 'tome') color = '#ffd84a';
      else if (p.kind === 'altar') color = '#b04aff';
      else if (p.interact === 'stairs') color = '#4ad8ff';
      else if (p.kind === 'gate') color = '#ff8a2a';
      else if (p.interact === 'task') color = '#e0a040';
      else if (heartIds.has(p.id)) color = destroyed.has(p.id) ? '#333' : '#ff2020';
      ctx.fillStyle = color;
      ctx.fillRect(p.x * s - 3, TABS + p.z * s - 3, 6, 6);
    }
    for (const [id, p] of players) {
      if (p.f !== floor) continue;
      const w = WIZARD_BY_ID[roster.find((m) => m.id === id)?.wizardId];
      ctx.fillStyle = w?.color ?? '#fff';
      ctx.beginPath();
      ctx.arc(p.x * s, TABS + p.z * s, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(p.x * s, TABS + p.z * s);
      ctx.lineTo(p.x * s - Math.sin(p.yaw) * 10, TABS + p.z * s - Math.cos(p.yaw) * 10);
      ctx.stroke();
    }
  }
}
