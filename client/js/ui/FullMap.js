// The full map (M or Tab, for every player): all three floors behind tabs,
// room names, the whole coven, and, once the Tome is read, which Sin keeps
// which Heart, each room task's progress (0/3 – 3/3), and every room under
// lockdown. In ?debug=1 games a click on the plan teleports you there.

import { TILE, TILE_WALL, TILE_DOOR, TILE_VOID, FLOOR_ORDER, FLOOR_LABELS } from '/shared/constants.js';
import { WIZARD_BY_ID } from '/shared/wizards.js';
import { heartStatus } from '/shared/heartinfo.js';

const SCALE = 10; // px per tile
const TABS = 30; // floor tabs strip
const GRID = 60; // tiles across (the largest floor)
const PANEL = 300; // the Hearts list on the right
const FOOT = 26;
const W = GRID * SCALE + PANEL;
const H = TABS + GRID * SCALE + FOOT;
const STATE_TEXT = { sealed: 'SEALED', unsealed: 'UNSEALED', lockdown: 'LOCKDOWN', slain: 'SLAIN' };

export class FullMap {
  /**
   * @param onPick (floor, x, z) => void: debug teleport, or null in normal games
   */
  constructor(canvas, map, onPick = null) {
    this.canvas = canvas;
    this.map = map;
    this.onPick = onPick;
    this.ctx = canvas.getContext('2d');
    this.canvas.width = W;
    this.canvas.height = H;
    this.visible = false;
    this.viewFloor = null; // null = follow the player
    this.bases = new Map();
    canvas.classList.toggle('teleport', !!onPick);
    canvas.onclick = (e) => {
      const r = canvas.getBoundingClientRect();
      const k = canvas.width / r.width;
      const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
      if (py < TABS && px < GRID * SCALE) {
        const i = Math.floor(px / ((GRID * SCALE) / FLOOR_ORDER.length));
        this.viewFloor = FLOOR_ORDER[Math.max(0, Math.min(FLOOR_ORDER.length - 1, i))];
        return;
      }
      if (!this.onPick || px >= GRID * SCALE || py >= TABS + GRID * SCALE) return; // teleport: debug only
      const s = TILE / SCALE;
      this.onPick(this.shown, px * s, (py - TABS) * s);
    };
  }

  toggle(open = !this.visible) {
    this.visible = open;
    this.canvas.classList.toggle('hidden', !open);
    if (!open) this.viewFloor = null;
    return open;
  }

