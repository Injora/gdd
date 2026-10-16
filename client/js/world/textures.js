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

// ---------------------------------------------------------------------------
// Step 6: PBR-style surfaces. Each painter draws an albedo canvas plus a
// grayscale height canvas; normal maps come from the height (Sobel), and
// roughness maps from a second grayscale canvas where the surface needs it.

/** Normal map (tangent space, linear) from a grayscale height canvas. */
export function heightToNormal(hc, strength = 2) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, ctx] = makeCanvas(w, h);
  const out = ctx.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      out.data[i] = (nx * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return toTexture(c, { srgb: false });
}

const gray = (v) => `rgb(${v},${v},${v})`;

/** Two canvases painted in lockstep: albedo + height (and optional roughness). */
function layered(w, h) {
  const [c, ctx] = makeCanvas(w, h);
  const [hc, hctx] = makeCanvas(w, h);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, w, h);
  const [rc, rctx] = makeCanvas(w, h);
  return { c, ctx, hc, hctx, rc, rctx };
}

function marbleVeins(ctx, rng, x, y, w, h, color, n) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  for (let i = 0; i < n; i++) {
    let px = x + rng.float(0, w), py = y + rng.float(0, h);
    ctx.lineWidth = rng.float(0.6, 2.4);
    ctx.beginPath();
    ctx.moveTo(px, py);
    const ang = rng.float(0, Math.PI * 2);
    for (let s = 0; s < 14; s++) {
      px += Math.cos(ang + rng.float(-0.9, 0.9)) * rng.float(5, 14);
      py += Math.sin(ang + rng.float(-0.9, 0.9)) * rng.float(5, 14);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Polished black-and-white checkered marble (the Foyer, the gallery, the ballroom). */
function marbleChecker(rng) {
  const S = 1024, T = S / 2; // Step 9: twice the resolution
  const L = layered(S, S);
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const dark = (i + j) % 2 === 1;
      const x = i * T, y = j * T;
      const g = L.ctx.createLinearGradient(x, y, x + T, y + T);
      if (dark) { g.addColorStop(0, '#16151a'); g.addColorStop(1, '#0b0a0e'); } else { g.addColorStop(0, '#d9d2c4'); g.addColorStop(1, '#bfb6a6'); }
      L.ctx.fillStyle = g;
      L.ctx.fillRect(x, y, T, T);
      marbleVeins(L.ctx, rng, x, y, T, T, dark ? 'rgba(160,150,140,0.25)' : 'rgba(70,60,55,0.28)', 14);
      marbleVeins(L.ctx, rng, x, y, T, T, dark ? 'rgba(220,210,200,0.12)' : 'rgba(40,30,30,0.15)', 24);
      marbleVeins(L.hctx, rng, x, y, T, T, 'rgba(110,110,110,0.5)', 10); // veins etched a hair lower
      L.rctx.fillStyle = dark ? '#3a3a3a' : '#484848'; // polished: a wet-looking sheen, not a mirror
      L.rctx.fillRect(x, y, T, T);
    }
  }
  // Grout
  L.ctx.fillStyle = '#4a4238';
  L.hctx.fillStyle = '#202020';
  for (const k of [0, T, S - 4]) {
    L.ctx.fillRect(k, 0, 5, S); L.ctx.fillRect(0, k, S, 5);
    L.hctx.fillRect(k, 0, 5, S); L.hctx.fillRect(0, k, S, 5);
  }
  L.rctx.fillStyle = '#b0b0b0';
  for (const k of [0, T, S - 4]) { L.rctx.fillRect(k, 0, 5, S); L.rctx.fillRect(0, k, S, 5); }
  stains(L.ctx, S, S, rng, 3, 'rgba(0,0,0,0.18)', 240);
  stains(L.rctx, S, S, rng, 8, 'rgba(160,160,160,0.25)', 180); // dull, scuffed patches
  grain(L.ctx, S, S, rng, 8);
  return { map: toTexture(L.c), normalMap: heightToNormal(L.hc, 2), roughnessMap: toTexture(L.rc, { srgb: false }) };
}

