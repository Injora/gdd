#!/usr/bin/env node
// Headless browser verification for Step 3.
//
// Boots the game server on a random port, drives the locally installed Chrome
// (headless) through a solo debug game, hot-swaps through all seven wizards,
// casts each spell at the Training Husk, and checks:
//   - the server confirms a hit (or the shield) for every spell
//   - the husk shows the expected status
//   - bot teammates cast their own spells
//   - no console errors / page exceptions
//   - frame rate while effects are on screen
// Screenshots land in ./verify-output/ (git-ignored).
//
// Usage: npm run verify:browser    (CHROME_PATH=/path/to/chrome to override)

import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'verify-output');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXPECT = {
  injorath: { ability: 'psychic_torment', status: ['torment', 'reveal'] },
  parthius: { ability: 'ignis_blast', status: ['burn'] },
  himandriel: { ability: 'tidal_surge', status: ['slow'] },
  sushantus: { ability: 'terra_spike', status: [] },
  kartavian: { ability: 'gale_force', status: ['knock'] },
  soham: { ability: 'sacred_bind', status: ['stun'] },
  himanshu: { ability: 'aegis_void', status: [] },
};

async function main() {
  await mkdir(outDir, { recursive: true });
  const { httpServer, io, lobbies } = createGameServer();
  await new Promise((r) => httpServer.listen(0, r));
  const url = `http://localhost:${httpServer.address().port}/?debug=1`;

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // Vsync and the frame-rate cap are disabled so the FPS figures show real headroom.
    args: ['--window-size=1280,720', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal',
      '--disable-gpu-vsync', '--disable-frame-rate-limit', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1280, height: 720 },
  });
  const failures = [];
  const errors = [];
  const results = [];
  try {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()} ${m.location()?.url ?? ''}`); });
    page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(url, { waitUntil: 'networkidle0' });
    const gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    console.log(`GPU renderer: ${gpu}`);

    await page.click('#btn-solo');
    await page.waitForSelector('.wizard-card');
    await page.click('.wizard-card');
    await sleep(300);
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__game?.positions?.size > 0, { timeout: 15000 });
    await page.evaluate(() => {
      document.getElementById('pause').classList.add('hidden');
      window.__events = [];
      window.__game.net.on('game:event', (e) => window.__events.push(e));
    });

    // Find an open stretch of floor and stand at its west end, facing east.
    const arena = await page.evaluate(async () => {
      const { isPassable } = await import('/shared/pathfinding.js');
      const { overlapsSolid } = await import('/shared/collision.js');
      const { tileCenter, yawFromDir } = await import('/shared/constants.js');
      const g = window.__game;
      const f = g.map.floors[0];
      const ok = (x, y) => isPassable(f, x, y) && !overlapsSolid(g.world, 0, tileCenter(x), tileCenter(y), 0.95);
      // The open stretch nearest the spawn, so bot teammates can keep up.
      const sp = g.map.spawn.points[0];
      let best = null;
      for (let y = 2; y < f.h - 2; y++) {
        for (let x = 2; x < f.w - 10; x++) {
          let good = true;
          for (let k = 0; k < 8 && good; k++) good = ok(x + k, y) && ok(x + k, y - 1) && ok(x + k, y + 1);
          const d = Math.hypot(tileCenter(x) - sp.x, tileCenter(y) - sp.z);
          if (good && (!best || d < best.d)) best = { d, x: tileCenter(x), z: tileCenter(y), yaw: yawFromDir(1, 0) };
        }
      }
      return best;
    });
    if (!arena) throw new Error('no open arena found');

    const standAndFace = async () => {
      await page.evaluate((a) => {
        const g = window.__game;
        g.debugTeleport(a.x, a.z, 0, a.yaw);
        g.controller.yaw = a.yaw;
        g.controller.pitch = -0.05;
      }, arena);
      await sleep(400);
    };

    const fpsSamples = [];
    for (let i = 0; i < 7; i++) {
      const wizardId = Object.keys(EXPECT)[i];
      const exp = EXPECT[wizardId];
      await page.keyboard.press(`Digit${i + 1}`);
      await page.waitForFunction((id) => window.__game.wizard.id === id, { timeout: 5000 }, wizardId);

      await standAndFace();
      // Fresh husk 4 units ahead for every spell.
      if (await page.evaluate(() => window.__game.monsters.size > 0)) {
        await page.keyboard.press('KeyP');
        await page.waitForFunction(() => window.__game.monsters.size === 0, { timeout: 5000 });
      }
      await page.keyboard.press('KeyP');
      await page.waitForFunction(() => window.__game.monsters.size === 1, { timeout: 5000 });
      await sleep(250);

      // Aim straight at it, then cast with Q (left click needs pointer lock).
      await page.evaluate(() => {
        const g = window.__game;
        const m = [...g.monsters.values()][0];
        g.controller.yaw = Math.atan2(-(m.x - g.controller.x), -(m.z - g.controller.z));
        window.__events.length = 0;
      });
      await sleep(120); // let the new yaw reach the server
      await page.keyboard.press('KeyQ');
      await sleep(exp.ability === 'ignis_blast' ? 180 : 260);
      const r = await page.evaluate((ability) => {
        const g = window.__game;
        const self = g.selfId;
        const myCast = window.__events.find((e) => e.type === 'cast' && e.caster === self);
        const impact = window.__events.find((e) => e.type === 'impact' && e.id === myCast?.id);
        const m = [...g.monsters.values()][0]?.snap;
        return {
          ability: myCast?.ability,
          hit: myCast?.hit ?? impact?.hit ?? null,
          wall: myCast?.wall?.tiles?.length ?? 0,
          shielded: myCast?.shielded ?? null,
          selfShielded: !!g.positions.get(self)?.sh,
          huskStatus: m?.st ?? [],
          huskHp: m?.hp,
          cooldownText: document.querySelector('#hud-spell .dial-time').textContent,
          spellName: document.querySelector('#hud-spell .spell-name').textContent,
          barriersInFx: g.fx.barriers.size,
        };
      }, exp.ability);
      await page.screenshot({ path: path.join(outDir, `spell-${i + 1}-${exp.ability}.png`) });

      // Sample FPS while the effect plays.
      const fps = await page.evaluate(() => new Promise((resolve) => {
        const times = [];
        const tick = (t) => {
          times.push(t);
          if (times.length < 90) requestAnimationFrame(tick);
          else {
            const dts = times.slice(1).map((v, k) => v - times[k]);
            dts.sort((a, b) => a - b);
            const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
            resolve({ avg: 1000 / avg, p95: 1000 / dts[Math.floor(dts.length * 0.95)] });
          }
        };
        requestAnimationFrame(tick);
      }));
      fpsSamples.push(fps);

      results.push({ wizardId, ...r, fps: Math.round(fps.avg) });

      const check = (cond, msg) => { if (!cond) failures.push(`${wizardId}/${exp.ability}: ${msg}`); };
      check(r.ability === exp.ability, `server did not broadcast our cast (got ${r.ability})`);
      check(r.cooldownText !== '', 'cooldown dial is not counting down');
      if (exp.ability === 'aegis_void') {
        check(r.shielded?.includes(await page.evaluate(() => window.__game.selfId)), 'caster not shielded');
        check(r.selfShielded, 'shield flag missing from snapshot');
      } else {
        check(r.hit === 'husk', `spell did not hit the husk (hit=${r.hit})`);
      }
      if (exp.ability === 'terra_spike') check(r.wall > 0 && r.barriersInFx > 0, 'no barricade raised');
      for (const st of exp.status) check(r.huskStatus.includes(st), `husk missing status "${st}" (has ${r.huskStatus.join(',') || 'none'})`);
      console.log(`${i + 1}. ${r.spellName.padEnd(18)} hit=${String(r.hit ?? r.shielded).padEnd(10)} status=[${r.huskStatus.join(', ')}] hp=${r.huskHp} fps≈${Math.round(fps.avg)}`);
      await sleep(400);
    }

    // Let the bots catch up and fight the husk (up to 45s; they walk the real mansion).
    await page.evaluate(() => { window.__events.length = 0; });
    const botCastsNow = () => page.evaluate(() => {
      const bots = new Set(window.__game.roster.filter((m) => m.isBot).map((m) => m.id));
      return window.__events.filter((e) => e.type === 'cast' && bots.has(e.caster)).map((e) => e.ability);
    });
    const waitStart = Date.now();
    let botCasts = [];
    while (Date.now() - waitStart < 45000) {
      await sleep(1000);
      botCasts = await botCastsNow();
      if (new Set(botCasts).size >= 2) break;
    }
    console.log(`Bot casts after ${((Date.now() - waitStart) / 1000).toFixed(0)}s: ${botCasts.join(', ') || 'none'}`);
    if (!botCasts.length) {
      const game = [...lobbies.lobbies.values()][0]?.game;
      const m = game?.husk;
      const detail = [...(game?.players.values() ?? [])].filter((p) => p.isBot).map((p) =>
        `${p.wizardId} floor=${p.floor} dist=${m ? Math.hypot(p.x - m.x, p.z - m.z).toFixed(1) : '-'}`).join('; ');
      failures.push(`bots never cast at the husk (${detail}; husk floor=${m?.floor} dead=${m?.dead})`);
    }
    await page.screenshot({ path: path.join(outDir, 'bots-vs-husk.png') });

    const avgFps = fpsSamples.reduce((a, s) => a + s.avg, 0) / fpsSamples.length;
    const minFps = Math.min(...fpsSamples.map((s) => s.avg));
    console.log(`FPS during spell effects: avg ${avgFps.toFixed(0)}, worst sample ${minFps.toFixed(0)}`);
    if (minFps < 60) failures.push(`frame rate dipped below 60 (worst ${minFps.toFixed(0)} fps)`);
    if (errors.length) failures.push(...errors.map((e) => `console: ${e}`));
  } finally {
    await browser.close();
    io.close();
    httpServer.close();
  }

  if (failures.length) {
    console.error(`\n✗ ${failures.length} problem(s):\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(`\n✓ All 7 spells verified in headless Chrome. Screenshots: ${path.relative(process.cwd(), outDir)}/`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
