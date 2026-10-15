// Procedurally painted textures (no external image assets). Everything is
// drawn onto canvases once at load and wrapped as Three.js CanvasTextures.

import * as THREE from 'three';
import { createRng } from '/shared/rng.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Per-pixel brightness jitter. */
function grain(ctx, w, h, rng, amount) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function stains(ctx, w, h, rng, count, color, maxR) {
  for (let i = 0; i < count; i++) {
    const x = rng.float(0, w), y = rng.float(0, h), r = rng.float(maxR * 0.3, maxR);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function damaskMotif(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.bezierCurveTo(s * 0.55, -s * 0.55, s * 0.55, -s * 0.1, s * 0.18, 0);
  ctx.bezierCurveTo(s * 0.62, s * 0.2, s * 0.45, s * 0.75, 0, s);
  ctx.bezierCurveTo(-s * 0.45, s * 0.75, -s * 0.62, s * 0.2, -s * 0.18, 0);
  ctx.bezierCurveTo(-s * 0.55, -s * 0.1, -s * 0.55, -s * 0.55, 0, -s);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -s * 0.15, s * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.restore();
}

/** Damask wallpaper over a dark wood wainscot. One tile-face = 2 x 4 units. */
function wallpaper(rng, base, motif) {
  const [c, ctx] = makeCanvas(256, 512);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 512);
  for (let x = 0; x < 256; x += 32) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(x, 0, 3, 400);
  }
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 3; col++) {
      const x = col * 128 + (row % 2 ? 64 : 0);
      damaskMotif(ctx, x, 28 + row * 64, 26, motif);
    }
  }
  // Water damage running down from the cornice.
  for (let i = 0; i < 5; i++) {
    const x = rng.float(0, 256), len = rng.float(60, 300);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(20,10,5,0.55)');
    g.addColorStop(1, 'rgba(20,10,5,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, rng.float(6, 26), len);
  }
  stains(ctx, 256, 400, rng, 8, 'rgba(10,5,2,0.45)', 70);
  // Wainscot
  ctx.fillStyle = '#1e120c';
  ctx.fillRect(0, 392, 256, 120);
  ctx.fillStyle = '#2b1a11';
  ctx.fillRect(14, 412, 100, 82);
  ctx.fillRect(142, 412, 100, 82);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  ctx.strokeRect(14, 412, 100, 82);
  ctx.strokeRect(142, 412, 100, 82);
  ctx.fillStyle = '#3a2416';
  ctx.fillRect(0, 384, 256, 10); // chair rail
  ctx.fillStyle = '#100a07';
  ctx.fillRect(0, 0, 256, 10); // cornice
  ctx.fillRect(0, 500, 256, 12); // skirting
  grain(ctx, 256, 512, rng, 22);
  return toTexture(c);
}

function stoneWall(rng) {
  const [c, ctx] = makeCanvas(256, 512);
  ctx.fillStyle = '#1a1816';
  ctx.fillRect(0, 0, 256, 512);
  const rowH = 42;
  for (let y = 0, row = 0; y < 512; y += rowH, row++) {
    let x = row % 2 ? -40 : 0;
    while (x < 256) {
      const w = rng.int(60, 110);
      const l = rng.int(42, 66);
      ctx.fillStyle = `rgb(${l},${l - 4},${l - 9})`;
      ctx.fillRect(x + 3, y + 3, w - 6, rowH - 6);
      x += w;
    }
  }
  stains(ctx, 256, 512, rng, 10, 'rgba(20,30,15,0.45)', 80);
  stains(ctx, 256, 512, rng, 6, 'rgba(0,0,0,0.5)', 60);
  grain(ctx, 256, 512, rng, 30);
  return toTexture(c);
}

function woodFloor(rng) {
  const [c, ctx] = makeCanvas(256, 256);
  const planks = 6, ph = 256 / planks;
  for (let i = 0; i < planks; i++) {
    let x = rng.float(-120, 0);
    while (x < 256) {
      const len = rng.float(120, 220);
      const l = rng.int(36, 56);
      ctx.fillStyle = `rgb(${l + 14},${l},${l - 14})`;
      ctx.fillRect(x, i * ph, len, ph);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 5; g++) {
        const gy = i * ph + rng.float(3, ph - 3);
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.bezierCurveTo(x + len * 0.3, gy + rng.float(-3, 3), x + len * 0.7, gy + rng.float(-3, 3), x + len, gy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x, i * ph, 2, ph);
      x += len;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, i * ph, 256, 2);
  }
  stains(ctx, 256, 256, rng, 4, 'rgba(0,0,0,0.35)', 60);
  grain(ctx, 256, 256, rng, 16);
  return toTexture(c);
}