/** Herringbone-free parquet planks with grain, varnish wear and real seams. */
function parquet(rng) {
  const S = 512;
  const L = layered(S, S);
  const planks = 8, ph = S / planks;
  L.rctx.fillStyle = '#7a7a7a';
  L.rctx.fillRect(0, 0, S, S);
  for (let i = 0; i < planks; i++) {
    let x = rng.float(-200, 0);
    while (x < S) {
      const len = rng.float(180, 340);
      const l = rng.int(34, 58);
      const tone = rng.float(0.9, 1.1);
      L.ctx.fillStyle = `rgb(${(l + 18) * tone | 0},${(l + 2) * tone | 0},${(l - 12) * tone | 0})`;
      L.ctx.fillRect(x, i * ph, len, ph);
      L.ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      L.ctx.lineWidth = 1;
      for (let gl = 0; gl < 7; gl++) {
        const gy = i * ph + rng.float(3, ph - 3);
        L.ctx.beginPath();
        L.ctx.moveTo(x, gy);
        L.ctx.bezierCurveTo(x + len * 0.3, gy + rng.float(-4, 4), x + len * 0.7, gy + rng.float(-4, 4), x + len, gy);
        L.ctx.stroke();
      }
      L.ctx.fillStyle = 'rgba(0,0,0,0.75)';
      L.ctx.fillRect(x, i * ph, 2, ph);
      L.hctx.fillStyle = '#303030';
      L.hctx.fillRect(x, i * ph, 2, ph);
      L.rctx.fillStyle = gray(rng.int(90, 150));
      L.rctx.fillRect(x + 2, i * ph + 2, len - 4, ph - 4);
      x += len;
    }
    L.ctx.fillStyle = 'rgba(0,0,0,0.8)';
    L.ctx.fillRect(0, i * ph, S, 2);
    L.hctx.fillStyle = '#202020';
    L.hctx.fillRect(0, i * ph, S, 2);
  }
  stains(L.ctx, S, S, rng, 5, 'rgba(0,0,0,0.3)', 90);
  stains(L.rctx, S, S, rng, 5, 'rgba(230,230,230,0.35)', 80); // worn, unvarnished paths
  grain(L.ctx, S, S, rng, 14);
  return { map: toTexture(L.c), normalMap: heightToNormal(L.hc, 3), roughnessMap: toTexture(L.rc, { srgb: false }) };
}

