// Top-down debug overlay (?debug=1 or solo test, toggle with M): tiles, rooms,
// props, Hearts (once revealed), and every player.

import { TILE, TILE_WALL, TILE_DOOR } from '/shared/constants.js';
import { WIZARD_BY_ID } from '/shared/wizards.js';

const SCALE = 6;

export class DebugMap {
  /** @param onPick (floor, x, z) => void, called when the map is clicked */
  constructor(canvas, map, onPick) {
    this.canvas = canvas;
    this.onPick = onPick;
    canvas.onclick = (e) => {
      const r = canvas.getBoundingClientRect();
      const s = (canvas.width / r.width) * (TILE / SCALE);
      this.onPick?.(this.floor, (e.clientX - r.left) * s, (e.clientY - r.top) * s);
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
  }

  drawBase(floor) {
    const f = this.map.floors[floor];
    const c = document.createElement('canvas');
    c.width = f.w * SCALE;
    c.height = f.h * SCALE;
    const ctx = c.getContext('2d');
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        const t = f.tiles[i];
        ctx.fillStyle = t === TILE_WALL ? '#000' : f.blocked[i] ? '#3a2a22' : t === TILE_DOOR ? '#4a3a2a' : f.roomIds[i] >= 0 ? '#2a2420' : '#1d1a24';
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
      }
    }
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8a7f70';
    for (const r of this.map.rooms) {
      if (r.floor === floor) ctx.fillText(r.name, (r.cx + 0.5) * SCALE, (r.cy + 0.5) * SCALE - 8);
    }
    this.base = c;
    this.floor = floor;
    this.canvas.width = c.width;
    this.canvas.height = c.height;
  }

  draw(floor, players, roster, heartIds, destroyed) {
    if (!this.visible) return;
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
      else if (heartIds.has(p.id)) color = destroyed.has(p.id) ? '#333' : '#ff2020';
      ctx.fillStyle = color;
      ctx.fillRect(p.x * s - 3, p.z * s - 3, 6, 6);
    }
    for (const [id, p] of players) {
      if (p.f !== floor) continue;
      const w = WIZARD_BY_ID[roster.find((m) => m.id === id)?.wizardId];
      ctx.fillStyle = w?.color ?? '#fff';
      ctx.beginPath();
      ctx.arc(p.x * s, p.z * s, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(p.x * s, p.z * s);
      ctx.lineTo(p.x * s - Math.sin(p.yaw) * 10, p.z * s - Math.cos(p.yaw) * 10);
      ctx.stroke();
    }
  }
}