function carpet(rng) {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#2c070b';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(150,110,40,0.28)';
  ctx.lineWidth = 3;
  for (let y = 0; y < 256; y += 64) {
    for (let x = 0; x < 256; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x + 32, y + 8);
      ctx.lineTo(x + 56, y + 32);
      ctx.lineTo(x + 32, y + 56);
      ctx.lineTo(x + 8, y + 32);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(10,0,0,0.6)';
      ctx.fillRect(x + 29, y + 29, 6, 6);
    }
  }
  stains(ctx, 256, 256, rng, 5, 'rgba(0,0,0,0.45)', 50);
  grain(ctx, 256, 256, rng, 20);
  return toTexture(c);
}

function stoneFloor(rng) {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#0f0e0d';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 64) {
    for (let x = 0; x < 256; x += 64) {
      const l = rng.int(34, 52);
      ctx.fillStyle = `rgb(${l},${l - 2},${l - 6})`;
      ctx.fillRect(x + 3, y + 3, 58, 58);
    }
  }
  stains(ctx, 256, 256, rng, 8, 'rgba(0,0,0,0.5)', 50);
  stains(ctx, 256, 256, rng, 2, 'rgba(60,5,5,0.35)', 40);
  grain(ctx, 256, 256, rng, 28);
  return toTexture(c);
}

function ceiling(rng) {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#2a2622';
  ctx.fillRect(0, 0, 256, 256);
  stains(ctx, 256, 256, rng, 10, 'rgba(10,8,5,0.5)', 70);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    let x = rng.float(0, 256), y = rng.float(0, 256);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += rng.float(-20, 20);
      y += rng.float(-20, 20);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  grain(ctx, 256, 256, rng, 18);
  return toTexture(c);
}

function bookSpines(rng) {
  const [c, ctx] = makeCanvas(256, 64);
  ctx.fillStyle = '#080504';
  ctx.fillRect(0, 0, 256, 64);
  const hues = ['#3b0d0d', '#13240f', '#101a2b', '#2a1d0c', '#26101f', '#3a2a14', '#1a1a1a'];
  let x = 0;
  while (x < 256) {
    const w = rng.int(6, 14), h = rng.int(44, 62);
    ctx.fillStyle = rng.pick(hues);
    ctx.fillRect(x, 64 - h, w - 1, h);
    ctx.fillStyle = 'rgba(176,141,74,0.4)';
    ctx.fillRect(x + 1, 64 - h + 6, w - 3, 2);
    ctx.fillRect(x + 1, 64 - 10, w - 3, 2);
    x += w;
  }
  grain(ctx, 256, 64, rng, 18);
  return toTexture(c);
}

/** A dim oil portrait of a pale ancestor. `bleeding` adds red tears/drips. */
export function portrait(seed, bleeding) {
  const rng = createRng(seed);
  const [c, ctx] = makeCanvas(128, 160);
  const bg = ctx.createRadialGradient(64, 60, 10, 64, 80, 110);
  bg.addColorStop(0, `rgb(${rng.int(40, 60)},${rng.int(30, 45)},${rng.int(20, 30)})`);
  bg.addColorStop(1, '#070504');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 128, 160);
  // Shoulders
  ctx.fillStyle = rng.pick(['#120b0b', '#0c1014', '#1a0e14']);
  ctx.beginPath();
  ctx.ellipse(64, 168, 58, 56, 0, Math.PI, 0);
  ctx.fill();
  // Neck + face
  const skin = rng.pick(['#b8a48c', '#a8927a', '#c4b49e']);
  ctx.fillStyle = skin;
  ctx.fillRect(56, 92, 16, 22);
  ctx.beginPath();
  ctx.ellipse(64, 72, 22, 29, 0, 0, Math.PI * 2);
  ctx.fill();
  // Hair
  ctx.fillStyle = rng.pick(['#140c08', '#2a1a10', '#3a3430']);
  ctx.beginPath();
  ctx.ellipse(64, 56, 25, 20, 0, Math.PI, 0);
  ctx.fill();
  // Hollow eyes
  ctx.fillStyle = '#050303';
  const eyeY = 70 + rng.int(-2, 2);
  ctx.beginPath();
  ctx.ellipse(55, eyeY, 4.5, 3, 0, 0, Math.PI * 2);
  ctx.ellipse(73, eyeY, 4.5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,20,15,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(57, 88);
  ctx.lineTo(71, 88);
  ctx.stroke();
  if (bleeding) {
    ctx.fillStyle = '#6a0006';
    for (const ex of [55, 73]) {
      ctx.fillRect(ex - 1, eyeY + 2, 2.5, rng.int(26, 60));
    }
    for (let i = 0; i < 6; i++) {
      const x = rng.int(6, 122);
      ctx.fillRect(x, 0, rng.float(1.5, 3), rng.int(20, 90));
    }
  }
  // Varnish shadow + craquelure
  const v = ctx.createRadialGradient(64, 80, 40, 64, 80, 100);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 128, 160);
  grain(ctx, 128, 160, rng, 26);
  return toTexture(c);
}