  /** Static plan of one floor: tiles, room fills and names. */
  base(floor) {
    if (this.bases.has(floor)) return this.bases.get(floor);
    const f = this.map.floors[floor];
    const c = document.createElement('canvas');
    c.width = GRID * SCALE;
    c.height = GRID * SCALE;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#07060a';
    ctx.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        const t = f.tiles[i];
        if (t === TILE_WALL) continue;
        ctx.fillStyle = t === TILE_VOID ? '#150b1e' : f.blocked[i] ? '#3a2c22' : t === TILE_DOOR ? '#5a442c' : f.roomIds[i] >= 0 ? '#2b241f' : '#1c1922';
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
      }
    }
    // Wall edges: a thin ink line wherever open floor meets a wall.
    ctx.fillStyle = '#6a5a44';
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        if (f.tiles[y * f.w + x] === TILE_WALL) continue;
        const wall = (xx, yy) => xx < 0 || yy < 0 || xx >= f.w || yy >= f.h || f.tiles[yy * f.w + xx] === TILE_WALL;
        if (wall(x - 1, y)) ctx.fillRect(x * SCALE, y * SCALE, 1, SCALE);
        if (wall(x + 1, y)) ctx.fillRect((x + 1) * SCALE - 1, y * SCALE, 1, SCALE);
        if (wall(x, y - 1)) ctx.fillRect(x * SCALE, y * SCALE, SCALE, 1);
        if (wall(x, y + 1)) ctx.fillRect(x * SCALE, (y + 1) * SCALE - 1, SCALE, 1);
      }
    }
    this.bases.set(floor, c);
    return c;
  }

  /**
   * @param s { floor (yours), players: Map id -> {x, z, f, yaw}, roster, selfId,
   *            hearts (Tome entries, or null), propState, destroyed: Set, arenas: [{heartPropId, floor, tiles, roomId}] }
   */
  draw(s) {
    if (!this.visible) return;
    const floor = this.viewFloor ?? s.floor;
    this.shown = floor;
    const ctx = this.ctx;
    const mapW = GRID * SCALE;
    ctx.fillStyle = '#050407';
    ctx.fillRect(0, 0, W, H);

    // Floor tabs
    const tw = mapW / FLOOR_ORDER.length;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    FLOOR_ORDER.forEach((fl, i) => {
      const on = fl === floor;
      ctx.fillStyle = on ? '#4a3418' : '#17110b';
      ctx.fillRect(i * tw + 2, 2, tw - 4, TABS - 4);
      ctx.fillStyle = on ? '#f6d26a' : '#8a7f70';
      ctx.font = `${on ? 'bold ' : ''}14px Cinzel, Georgia, serif`;
      ctx.fillText(FLOOR_LABELS[fl] + (fl === s.floor ? '  ◆' : ''), i * tw + tw / 2, TABS / 2 + 1);
    });

    ctx.drawImage(this.base(floor), 0, TABS);
    const k = SCALE / TILE;
    const lockdowns = new Set(s.arenas.map((a) => a.heartPropId));
    const statuses = (s.hearts ?? []).map((h) => heartStatus(h, s.propState, s.destroyed, lockdowns));
    const byRoom = new Map(statuses.map((h) => [h.roomId, h]));
    const pulse = 0.5 + Math.sin(performance.now() / 260) * 0.5;

    // Heart rooms: tinted in their Sin's colour; lockdowns throb red.
    for (const r of this.map.rooms) {
      if (r.floor !== floor) continue;
      const h = byRoom.get(r.id);
      if (!h) continue;
      ctx.globalAlpha = h.state === 'slain' ? 0.08 : h.state === 'lockdown' ? 0.22 + pulse * 0.25 : 0.2;
      ctx.fillStyle = h.state === 'lockdown' ? '#ff1020' : h.color;
      ctx.fillRect(r.x * SCALE, TABS + r.y * SCALE, r.w * SCALE, r.h * SCALE);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = h.state === 'lockdown' ? '#ff3030' : h.color;
      ctx.lineWidth = h.state === 'lockdown' ? 3 : 1.5;
      ctx.strokeRect(r.x * SCALE + 1, TABS + r.y * SCALE + 1, r.w * SCALE - 2, r.h * SCALE - 2);
    }
    // Lockdown barriers: the sealed doorways.
    for (const a of s.arenas) {
      if (a.floor !== floor) continue;
      ctx.fillStyle = `rgba(255,${40 + pulse * 60},40,0.95)`;
      for (const [tx, ty] of a.tiles) ctx.fillRect(tx * SCALE, TABS + ty * SCALE, SCALE, SCALE);
    }
    // Room names (and each Heart room's Sin + progress).
    ctx.textAlign = 'center';
    for (const r of this.map.rooms) {
      if (r.floor !== floor) continue;
      const h = byRoom.get(r.id);
      const x = (r.x + r.w / 2) * SCALE, y = TABS + (r.y + r.h / 2) * SCALE;
      ctx.font = '11px Georgia, serif';
      ctx.fillStyle = h ? '#f1e6cf' : '#9a8d78';
      ctx.fillText(r.name, x, y - (h ? 8 : 0));
      if (h) {
        ctx.font = 'bold 11px Cinzel, Georgia, serif';
        ctx.fillStyle = h.state === 'lockdown' ? '#ff5050' : h.color;
        ctx.fillText(`♥ ${h.sinName.toUpperCase()} · ${h.state === 'sealed' ? `${h.done}/${h.of}` : STATE_TEXT[h.state]}`, x, y + 7);
      }
    }
    // Props: stairs, the Tome, the altar, the cage; Hearts and their task objects.
    const taskOf = new Map();
    for (const h of statuses) {
      for (const id of h.tasks) taskOf.set(id, h);
      if (h.sink !== null) taskOf.set(h.sink, h);
    }
    for (const p of this.map.props) {
      if (p.floor !== floor || !p.interact) continue;
      const x = p.x * k, y = TABS + p.z * k;
      const h = taskOf.get(p.id);
      if (h) {
        const done = h.state !== 'sealed' || s.propState[p.id]?.done;
        ctx.fillStyle = done ? '#4a4038' : h.color;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-3.5, -3.5, 7, 7);
        ctx.restore();
        continue;
      }
      const heart = statuses.find((st) => st.propId === p.id);
      if (heart) {
        ctx.font = '16px Georgia, serif';
        ctx.fillStyle = heart.state === 'slain' ? '#3a3030' : heart.state === 'sealed' ? heart.color : '#ff2a2a';
        ctx.fillText(heart.state === 'slain' ? '✝' : '♥', x, y + 1);
        continue;
      }
      let color = null;
      if (p.kind === 'tome') color = '#ffd84a';
      else if (p.kind === 'altar') color = '#b04aff';
      else if (p.interact === 'stairs') color = '#4ad8ff';
      else if (p.kind === 'gate') color = '#ff8a2a';
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
    // The coven.
    for (const [id, p] of s.players) {
      if (p.f !== floor) continue;
      const self = id === s.selfId;
      const w = WIZARD_BY_ID[s.roster.find((m) => m.id === id)?.wizardId];
      const x = p.x * k, y = TABS + p.z * k;
      ctx.fillStyle = w?.color ?? '#fff';
      ctx.beginPath();
      ctx.arc(x, y, self ? 6 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = self ? '#ffd76a' : '#fff';
      ctx.lineWidth = self ? 2.5 : 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - Math.sin(p.yaw) * 13, y - Math.cos(p.yaw) * 13);
      ctx.stroke();
      ctx.font = '11px Georgia, serif';
      ctx.fillStyle = p.cap ? '#ff6060' : '#e8dcc4';
      const name = s.roster.find((m) => m.id === id)?.name ?? '';
      ctx.fillText(self ? 'YOU' : name, x, y - 11);
    }

    this.drawPanel(statuses, s, mapW);
    ctx.textAlign = 'left';
    ctx.font = '12px Georgia, serif';
    ctx.fillStyle = '#8a7f70';
    ctx.fillText(`M / Tab: close · click a tab to view another floor${this.onPick ? ' · DEBUG: click the plan to teleport' : ''}`, 10, H - FOOT / 2);
  }

  drawPanel(statuses, s, x0) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0d0a0e';
    ctx.fillRect(x0, 0, PANEL, H);
    ctx.fillStyle = '#3a2c1c';
    ctx.fillRect(x0, 0, 1, H);
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px Cinzel, Georgia, serif';
    ctx.fillStyle = '#f6d26a';
    ctx.fillText('THE SEVEN HEARTS', x0 + 16, 22);
    if (!statuses.length) {
      ctx.font = 'italic 13px Georgia, serif';
      ctx.fillStyle = '#9a8d78';
      wrap(ctx, 'Seven hearts beat somewhere in this house. Read the Forbidden Tome to learn which Sin keeps which room.', x0 + 16, 50, PANEL - 32, 18);
      return;
    }
    let y = 48;
    for (const h of statuses) {
      ctx.font = 'bold 13px Cinzel, Georgia, serif';
      ctx.fillStyle = h.state === 'slain' ? '#5a5048' : h.color;
      ctx.fillText(`${h.state === 'slain' ? '✝' : '♥'} ${h.sinName.toUpperCase()}`, x0 + 16, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = h.state === 'lockdown' ? '#ff4040' : h.state === 'unsealed' ? '#ff9a60' : h.state === 'slain' ? '#5a5048' : '#d8ccb4';
      ctx.fillText(h.state === 'sealed' ? `${h.done} / ${h.of}` : STATE_TEXT[h.state], x0 + PANEL - 16, y);
      ctx.textAlign = 'left';
      ctx.font = '12px Georgia, serif';
      ctx.fillStyle = '#a89c86';
      ctx.fillText(`${h.roomName} · ${FLOOR_LABELS[h.floor].split(' · ')[0]}`, x0 + 16, y + 16);
      // Progress pips.
      for (let i = 0; i < h.of; i++) {
        ctx.fillStyle = i < h.done || h.state !== 'sealed' ? (h.state === 'slain' ? '#4a4038' : h.color) : '#2a2420';
        ctx.fillRect(x0 + 16 + i * 22, y + 23, 18, 4);
      }
      y += 66;
    }
  }
}

function wrap(ctx, text, x, y, w, lh) {
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > w && line) {
      ctx.fillText(line, x, y);
      y += lh;
      line = word;
    } else line = t;
  }
  if (line) ctx.fillText(line, x, y);
}
