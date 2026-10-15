#!/usr/bin/env node
// Headless browser verification (Steps 3 + 4).
//
// Boots the game server on a random port and drives the locally installed
// Chrome (headless, real GPU) through a solo debug game:
//   Spells   hot-swap through all seven wizards, cast each at the Training
//            Husk, check the server-confirmed hit + status, bots casting.
//   Horror   a haunting that vanishes when lit, the Amalgam up close, the
//            capture jumpscare, the Cell, a ping for help, the bots' rescue,
//            and a real hunt (FPS measured with post-processing on).
//   Always   zero console errors / failed requests, audio engine running.
// Screenshots land in ./verify-output/ (git-ignored).
//
// Usage: npm run verify:browser    (CHROME_PATH=/path/to/chrome to override)

import puppeteer from 'puppeteer-core';
import { mkdir, rm } from 'node:fs/promises';
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
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const { httpServer, io } = createGameServer();
  await new Promise((r) => httpServer.listen(0, r));
  const url = `http://localhost:${httpServer.address().port}/?debug=1`;

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // Vsync and the frame-rate cap are disabled so FPS figures show real headroom.
    args: ['--window-size=1280,720', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal',
      '--disable-gpu-vsync', '--disable-frame-rate-limit', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1280, height: 720 },
  });
  const failures = [];
  const errors = [];
  const check = (cond, msg) => { if (!cond) failures.push(msg); return !!cond; };
  let page;

  const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
  /** Poll the page's event log for the first unconsumed event of `type`. */
  const waitEvent = async (type, timeout = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = await page.evaluate((t) => {
        const e = window.__events.find((ev) => ev.type === t && !ev.__seen);
        if (e) e.__seen = true;
        return e ?? null;
      }, type);
      if (found) return found;
      await sleep(100);
    }
    return null;
  };
  const measureFps = () => page.evaluate(() => new Promise((resolve) => {
    const times = [];
    const tick = (t) => {
      times.push(t);
      if (times.length < 90) requestAnimationFrame(tick);
      else {
        const dts = times.slice(1).map((v, k) => v - times[k]);
        resolve(1000 / (dts.reduce((a, b) => a + b, 0) / dts.length));
      }
    };
    requestAnimationFrame(tick);
  }));
  const faceAmalgam = () => page.evaluate(() => {
    const g = window.__game;
    const m = g.monsters.get('amalgam');
    if (m) g.controller.yaw = Math.atan2(-(m.x - g.controller.x), -(m.z - g.controller.z));
    g.controller.pitch = 0.1;
  });
  /** Press P until the server reports the wanted debug monster mode. */
  const setMode = async (mode) => {
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('KeyP');
      const ev = await waitEvent('debug:mode', 3000);
      if (ev?.mode === mode) return true;
    }
    return false;
  };

  try {
    page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()} ${m.location()?.url ?? ''}`); });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

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
    await page.mouse.click(640, 360); // a real user gesture: unlocks the AudioContext
    await page.evaluate(() => {
      document.getElementById('pause').classList.add('hidden');
      window.__events = [];
      window.__game.net.on('game:event', (e) => window.__events.push(e));
      window.__game.audio.unlock();
    });

    // Open floor near the spawn, so bots keep up.
    const arena = await page.evaluate(async () => {
      const { isPassable } = await import('/shared/pathfinding.js');
      const { overlapsSolid } = await import('/shared/collision.js');
      const { tileCenter, yawFromDir } = await import('/shared/constants.js');
      const g = window.__game;
      const f = g.map.floors[0];
      const ok = (x, y) => isPassable(f, x, y) && !overlapsSolid(g.world, 0, tileCenter(x), tileCenter(y), 0.95);
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
    // A second open spot far from the spawn (and the bots), for an uninterrupted hunt.
    const farArena = await page.evaluate(async () => {
      const { isPassable } = await import('/shared/pathfinding.js');
      const { overlapsSolid } = await import('/shared/collision.js');
      const { tileCenter, yawFromDir } = await import('/shared/constants.js');
      const g = window.__game;
      const f = g.map.floors[0];
      const ok = (x, y) => isPassable(f, x, y) && !overlapsSolid(g.world, 0, tileCenter(x), tileCenter(y), 0.95);
      const sp = g.map.spawn.points[0];
      let best = null;
      for (let y = 2; y < f.h - 2; y++) {
        for (let x = 2; x < f.w - 6; x++) {
          let good = true;
          for (let k = 0; k < 4 && good; k++) good = ok(x + k, y) && ok(x + k, y - 1) && ok(x + k, y + 1);
          const d = Math.hypot(tileCenter(x) - sp.x, tileCenter(y) - sp.z);
          if (good && (!best || d > best.d)) best = { d, x: tileCenter(x), z: tileCenter(y), yaw: yawFromDir(1, 0) };
        }
      }
      return best;
    });
    const standAndFace = async () => {
      await page.evaluate((a) => {
        const g = window.__game;
        g.debugTeleport(a.x, a.z, 0, a.yaw);
        g.controller.yaw = a.yaw;
        g.controller.pitch = -0.05;
      }, arena);
      await sleep(400);
    };
    const hasHusk = () => page.evaluate(() => window.__game.monsters.has('husk'));
    const toggleHusk = () => page.evaluate(() => window.__game.net.emit('debug:husk'));

    // ------------------------------------------------------------------ spells
    console.log('\n— Spells —');
    const fpsSamples = [];
    for (let i = 0; i < 7; i++) {
      const wizardId = Object.keys(EXPECT)[i];
      const exp = EXPECT[wizardId];
      await page.keyboard.press(`Digit${i + 1}`);
      await page.waitForFunction((id) => window.__game.wizard.id === id, { timeout: 5000 }, wizardId);
      await standAndFace();
      if (await hasHusk()) {
        await toggleHusk();
        await page.waitForFunction(() => !window.__game.monsters.has('husk'), { timeout: 5000 });
      }
      await toggleHusk();
      await page.waitForFunction(() => window.__game.monsters.has('husk'), { timeout: 5000 });
      await sleep(250);
      await page.evaluate(() => {
        const g = window.__game;
        const m = g.monsters.get('husk');
        g.controller.yaw = Math.atan2(-(m.x - g.controller.x), -(m.z - g.controller.z));
        window.__events.length = 0;
      });
      await sleep(120);
      await page.keyboard.press('KeyQ');
      await sleep(exp.ability === 'ignis_blast' ? 180 : 260);

      const r = await page.evaluate(() => {
        const g = window.__game;
        const self = g.selfId;
        const myCast = window.__events.find((e) => e.type === 'cast' && e.caster === self);
        const impact = window.__events.find((e) => e.type === 'impact' && e.id === myCast?.id);
        const m = g.monsters.get('husk')?.snap;
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
          self,
        };
      });
      await shot(`spell-${i + 1}-${exp.ability}`);
      const fps = await measureFps();
      fpsSamples.push(fps);

      const tag = `${wizardId}/${exp.ability}`;
      check(r.ability === exp.ability, `${tag}: server did not broadcast our cast (got ${r.ability})`);
      check(r.cooldownText !== '', `${tag}: cooldown dial is not counting down`);
      if (exp.ability === 'aegis_void') {
        check(r.shielded?.includes(r.self), `${tag}: caster not shielded`);
        check(r.selfShielded, `${tag}: shield flag missing from snapshot`);
      } else {
        check(r.hit === 'husk', `${tag}: spell did not hit the husk (hit=${r.hit})`);
      }
      if (exp.ability === 'terra_spike') check(r.wall > 0 && r.barriersInFx > 0, `${tag}: no barricade raised`);
      for (const st of exp.status) check(r.huskStatus.includes(st), `${tag}: husk missing status "${st}" (has ${r.huskStatus.join(',') || 'none'})`);
      console.log(`${i + 1}. ${r.spellName.padEnd(18)} hit=${String(r.hit ?? (r.shielded && 'shield')).padEnd(7)} status=[${r.huskStatus.join(', ')}] hp=${r.huskHp} fps≈${Math.round(fps)}`);
      await sleep(400);
    }

    // Bots fight the husk.
    await page.evaluate(() => { window.__events.length = 0; });
    let botCasts = [];
    for (let s = 0; s < 45; s++) {
      await sleep(1000);
      botCasts = await page.evaluate(() => {
        const bots = new Set(window.__game.roster.filter((m) => m.isBot).map((m) => m.id));
        return window.__events.filter((e) => e.type === 'cast' && bots.has(e.caster)).map((e) => e.ability);
      });
      if (new Set(botCasts).size >= 2) break;
    }
    console.log(`Bot casts: ${botCasts.join(', ') || 'none'}`);
    check(botCasts.length > 0, 'bots never cast at the husk');
    await toggleHusk();

    // ------------------------------------------------------------------ horror
    console.log('\n— The Malphas Amalgam —');
    await standAndFace();
    await page.evaluate(() => { window.__events.length = 0; });

    // 1. Haunting (before the Tome): in view at a distance, vanishes when lit.
    await page.keyboard.press('KeyF'); // wand dark, so looking at it doesn't light it
    check(await setMode('haunt'), 'debug P never reached haunt mode');
    const haunted = await page.waitForFunction(() => window.__game.monsters.get('amalgam')?.snap.state === 'haunt', { timeout: 4000 }).catch(() => null);
    if (check(haunted, 'no haunting appeared')) {
      await faceAmalgam();
      await sleep(250);
      await shot('horror-1-haunting-in-the-dark');
      await page.keyboard.press('KeyF'); // light it up
      await sleep(80);
      await shot('horror-1b-lit-glimpse');
      const vanish = await waitEvent('monster:vanish', 3000);
      check(vanish?.lit === true, `haunting did not vanish when lit (${JSON.stringify(vanish)})`);
      console.log(`haunting: appeared at a corner, vanished when lit=${vanish?.lit}`);
    }

    // 2. Capture test: it appears right in front of you and lunges.
    await standAndFace();
    check(await setMode('capture'), 'debug P never reached capture mode');
    await sleep(100);
    await shot('horror-2-amalgam-windup');
    const self = await page.evaluate(() => window.__game.selfId);
    const cap = await waitEvent('capture', 5000);
    check(cap?.id === self, 'capture-test lunge did not take you');
    await sleep(350);
    await shot('horror-3-jumpscare');
    await page.waitForFunction(() => window.__game.captured, { timeout: 5000 }).catch(() => {});
    await sleep(900);
    const cell = await page.evaluate(() => {
      const g = window.__game;
      const gate = g.map.props[g.map.ids.gate];
      g.controller.yaw = Math.atan2(-(gate.x - g.controller.x), -(gate.z - g.controller.z));
      g.controller.pitch = 0;
      return { captured: g.captured, floor: g.controller.floor, held: !!g.positions.get(g.selfId)?.cap };
    });
    check(cell.captured && cell.floor === 1 && cell.held, `not held in the Cell after capture (${JSON.stringify(cell)})`);
    await sleep(300);
    await shot('horror-4-held-in-the-cell');

    // 3. Call for help; the bots come down and break the lock.
    await page.keyboard.press('KeyG');
    const ping = await waitEvent('ping', 3000);
    check(ping?.captured === true, 'ping from the Cell not broadcast');
    console.log('held in the Cell, pinged for help; waiting for a bot to break the lock…');
    let freed = null, over = false;
    for (let s = 0; s < 120 && !freed && !over; s++) {
      await sleep(1000);
      freed = await page.evaluate(() => window.__events.find((e) => e.type === 'freed') ?? null);
      over = await page.evaluate(() => window.__events.some((e) => e.type === 'gameover'));
    }
    if (over) {
      await shot('horror-5-game-over');
      console.log('everyone was taken → game over screen → Retry');
      await page.click('#btn-retry');
      check(await waitEvent('restart', 5000), 'Retry did not restart the phase');
    } else {
      check(freed, 'no bot broke the lock within 120s');
      console.log(`freed by ${freed?.by}`);
      await sleep(600);
      await shot('horror-5-rescued');
    }

    // 4. A real hunt: FPS with the full horror pipeline (flicker, grain, vignette, chroma, audio).
    //    Far from the bots, so their spells don't drive it off before it arrives.
    await page.evaluate((a) => {
      const g = window.__game;
      g.debugTeleport(a.x, a.z, 0, a.yaw);
      g.controller.yaw = a.yaw;
    }, farArena);
    await sleep(500);
    check(await setMode('hunt'), 'debug P never reached hunt mode');
    const near = await page.waitForFunction(() => {
      const g = window.__game;
      const m = g.monsters.get('amalgam');
      return m && !m.snap.hid && m.snap.f === g.controller.floor && Math.hypot(m.x - g.controller.x, m.z - g.controller.z) < 9;
    }, { timeout: 20000 }).catch(() => null);
    if (near) {
      await faceAmalgam();
      await sleep(150);
      await shot('horror-6-hunted');
      const huntFps = await measureFps();
      fpsSamples.push(huntFps);
      console.log(`hunted: the Amalgam closing in, fps≈${Math.round(huntFps)}`);
    } else {
      console.log('hunt: the Amalgam did not close within 20s (bots may have driven it off)');
    }

    const audio = await page.evaluate(() => ({ state: window.__game.audio.ctx?.state, played: window.__game.audio.played }));
    console.log(`audio: context ${audio.state}, ${audio.played} sounds synthesised`);
    check(audio.state === 'running' && audio.played > 20, `audio engine not running (${JSON.stringify(audio)})`);

    const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
    const minFps = Math.min(...fpsSamples);
    console.log(`\nFPS: avg ${avgFps.toFixed(0)}, worst sample ${minFps.toFixed(0)}`);
    check(minFps >= 60, `frame rate dipped below 60 (worst ${minFps.toFixed(0)} fps)`);
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
  console.log(`\n✓ Verified in headless Chrome. Screenshots: ${path.relative(process.cwd(), outDir)}/`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