function clockFace() {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#b9ab8c';
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a120c';
  ctx.font = 'bold 15px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const numerals = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  numerals.forEach((n, i) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    ctx.fillText(n, 64 + Math.cos(a) * 48, 64 + Math.sin(a) * 48);
  });
  ctx.strokeStyle = '#120c08';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(64, 64);
  ctx.lineTo(64 + Math.cos(-2.2) * 30, 64 + Math.sin(-2.2) * 30); // stopped at 3:33
  ctx.moveTo(64, 64);
  ctx.lineTo(64 + Math.cos(1.85) * 40, 64 + Math.sin(1.85) * 40);
  ctx.stroke();
  return toTexture(c);
}

function rugTexture(rng) {
  const [c, ctx] = makeCanvas(256, 192);
  ctx.fillStyle = '#250608';
  ctx.fillRect(0, 0, 256, 192);
  ctx.strokeStyle = '#6a4a1c';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 236, 172);
  ctx.lineWidth = 2;
  ctx.strokeRect(22, 22, 212, 148);
  ctx.fillStyle = 'rgba(106,74,28,0.45)';
  damaskMotif(ctx, 128, 96, 50, 'rgba(106,74,28,0.5)');
  for (const [x, y] of [[50, 50], [206, 50], [50, 142], [206, 142]]) damaskMotif(ctx, x, y, 16, 'rgba(106,74,28,0.4)');
  stains(ctx, 256, 192, rng, 4, 'rgba(0,0,0,0.5)', 50);
  grain(ctx, 256, 192, rng, 22);
  return toTexture(c);
}

/** Seven-pointed ritual circle on transparent background. */
function ritualCircle() {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.clearRect(0, 0, 512, 512);
  ctx.strokeStyle = 'rgba(200,20,30,0.9)';
  ctx.lineWidth = 5;
  for (const r of [236, 206, 120]) {
    ctx.beginPath();
    ctx.arc(256, 256, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i <= 7; i++) {
    const a = ((i * 3) / 7) * Math.PI * 2 - Math.PI / 2; // {7/3} heptagram
    const x = 256 + Math.cos(a) * 206, y = 256 + Math.sin(a) * 206;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(200,20,30,0.9)';
  ctx.font = '26px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈ';
  for (let i = 0; i < runes.length; i++) {
    const a = (i / runes.length) * Math.PI * 2;
    ctx.save();
    ctx.translate(256 + Math.cos(a) * 221, 256 + Math.sin(a) * 221);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(runes[i], 0, 0);
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createTextures(seed) {
  const rng = createRng(seed ^ 0x5eed);
  return {
    wallpaper: wallpaper(rng, '#2e0f13', 'rgba(120,40,40,0.28)'),
    stoneWall: stoneWall(rng),
    woodFloor: woodFloor(rng),
    carpet: carpet(rng),
    stoneFloor: stoneFloor(rng),
    ceiling: ceiling(rng),
    books: bookSpines(rng),
    clockFace: clockFace(),
    rug: rugTexture(rng),
    ritualCircle: ritualCircle(),
  };
}
