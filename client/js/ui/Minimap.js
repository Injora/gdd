// The Marauder's-Map-style minimap, fixed top-left: an ink-on-parchment plan
// of the floor you're on (Floor 2, Floor 1 or the Basement), its room names,
// stairs, a gold arrow for you and coloured ones for your coven, sealed Sin
// arenas cross-hatched in blood, and red ripples wherever the Keeper's
// footsteps fall within earshot (FOOTSTEPS.range, 28 units).
//
// Static ink is drawn once per floor; the dynamic layer redraws ~20 times a
// second. `layout()` is pure (no DOM) so tests can check what it would show.

import { TILE, TILE_WALL, TILE_DOOR, TILE_VOID, FLOOR, FLOOR_LABELS, FLOOR_ORDER, FOOTSTEPS } from '/shared/constants.js';
import { WIZARD_BY_ID } from '/shared/wizards.js';

const PX = 8; // static layer: pixels per tile
const VIEW = 34; // tiles across the visible window
export const FOOTSTEP_RANGE = FOOTSTEPS.range;

/** What the minimap shows for `floor` (pure: used by tests and the renderer). */
export function minimapLayout(map, floor) {
  const f = map.floors[floor];
  const rooms = map.rooms.filter((r) => r.floor === floor).map((r) => ({ id: r.id, name: r.name, cx: r.cx, cy: r.cy, x: r.x, y: r.y, w: r.w, h: r.h, type: r.type }));
  const stairs = map.props.filter((p) => p.floor === floor && p.interact === 'stairs').map((p) => ({ id: p.id, tx: p.tx, ty: p.ty, to: p.target?.floor }));
  let walls = 0, voids = 0, open = 0;
  for (const t of f.tiles) {
    if (t === TILE_WALL) walls++;
    else if (t === TILE_VOID) voids++;
    else open++;
  }
  return { floor, label: FLOOR_LABELS[floor], w: f.w, h: f.h, rooms, stairs, walls, voids, open };
}