/** Damask wallpaper above a carved-oak wainscot: one wall face (2 × 4 units). */
function panelledWall(rng, base, motif) {
  const W2 = 256, H2 = 512;
  const L = layered(W2, H2);
  L.ctx.fillStyle = base;
  L.ctx.fillRect(0, 0, W2, H2);
  L.rctx.fillStyle = '#d0d0d0';
  L.rctx.fillRect(0, 0, W2, H2);
  for (let x = 0; x < W2; x += 32) {
    L.ctx.fillStyle = 'rgba(0,0,0,0.12)';
    L.ctx.fillRect(x, 0, 3, 340);
  }
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 3; col++) {
      const x = col * 128 + (row % 2 ? 64 : 0);
      damaskMotif(L.ctx, x, 28 + row * 56, 24, motif);
      damaskMotif(L.hctx, x, 28 + row * 56, 24, 'rgba(160,160,160,0.6)'); // flocked, raised
    }
  }
  for (let i = 0; i < 5; i++) {
    const x = rng.float(0, W2), len = rng.float(60, 280);
    const g = L.ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(20,10,5,0.55)');
    g.addColorStop(1, 'rgba(20,10,5,0)');
    L.ctx.fillStyle = g;
    L.ctx.fillRect(x, 0, rng.float(6, 26), len);
  }
  stains(L.ctx, W2, 340, rng, 8, 'rgba(10,5,2,0.45)', 70);
  // Carved oak wainscot (lower third), chair rail, cornice, skirting.
  const wy = 352;
  L.ctx.fillStyle = '#22140c';
  L.ctx.fillRect(0, wy, W2, H2 - wy);
  L.rctx.fillStyle = '#8a8a8a';
  L.rctx.fillRect(0, wy, W2, H2 - wy);
  for (const px of [12, 140]) {
    // Raised field panel with a bevelled frame.
    L.ctx.fillStyle = '#3a2416';
    L.ctx.fillRect(px, wy + 26, 104, 104);
    L.ctx.fillStyle = '#2c1a10';
    L.ctx.fillRect(px + 10, wy + 36, 84, 84);
    const g = L.hctx.createLinearGradient(px, wy + 26, px + 104, wy + 130);
    g.addColorStop(0, '#d0d0d0'); g.addColorStop(1, '#a0a0a0');
    L.hctx.fillStyle = '#404040';
    L.hctx.fillRect(px - 2, wy + 24, 108, 108);
    L.hctx.fillStyle = g;
    L.hctx.fillRect(px, wy + 26, 104, 104);
    L.hctx.fillStyle = '#c8c8c8';
    L.hctx.fillRect(px + 10, wy + 36, 84, 84);
    // Carved rosette
    L.ctx.fillStyle = 'rgba(80,50,25,0.8)';
    damaskMotif(L.ctx, px + 52, wy + 78, 22, 'rgba(70,44,22,0.9)');
    damaskMotif(L.hctx, px + 52, wy + 78, 22, '#f0f0f0');
  }
  L.ctx.fillStyle = '#4a2e1a';
  L.ctx.fillRect(0, wy - 8, W2, 12); // chair rail
  L.hctx.fillStyle = '#ffffff';
  L.hctx.fillRect(0, wy - 8, W2, 12);
  L.ctx.fillStyle = '#120b07';
  L.ctx.fillRect(0, 0, W2, 14); // cornice
  L.hctx.fillStyle = '#e0e0e0';
  L.hctx.fillRect(0, 0, W2, 14);
  L.ctx.fillRect(0, H2 - 14, W2, 14); // skirting
  L.hctx.fillRect(0, H2 - 14, W2, 14);
  grain(L.ctx, W2, H2, rng, 18);
  return { map: toTexture(L.c), normalMap: heightToNormal(L.hc, 2.5), roughnessMap: toTexture(L.rc, { srgb: false }) };
}

/** Rough-hewn Gothic stone blocks with deep mortar joints (basement, chapel, arches). */
function gothicStone(rng, tint = [0, 0, 0]) {
  const W2 = 512, H2 = 1024; // Step 9: twice the resolution, deeper joints
  const L = layered(W2, H2);
  L.ctx.fillStyle = '#141210';
  L.ctx.fillRect(0, 0, W2, H2);
  L.hctx.fillStyle = '#202020';
  L.hctx.fillRect(0, 0, W2, H2);
  L.rctx.fillStyle = '#f0f0f0';
  L.rctx.fillRect(0, 0, W2, H2);
  const rowH = 92;
  for (let y = 0, row = 0; y < H2; y += rowH, row++) {
    let x = row % 2 ? -100 : 0;
    while (x < W2) {
      const w = rng.int(128, 240);
      const l = rng.int(44, 70);
      L.ctx.fillStyle = `rgb(${l + tint[0]},${l - 4 + tint[1]},${l - 10 + tint[2]})`;
      L.ctx.fillRect(x + 5, y + 5, w - 10, rowH - 10);
      const g = L.hctx.createRadialGradient(x + w / 2, y + rowH / 2, 4, x + w / 2, y + rowH / 2, w * 0.6);
      g.addColorStop(0, gray(rng.int(200, 240)));
      g.addColorStop(1, '#909090');
      L.hctx.fillStyle = g;
      L.hctx.fillRect(x + 5, y + 5, w - 10, rowH - 10);
      // Chisel marks and seeping damp (slick: lower roughness).
      for (let k = 0; k < 4; k++) {
        L.hctx.strokeStyle = 'rgba(80,80,80,0.5)';
        L.hctx.lineWidth = 2;
        const cx = x + rng.float(10, w - 10), cy = y + rng.float(10, rowH - 10);
        L.hctx.beginPath(); L.hctx.moveTo(cx, cy); L.hctx.lineTo(cx + rng.float(-14, 14), cy + rng.float(4, 12)); L.hctx.stroke();
      }
      x += w;
    }
  }
  stains(L.ctx, W2, H2, rng, 14, 'rgba(20,30,15,0.45)', 160);
  stains(L.ctx, W2, H2, rng, 8, 'rgba(0,0,0,0.5)', 120);
  stains(L.rctx, W2, H2, rng, 8, 'rgba(60,60,60,0.7)', 120); // wet streaks
  grain(L.ctx, W2, H2, rng, 30);
  grain(L.hctx, W2, H2, rng, 40);
  return { map: toTexture(L.c), normalMap: heightToNormal(L.hc, 4.5), roughnessMap: toTexture(L.rc, { srgb: false }) };
}

/** Square flagstones (basement, chapel, armory, kitchen). */
function flagstones(rng) {
  const S = 512;
  const L = layered(S, S);
  L.ctx.fillStyle = '#0f0e0d';
  L.ctx.fillRect(0, 0, S, S);
  L.hctx.fillStyle = '#202020';
  L.hctx.fillRect(0, 0, S, S);
  L.rctx.fillStyle = '#e8e8e8';
  L.rctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 128) {
    for (let x = 0; x < S; x += 128) {
      const l = rng.int(36, 58);
      L.ctx.fillStyle = `rgb(${l},${l - 2},${l - 6})`;
      L.ctx.fillRect(x + 4, y + 4, 120, 120);
      L.hctx.fillStyle = gray(rng.int(170, 220));
      L.hctx.fillRect(x + 4, y + 4, 120, 120);
    }
  }
  stains(L.ctx, S, S, rng, 10, 'rgba(0,0,0,0.5)', 90);
  stains(L.ctx, S, S, rng, 3, 'rgba(60,5,5,0.35)', 70);
  stains(L.rctx, S, S, rng, 5, 'rgba(60,60,60,0.6)', 60); // damp, slick patches
  grain(L.ctx, S, S, rng, 26);
  grain(L.hctx, S, S, rng, 50);
  return { map: toTexture(L.c), normalMap: heightToNormal(L.hc, 3), roughnessMap: toTexture(L.rc, { srgb: false }) };
}

/** Deep red velvet runner with a gold border and pile. */
function velvetCarpet(rng) {
  const S = 256;
  const L = layered(S, S);
  L.ctx.fillStyle = '#3a060c';
  L.ctx.fillRect(0, 0, S, S);
  // Pile: tiny bright/dark flecks
  const img = L.ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = rng.float(-18, 18);
    img.data[i] += n * 1.4;
    img.data[i + 1] += n * 0.3;
    img.data[i + 2] += n * 0.4;
  }
  L.ctx.putImageData(img, 0, 0);
  L.ctx.strokeStyle = 'rgba(190,140,50,0.55)';
  L.ctx.lineWidth = 4;
  for (const k of [10, 22]) L.ctx.strokeRect(k, -10, S - 2 * k, S + 20);
  L.ctx.strokeStyle = 'rgba(190,140,50,0.32)';
  L.ctx.lineWidth = 2;
  for (let y = 0; y < S; y += 64) {
    L.ctx.beginPath();
    L.ctx.moveTo(S / 2, y + 10);
    L.ctx.lineTo(S / 2 + 40, y + 32);
    L.ctx.lineTo(S / 2, y + 54);
    L.ctx.lineTo(S / 2 - 40, y + 32);
    L.ctx.closePath();
    L.ctx.stroke();
  }
  stains(L.ctx, S, S, rng, 4, 'rgba(0,0,0,0.45)', 50);
  grain(L.hctx, S, S, rng, 60);
  L.rctx.fillStyle = '#ffffff';
  L.rctx.fillRect(0, 0, S, S);
  return { map: toTexture(L.c), normalMap: heightToNormal(L.hc, 1.2), roughnessMap: toTexture(L.rc, { srgb: false }) };
}