export class Minimap {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.layers = new Map();
    this.floor = -1;
    this.ripples = [];
    this.lastStepAt = 0;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = canvas.clientWidth || 236;
    canvas.width = Math.round(size * this.dpr);
    canvas.height = Math.round(size * this.dpr);
    this.parchment = this.makeParchment(canvas.width, canvas.height);
  }

  makeParchment(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w * 0.75);
    g.addColorStop(0, '#d9c49a');
    g.addColorStop(0.7, '#c2a774');
    g.addColorStop(1, '#7a5c32');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 22;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.7;
    }
    ctx.putImageData(img, 0, 0);
    // Foxing and tea stains
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 6 + Math.random() * 30;
      const s = ctx.createRadialGradient(x, y, 0, x, y, r);
      s.addColorStop(0, 'rgba(110,70,30,0.22)');
      s.addColorStop(1, 'rgba(110,70,30,0)');
      ctx.fillStyle = s;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return c;
  }

  /** The floor's ink drawing at PX px/tile. */
  layer(floor) {
    if (this.layers.has(floor)) return this.layers.get(floor);
    const L = minimapLayout(this.map, floor);
    const f = this.map.floors[floor];
    const c = document.createElement('canvas');
    c.width = f.w * PX;
    c.height = f.h * PX;
    const ctx = c.getContext('2d');
    const wall = (x, y) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? true : f.tiles[y * f.w + x] === TILE_WALL);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x, t = f.tiles[i];
        if (t === TILE_WALL) continue;
        if (t === TILE_VOID) {
          ctx.strokeStyle = 'rgba(60,35,15,0.35)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x * PX, y * PX + PX);
          ctx.lineTo(x * PX + PX, y * PX);
          ctx.stroke();
          continue;
        }
        ctx.fillStyle = f.roomIds[i] >= 0 ? 'rgba(120,80,40,0.10)' : 'rgba(90,55,25,0.16)';
        if (t === TILE_DOOR) ctx.fillStyle = 'rgba(90,55,25,0.22)';
        ctx.fillRect(x * PX, y * PX, PX, PX);
      }
    }
    // Ink outlines where walkable meets wall.
    ctx.strokeStyle = '#3b230e';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        if (wall(x, y)) continue;
        if (wall(x, y - 1)) { ctx.moveTo(x * PX, y * PX); ctx.lineTo(x * PX + PX, y * PX); }
        if (wall(x, y + 1)) { ctx.moveTo(x * PX, y * PX + PX); ctx.lineTo(x * PX + PX, y * PX + PX); }
        if (wall(x - 1, y)) { ctx.moveTo(x * PX, y * PX); ctx.lineTo(x * PX, y * PX + PX); }
        if (wall(x + 1, y)) { ctx.moveTo(x * PX + PX, y * PX); ctx.lineTo(x * PX + PX, y * PX + PX); }
      }
    }
    ctx.stroke();
    // Stairs: a little spiral, with an arrow to where it leads.
    for (const s of L.stairs) {
      const cx = (s.tx + 0.5) * PX, cy = (s.ty + 0.5) * PX;
      ctx.strokeStyle = '#2a4a6a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 4; a += 0.3) ctx.lineTo(cx + Math.cos(a) * a * 0.45, cy + Math.sin(a) * a * 0.45);
      ctx.stroke();
      ctx.fillStyle = '#2a4a6a';
      ctx.font = 'bold 9px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.to === FLOOR.UPPER || (s.to === FLOOR.GROUND && floor === FLOOR.BASEMENT) ? '▲' : '▼', cx, cy - 7);
    }
    // Room names in a cramped italic hand.
    ctx.fillStyle = '#3b230e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of L.rooms) {
      const size = r.w * r.h > 60 ? 12 : 10;
      ctx.font = `italic ${size}px "IM Fell English", Georgia, serif`;
      const words = r.name.split(' ');
      const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : [r.name];
      lines.forEach((line, i) => ctx.fillText(line, (r.cx + 0.5) * PX, (r.cy + 0.5) * PX + (i - (lines.length - 1) / 2) * (size + 1)));
    }
    const out = { canvas: c, layout: L };
    this.layers.set(floor, out);
    return out;
  }

  /** A Keeper footstep within earshot: a ripple on the map. */
  footstep(x, z, floor) {
    this.ripples.push({ x, z, floor, age: 0 });
    if (this.ripples.length > 12) this.ripples.shift();
  }

  /**
   * @param me      { x, z, floor, yaw }
   * @param others  [{ x, z, f, yaw, color, held }]
   * @param arenas  [{ roomId, floor }]
   * @param keeper  { x, z, f, moving } | null
   */
  draw(dt, t, me, others, arenas, keeper) {
    const ctx = this.ctx;
    const W = this.canvas.width, Hh = this.canvas.height;
    const { canvas: layer } = this.layer(me.floor);
    const f = this.map.floors[me.floor];
    // View window (tiles), clamped to the floor.
    const view = Math.min(VIEW, Math.max(f.w, f.h));
    let vx = me.x / TILE - view / 2, vy = me.z / TILE - view / 2;
    vx = Math.max(0, Math.min(f.w - view, vx));
    vy = Math.max(0, Math.min(f.h - view, vy));
    if (f.w < view) vx = (f.w - view) / 2;
    if (f.h < view) vy = (f.h - view) / 2;
    const scale = W / view; // canvas px per tile
    const toX = (wx) => (wx / TILE - vx) * scale, toY = (wz) => (wz / TILE - vy) * scale;

    ctx.drawImage(this.parchment, 0, 0);
    ctx.drawImage(layer, vx * PX, vy * PX, view * PX, view * PX, 0, 0, W, Hh);

    // Sealed arenas: blood cross-hatching and a rune.
    for (const a of arenas) {
      if (a.floor !== me.floor) continue;
      const r = this.map.rooms[a.roomId];
      const x = (r.x - vx) * scale, y = (r.y - vy) * scale, w = r.w * scale, h = r.h * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.strokeStyle = `rgba(170,10,10,${0.45 + Math.sin(t * 5) * 0.15})`;
      ctx.lineWidth = 1.5 * this.dpr;
      for (let k = -h; k < w; k += 7 * this.dpr) {
        ctx.beginPath();
        ctx.moveTo(x + k, y + h);
        ctx.lineTo(x + k + h, y);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = '#a00a0a';
      ctx.lineWidth = 2 * this.dpr;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#8a0606';
      ctx.font = `bold ${14 * this.dpr}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ᛉ SEALED ᛉ', x + w / 2, y + h / 2);
    }

    // The Keeper's footsteps: ripples (only within earshot, only on your floor).
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      if (r.age > 1.6) { this.ripples.splice(i, 1); continue; }
      if (r.floor !== me.floor) continue;
      const k = r.age / 1.6;
      ctx.strokeStyle = `rgba(200,10,10,${(1 - k) * 0.9})`;
      ctx.lineWidth = (2.5 - k * 1.5) * this.dpr;
      ctx.beginPath();
      ctx.arc(toX(r.x), toY(r.z), (3 + k * 22) * this.dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(toX(r.x), toY(r.z), (1 + k * 12) * this.dpr, 0, Math.PI * 2);
      ctx.stroke();
    }

    const arrow = (x, y, yaw, color, size, outline) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-yaw);
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.62, size * 0.7);
      ctx.lineTo(0, size * 0.32);
      ctx.lineTo(-size * 0.62, size * 0.7);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.4 * this.dpr;
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.restore();
    };
    for (const o of others) {
      if (o.f !== me.floor) continue;
      arrow(toX(o.x), toY(o.z), o.yaw, o.color, 6 * this.dpr, '#2a1608');
      if (o.held) {
        ctx.fillStyle = '#8a0606';
        ctx.font = `bold ${10 * this.dpr}px Georgia, serif`;
        ctx.fillText('✕', toX(o.x), toY(o.z) - 10 * this.dpr);
      }
    }
    arrow(toX(me.x), toY(me.z), me.yaw, '#f6d26a', 8 * this.dpr, '#3b230e');

    // Frame + floor label.
    ctx.strokeStyle = '#4a2c10';
    ctx.lineWidth = 3 * this.dpr;
    ctx.strokeRect(1.5 * this.dpr, 1.5 * this.dpr, W - 3 * this.dpr, Hh - 3 * this.dpr);
    ctx.fillStyle = 'rgba(60,35,12,0.85)';
    ctx.fillRect(0, Hh - 22 * this.dpr, W, 22 * this.dpr);
    ctx.font = `${11 * this.dpr}px "IM Fell English", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tabs = FLOOR_ORDER.map((fl) => (fl === FLOOR.UPPER ? 'II' : fl === FLOOR.GROUND ? 'I' : 'B'));
    const label = FLOOR_LABELS[me.floor].toUpperCase();
    ctx.fillStyle = '#f2dfb4';
    ctx.fillText(label, W / 2, Hh - 11 * this.dpr);
    FLOOR_ORDER.forEach((fl, i) => {
      ctx.fillStyle = fl === me.floor ? '#f6d26a' : 'rgba(242,223,180,0.35)';
      ctx.fillText(tabs[i], 12 * this.dpr + i * 14 * this.dpr, 12 * this.dpr);
    });
    this.floor = me.floor;
  }
}

/** Wizard colour for an arrow. */
export const arrowColor = (wizardId) => WIZARD_BY_ID[wizardId]?.color ?? '#ddd';