/** Coffered plaster ceiling with dark beams. */
function cofferedCeiling(rng) {
  const S = 256;
  const L = layered(S, S);
  L.ctx.fillStyle = '#2a2420';
  L.ctx.fillRect(0, 0, S, S);
  L.ctx.fillStyle = '#3a332c';
  L.ctx.fillRect(18, 18, S - 36, S - 36);
  L.hctx.fillStyle = '#e0e0e0';
  L.hctx.fillRect(0, 0, S, S);
  L.hctx.fillStyle = '#707070';
  L.hctx.fillRect(18, 18, S - 36, S - 36);
  L.hctx.fillStyle = '#505050';
  L.hctx.fillRect(34, 34, S - 68, S - 68);
  L.ctx.fillStyle = '#332c26';
  L.ctx.fillRect(34, 34, S - 68, S - 68);
  L.ctx.fillStyle = '#1a1410';
  L.ctx.fillRect(0, 0, S, 10);
  L.ctx.fillRect(0, 0, 10, S);
  stains(L.ctx, S, S, rng, 8, 'rgba(10,8,5,0.5)', 70);
  grain(L.ctx, S, S, rng, 16);
  return { map: toTexture(L.c), normalMap: heightToNormal(L.hc, 2) };
}

// ---------------------------------------------------------------------------
// Step 9: metal and carved wood with full PBR sets (albedo, normal, roughness,
// and for metals a metalness map), so gold reads as gold under a wand light and
// the mansion's dim environment.

/** Ornate gold filigree on dark lacquer: frames, mounts, crowns, inlays. */
function goldFiligree(rng) {
  const S = 512;
  const L = layered(S, S);
  const [mc, mctx] = makeCanvas(S, S);
  L.ctx.fillStyle = '#2a1c0c';
  L.ctx.fillRect(0, 0, S, S);
  L.rctx.fillStyle = '#9a9a9a';
  L.rctx.fillRect(0, 0, S, S);
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, S, S);
  const scroll = (ctx, x, y, r, a0, color, w) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let t = 0; t < 1; t += 0.02) {
      const a = a0 + t * Math.PI * 3.2, rr = r * (1 - t * 0.85);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  };
  for (let gy = 0; gy < S; gy += 128) {
    for (let gx = 0; gx < S; gx += 128) {
      for (let k = 0; k < 4; k++) {
        const x = gx + 64 + Math.cos(k * Math.PI / 2) * 30, y = gy + 64 + Math.sin(k * Math.PI / 2) * 30;
        const a0 = k * Math.PI / 2 + rng.float(-0.2, 0.2);
        scroll(L.ctx, x, y, 30, a0, '#d8aa48', 7);
        scroll(L.hctx, x, y, 30, a0, '#f0f0f0', 7);
        scroll(L.rctx, x, y, 30, a0, '#3a3a3a', 7);
        scroll(mctx, x, y, 30, a0, '#ffffff', 8);
      }
      L.ctx.fillStyle = '#e8c060';
      L.ctx.beginPath(); L.ctx.arc(gx + 64, gy + 64, 9, 0, Math.PI * 2); L.ctx.fill();
      L.hctx.fillStyle = '#ffffff';
      L.hctx.beginPath(); L.hctx.arc(gx + 64, gy + 64, 9, 0, Math.PI * 2); L.hctx.fill();
      mctx.fillStyle = '#ffffff';
      mctx.beginPath(); mctx.arc(gx + 64, gy + 64, 10, 0, Math.PI * 2); mctx.fill();
    }
  }
  // A beaded gold border on every tile edge.
  for (let k = 0; k < S; k += 16) {
    for (const [x, y] of [[k, 4], [4, k]]) {
      L.ctx.fillStyle = '#c89a3c'; L.ctx.beginPath(); L.ctx.arc(x, y, 4, 0, Math.PI * 2); L.ctx.fill();
      L.hctx.fillStyle = '#e0e0e0'; L.hctx.beginPath(); L.hctx.arc(x, y, 4, 0, Math.PI * 2); L.hctx.fill();
      mctx.fillStyle = '#ffffff'; mctx.beginPath(); mctx.arc(x, y, 5, 0, Math.PI * 2); mctx.fill();
    }
  }
  stains(L.ctx, S, S, rng, 6, 'rgba(10,6,2,0.35)', 80); // tarnish
  stains(L.rctx, S, S, rng, 6, 'rgba(200,200,200,0.4)', 70);
  grain(L.ctx, S, S, rng, 10);
  return { map: toTexture(L.c), normalMap: heightToNormal(L.hc, 4), roughnessMap: toTexture(L.rc, { srgb: false }), metalnessMap: toTexture(mc, { srgb: false }) };
}

/** Deeply carved dark mahogany: grain, raised panels, acanthus relief. */
function carvedMahogany(rng) {
  const S = 512;
  const L = layered(S, S);
  L.ctx.fillStyle = '#2a120a';
  L.ctx.fillRect(0, 0, S, S);
  L.rctx.fillStyle = '#6a6a6a';
  L.rctx.fillRect(0, 0, S, S);
  // Grain
  for (let i = 0; i < 160; i++) {
    const y = rng.float(0, S);
    L.ctx.strokeStyle = `rgba(${rng.int(8, 30)},${rng.int(2, 10)},0,${rng.float(0.2, 0.5)})`;
    L.ctx.lineWidth = rng.float(0.5, 2);
    L.ctx.beginPath();
    L.ctx.moveTo(0, y);
    L.ctx.bezierCurveTo(S * 0.3, y + rng.float(-10, 10), S * 0.7, y + rng.float(-10, 10), S, y + rng.float(-6, 6));
    L.ctx.stroke();
    L.hctx.strokeStyle = `rgba(110,110,110,0.4)`;
    L.hctx.beginPath(); L.hctx.moveTo(0, y); L.hctx.lineTo(S, y); L.hctx.stroke();
  }
  // Raised, bevelled panels with acanthus leaves.
  for (const [px, py] of [[24, 24], [280, 24], [24, 280], [280, 280]]) {
    const g = L.hctx.createLinearGradient(px, py, px + 208, py + 208);
    g.addColorStop(0, '#d8d8d8'); g.addColorStop(1, '#9a9a9a');
    L.hctx.fillStyle = '#3a3a3a'; L.hctx.fillRect(px - 6, py - 6, 220, 220);
    L.hctx.fillStyle = g; L.hctx.fillRect(px, py, 208, 208);
    L.ctx.fillStyle = 'rgba(70,30,14,0.55)'; L.ctx.fillRect(px, py, 208, 208);
    L.rctx.fillStyle = '#4a4a4a'; L.rctx.fillRect(px, py, 208, 208); // waxed, polished faces
    for (let k = 0; k < 4; k++) {
      damaskMotif(L.ctx, px + 104, py + 104, 46 - k * 6, `rgba(${40 + k * 10},${16 + k * 4},6,0.7)`);
      damaskMotif(L.hctx, px + 104, py + 104, 46 - k * 6, `rgb(${240 - k * 20},${240 - k * 20},${240 - k * 20})`);
    }
  }
  grain(L.ctx, S, S, rng, 12);
  grain(L.hctx, S, S, rng, 18);
  return { map: toTexture(L.c), normalMap: heightToNormal(L.hc, 3.5), roughnessMap: toTexture(L.rc, { srgb: false }) };
}

/** Pointed-arch stained glass, moonlit from outside. */
export function stainedGlass(seed) {
  const rng = createRng(seed);
  const [c, ctx] = makeCanvas(128, 256);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 256);
  const palette = ['#2a4aa8', '#7a1a2a', '#1a6a4a', '#a8862a', '#4a2a8a', '#2a7aa8', '#8a2a6a'];
  // Pointed arch clip
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(8, 256);
  ctx.lineTo(8, 90);
  ctx.quadraticCurveTo(8, 20, 64, 4);
  ctx.quadraticCurveTo(120, 20, 120, 90);
  ctx.lineTo(120, 256);
  ctx.closePath();
  ctx.clip();
  for (let y = 0; y < 256; y += 22) {
    for (let x = 0; x < 128; x += 20) {
      ctx.fillStyle = rng.pick(palette);
      ctx.beginPath();
      ctx.moveTo(x + rng.float(-4, 4), y + rng.float(-4, 4));
      ctx.lineTo(x + 20 + rng.float(-4, 4), y + rng.float(-4, 4));
      ctx.lineTo(x + 20 + rng.float(-4, 4), y + 22 + rng.float(-4, 4));
      ctx.lineTo(x + rng.float(-4, 4), y + 22 + rng.float(-4, 4));
      ctx.fill();
    }
  }
  // A rose medallion
  ctx.fillStyle = '#c8a040';
  ctx.beginPath();
  ctx.arc(64, 70, 24, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = palette[i % palette.length];
    ctx.beginPath();
    ctx.arc(64 + Math.cos((i / 8) * Math.PI * 2) * 15, 70 + Math.sin((i / 8) * Math.PI * 2) * 15, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  // Lead came
  ctx.strokeStyle = '#080808';
  ctx.lineWidth = 3;
  for (let y = 0; y < 256; y += 22) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke(); }
  for (let x = 4; x < 128; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
  ctx.beginPath();
  ctx.arc(64, 70, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#151515';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(8, 256);
  ctx.lineTo(8, 90);
  ctx.quadraticCurveTo(8, 20, 64, 4);
  ctx.quadraticCurveTo(120, 20, 120, 90);
  ctx.lineTo(120, 256);
  ctx.stroke();
  return toTexture(c);
}

/** A wizard's house crest: a shield in their colour with their element's sigil. */
export function crestTexture(color, glyph) {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = '#c8a040';
  ctx.beginPath();
  ctx.moveTo(14, 12); ctx.lineTo(114, 12); ctx.lineTo(114, 60); ctx.quadraticCurveTo(110, 104, 64, 122); ctx.quadraticCurveTo(18, 104, 14, 60);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(22, 20); ctx.lineTo(106, 20); ctx.lineTo(106, 60); ctx.quadraticCurveTo(102, 98, 64, 113); ctx.quadraticCurveTo(26, 98, 22, 60);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f4e4b0';
  ctx.font = 'bold 62px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createTextures(seed) {
  const rng = createRng(seed ^ 0x5eed);
  const wall = panelledWall(rng, '#2e0f13', 'rgba(120,40,40,0.28)');
  const roseWall = panelledWall(rng, '#3a1420', 'rgba(170,60,80,0.32)');
  const greenWall = panelledWall(rng, '#13241a', 'rgba(70,120,80,0.25)');
  const stone = gothicStone(rng);
  const chapelStone = gothicStone(rng, [6, 0, -4]);
  return {
    wallpaper: wall.map,
    wall,
    roseWall,
    greenWall,
    stoneWall: stone.map,
    stone,
    chapelStone,
    woodFloor: woodFloor(rng),
    parquet: parquet(rng),
    marble: marbleChecker(rng),
    flagstones: flagstones(rng),
    velvet: velvetCarpet(rng),
    carpet: carpet(rng),
    stoneFloor: stoneFloor(rng),
    ceiling: ceiling(rng),
    coffered: cofferedCeiling(rng),
    books: bookSpines(rng),
    clockFace: clockFace(),
    rug: rugTexture(rng),
    ritualCircle: ritualCircle(),
    gold: goldFiligree(rng),
    mahogany: carvedMahogany(rng),
  };
}
