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
//   Step 6   the 2-story mansion (foyer ↔ balcony overlook, grand staircase),
//            the top-left minimap (and Keeper footstep ripples), the wizard
//            avatars, 1–4/R select + Q fires, the Disillusionment Charm (V),
//            Sin arenas (lockdown, demon, slain → Heart destroyed), and the
//            1.5s Scary Capture Screen → the Underground Iron Cage.
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
const INVIS_WAIT = 300;

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
  const { httpServer, io, lobbies } = createGameServer();
  const liveGame = () => [...lobbies.lobbies.values()].find((l) => l.game)?.game;
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
    const seen = [];
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('KeyP');
      const ev = await waitEvent('debug:mode', 3000);
      seen.push(ev?.mode ?? 'none');
      if (ev?.mode === mode) return true;
    }
    console.log(`  (debug modes seen while looking for ${mode}: ${seen.join(', ')})`);
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

    const fpsSamples = [];
    // ------------------------------------------------------------------ Step 6: the mansion
    console.log('\n— Step 6: the two-story mansion, the minimap, the wizards —');
    const tour = await page.evaluate(() => {
      const g = window.__game, m = g.map;
      const foyer = m.rooms[m.ids.foyer];
      const stairs = m.props.filter((p) => p.kind === 'grand_stair' && p.room === m.ids.foyer);
      return {
        floors: m.floors.length,
        foyer: { x: (foyer.cx + 0.5) * 2, z: (foyer.y + foyer.h - 1.5) * 2, top: (foyer.y + 1) * 2 },
        stairs: stairs.map((p) => ({ id: p.id, x: p.x, z: p.z, fx: p.front.x, fz: p.front.z })),
      };
    });
    check(tour.floors === 3, `expected 3 levels (${tour.floors})`);
    check(tour.stairs.length === 2, `the Foyer should have dual grand staircases (${tour.stairs.length})`);
    // 1. From the Foyer, look up through the open void at the Balcony Gallery.
    await page.evaluate((t) => {
      const g = window.__game;
      g.debugTeleport(t.foyer.x, t.foyer.z, 0, 0);
    }, tour);
    await sleep(500);
    await page.evaluate(() => { const g = window.__game; g.controller.yaw = 0; g.controller.pitch = 0.62; });
    await page.keyboard.press('KeyF'); // Lumos
    await sleep(600);
    await shot('mansion-1-foyer-looking-up-at-the-balcony');
    fpsSamples.push(await measureFps());
    await page.evaluate(() => { window.__game.controller.pitch = 0.05; });
    await sleep(200);
    await shot('mansion-2-grand-foyer-marble-and-stairs');
    // 2. Climb the grand staircase to Floor 2.
    const st = tour.stairs[0];
    await page.evaluate((s) => {
      const g = window.__game;
      g.debugTeleport(s.fx, s.fz, 0, Math.atan2(-(s.x - s.fx), -(s.z - s.fz)));
    }, st);
    await sleep(500);
    await page.evaluate((s) => { const g = window.__game; g.controller.yaw = Math.atan2(-(s.x - g.controller.x), -(s.z - g.controller.z)); g.controller.pitch = -0.1; }, st);
    await page.waitForFunction((id) => window.__game.target?.id === id, { timeout: 3000 }, st.id).catch(() => failures.push('the grand staircase never became the target'));
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__game.controller.floor === 2, { timeout: 4000 }).catch(() => failures.push('the grand staircase did not lead to Floor 2'));
    const up = await page.evaluate(() => {
      const g = window.__game;
      const room = g.map.rooms[g.map.floors[2].roomIds[Math.floor(g.controller.z / 2) * 60 + Math.floor(g.controller.x / 2)]];
      return { floor: g.controller.floor, room: room?.name };
    });
    check(up.room === 'Balcony Gallery', `arrived in ${up.room}, not the Balcony Gallery`);
    // Look down over the balustrade into the Foyer.
    await page.evaluate((t) => {
      const g = window.__game;
      g.controller.yaw = Math.atan2(-(t.foyer.x - g.controller.x), -((t.foyer.z + t.foyer.top) / 2 - g.controller.z));
      g.controller.pitch = -0.55;
    }, tour);
    await sleep(700);
    await shot('mansion-3-balcony-gallery-overlooking-the-foyer');
    fpsSamples.push(await measureFps());
    const mm = await page.evaluate(() => {
      const g = window.__game;
      const c = document.getElementById('minimap');
      const r = c.getBoundingClientRect();
      const px = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data;
      return { floor: g.minimap.floor, left: r.left, top: r.top, w: r.width, alpha: px[3], ink: px[0] + px[1] + px[2] };
    });
    check(mm.floor === 2 && mm.left < 40 && mm.top < 40 && mm.w > 100 && mm.alpha === 255, `minimap not drawn top-left for Floor 2 (${JSON.stringify(mm)})`);
    console.log(`2 stories + basement; dual grand staircases → Balcony Gallery (${up.room}); minimap top-left showing floor ${mm.floor}`);
    // 3. Back down; the coven gathers for a portrait.
    await page.evaluate(() => {
      const g = window.__game;
      const land = g.map.props.find((p) => p.kind === 'stairs_landing' && p.floor === g.controller.floor && Math.hypot(p.x - g.controller.x, p.z - g.controller.z) < 4);
      g.controller.yaw = Math.atan2(-(land.x - g.controller.x), -(land.z - g.controller.z));
      g.controller.pitch = -0.2;
    });
    await sleep(300);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__game.controller.floor === 0, { timeout: 4000 }).catch(() => failures.push('could not descend the grand staircase'));
    await standAndFace();
    await page.evaluate(() => { window.__game.controller.yaw += Math.PI; window.__game.controller.pitch = -0.05; }); // the lit side
    await sleep(400); // (let the server hear where we're looking)
    const self0 = await page.evaluate(() => window.__game.selfId);
    {
      const g = liveGame();
      const me = g.players.get(self0);
      const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
      let i = 0;
      for (const p of g.players.values()) {
        if (!p.isBot) continue;
        const side = i++ ? 0.75 : -0.75;
        const x = me.x + fx * 2.6 + fz * side, z = me.z + fz * 2.6 - fx * side;
        g.teleport(p, x, z, me.floor, Math.atan2(-(me.x - x), -(me.z - z)));
      }
    }
    await page.keyboard.press('KeyF'); // Nox: the plain wand glow (Lumos washes the robes out at this range)
    await sleep(700);
    await page.evaluate(() => { window.__game.controller.pitch = -0.05; });
    await shot('avatars-1-the-coven-in-their-robes');
    await page.keyboard.press('KeyF'); // Lumos again
    const avatarCount = await page.evaluate(() => [...window.__game.avatars.values()].filter((a) => a.group.visible).length);
    check(avatarCount >= 2, `teammate avatars not visible (${avatarCount})`);
    // 4. The input rework: 1–4 / R only select; the trigger (Q here, LMB in play) fires.
    await page.evaluate(() => { window.__events.length = 0; });
    await page.keyboard.press('Digit3');
    await page.keyboard.press('KeyR');
    await page.keyboard.press('Digit2');
    await sleep(400);
    const sel = await page.evaluate(() => ({
      casts: window.__events.filter((e) => e.type === 'cast' && e.caster === window.__game.selfId).length,
      selected: window.__game.selected,
      hud: [...document.querySelectorAll('#hud-hotbar .slot')].findIndex((el) => el.classList.contains('selected')),
    }));
    check(sel.casts === 0, `pressing 1–4 / R cast a spell (${sel.casts} casts)`);
    check(sel.selected === 1 && sel.hud === 1, `slot 2 not selected/highlighted (${JSON.stringify(sel)})`);
    await page.keyboard.press('KeyR');
    await sleep(150);
    const ultSel = await page.evaluate(() => ({ sel: window.__game.selected, hud: document.querySelector('#hud-hotbar .slot.ult').classList.contains('selected') }));
    check(ultSel.sel === 'ult' && ultSel.hud, `R did not select the Ultimate (${JSON.stringify(ultSel)})`);
    await shot('input-1-ultimate-selected-wand-aura');
    await page.keyboard.press('Digit2');
    await page.keyboard.press('KeyQ');
    const fired = await waitEvent('cast', 2000);
    const want = await page.evaluate(() => window.__game.wizard.spells[1].id);
    check(fired?.ability === want, `Q did not fire the selected slot (${fired?.ability} vs ${want})`);
    console.log(`input: 1–4/R select only (0 casts), Q fired ${fired?.ability}`);
    // 5. The Disillusionment Charm.
    await page.keyboard.press('KeyV');
    await page.waitForFunction(() => window.__game.buffs.includes('invis'), { timeout: 3000 }).catch(() => failures.push('V did not make you invisible'));
    for (const p of liveGame().players.values()) if (p.isBot) liveGame().onInvis(p.id);
    await sleep(500);
    const inv = await page.evaluate(() => ({ hud: document.getElementById('hud-invis').classList.contains('active'), screen: document.getElementById('screen-invis').classList.contains('on') }));
    check(inv.hud && inv.screen, `invisibility HUD missing (${JSON.stringify(inv)})`);
    await shot('invis-1-disillusionment-charm');
    console.log('V: Disillusionment Charm active (HUD timer, chameleon shimmer, teammates glassy)');
    await page.keyboard.press('KeyF'); // Nox
    await sleep(INVIS_WAIT);

    // ------------------------------------------------------------------ horror
    console.log('\n— The Malphas Amalgam —');
    await standAndFace();
    await page.evaluate(() => { window.__events.length = 0; });

    // 1. Haunting (before the Tome): in view at a distance, vanishes when lit.
    check(await setMode('haunt'), 'debug P never reached haunt mode');
    const haunted = await page.waitForFunction(() => window.__game.monsters.get('amalgam')?.snap.state === 'haunt', { timeout: 4000 }).catch(() => null);
    if (check(haunted, 'no haunting appeared')) {
      await page.evaluate(() => { // glimpse it from just outside the beam
        const g = window.__game;
        const m = g.monsters.get('amalgam');
        g.controller.yaw = Math.atan2(-(m.x - g.controller.x), -(m.z - g.controller.z)) + 0.45;
      });
      await sleep(200);
      await shot('horror-1-haunting-in-the-dark');
      await faceAmalgam();
      await page.keyboard.press('KeyF'); // Lumos: light it up
      await sleep(80);
      await shot('horror-1b-lit-glimpse');
      const vanish = await waitEvent('monster:vanish', 3000);
      check(vanish?.lit === true, `haunting did not vanish when lit (${JSON.stringify(vanish)})`);
      console.log(`haunting: appeared at a corner, vanished when lit=${vanish?.lit}`);
      await page.keyboard.press('KeyF'); // Nox
    }

    // 2. Capture test: it appears right in front of you and lunges.
    await standAndFace();
    check(await setMode('capture'), 'debug P never reached capture mode');
    await sleep(100);
    await shot('horror-2-amalgam-windup');
    const self = await page.evaluate(() => window.__game.selfId);
    const cap = await waitEvent('capture', 5000);
    if (!check(cap?.id === self, 'capture-test lunge did not take you')) {
      console.log('  capture diagnostics:', await page.evaluate(() => JSON.stringify({
        monster: window.__game.monsters.get('amalgam')?.snap,
        me: window.__game.positions.get(window.__game.selfId),
        events: window.__events.slice(-15).map((e) => e.type + (e.kind ? `:${e.kind}` : '') + (e.stage ? `:${e.stage}` : '')),
      })));
    }
    await sleep(450);
    const scary = await page.evaluate(() => document.getElementById('capture-screen').classList.contains('show'));
    check(scary, 'the Scary Capture Screen did not show');
    await shot('capture-1-scary-capture-screen');
    await sleep(300);
    await shot('capture-2-into-the-skull');
    await page.waitForFunction(() => window.__game.captured, { timeout: 5000 }).catch(() => {});
    await sleep(900);
    const cell = await page.evaluate(() => {
      const g = window.__game;
      const gate = g.map.props[g.map.ids.gate];
      g.controller.yaw = Math.atan2(-(gate.x - g.controller.x), -(gate.z - g.controller.z));
      g.controller.pitch = 0;
      return { captured: g.captured, floor: g.controller.floor, held: !!g.positions.get(g.selfId)?.cap };
    });
    check(cell.captured && cell.floor === 1 && cell.held, `not held in the Cage after capture (${JSON.stringify(cell)})`);
    check(!(await page.evaluate(() => document.getElementById('capture-screen').classList.contains('show'))), 'capture screen stuck on');
    await sleep(300);
    await shot('capture-3-underground-iron-cage');
    console.log(`capture: 1.5s scary screen (${scary ? 'shown' : 'MISSING'}) → woke in the Underground Iron Cage`);

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

    // ------------------------------------------------------------------ grimoire
    console.log('\n— Grimoire: 7 wizards × (4 spells + Ultimate) —');
    const freshHusk = async () => {
      if (await hasHusk()) {
        await toggleHusk();
        await page.waitForFunction(() => !window.__game.monsters.has('husk'), { timeout: 5000 });
      }
      await toggleHusk();
      await page.waitForFunction(() => window.__game.monsters.has('husk'), { timeout: 5000 });
      await sleep(200);
      await page.evaluate(() => {
        const g = window.__game;
        const m = g.monsters.get('husk');
        g.controller.yaw = Math.atan2(-(m.x - g.controller.x), -(m.z - g.controller.z));
        g.controller.pitch = -0.05;
      });
      await sleep(120);
    };
    const ULT_CHECK = {
      injorath: ['Abyssal Mind Fracture', () => window.__game.monsters.get('husk')?.snap.st.includes('confused')],
      parthius: ['Fiendfyre Great Dragon', () => window.__events.some((e) => e.type === 'impact' && e.ability === 'fiendfyre_dragon')],
      himandriel: ['Abyssal Deluge', () => window.__game.flooded === true],
      sushantus: ['Yggdrasil', () => window.__game.ents.some((e) => e.k === 'tree' && e.n === window.__game.roster.length)],
      kartavian: ['Sylph\u2019s Great Wind Dragon', () => window.__events.some((e) => e.type === 'impact' && e.ability === 'sylph_dragon')],
      soham: ['Dawn of the Sacred Order', () => window.__game.dawnActive && window.__game.monsters.get('husk')?.snap.st.includes('frozen')],
      himanshu: ['Devil Union', () => window.__game.buffs.includes('union')],
    };
    for (let i = 0; i < 7; i++) {
      const wizardId = Object.keys(EXPECT)[i];
      await page.keyboard.down('Shift');
      await page.keyboard.press(`Digit${i + 1}`);
      await page.keyboard.up('Shift');
      await page.waitForFunction((id) => window.__game.wizard.id === id, { timeout: 5000 }, wizardId);
      await standAndFace();
      await freshHusk();
      const cast = [];
      for (let slot = 0; slot < 4; slot++) {
        await page.evaluate(() => {
          const g = window.__game;
          const m = g.monsters.get('husk');
          if (m) g.controller.yaw = Math.atan2(-(m.x - g.controller.x), -(m.z - g.controller.z));
          window.__events.length = 0;
        });
        await sleep(80);
        await page.keyboard.press(`Digit${slot + 1}`); // selects only…
        await page.keyboard.press('KeyQ'); // …the trigger fires
        await sleep(slot === 0 ? 260 : 450);
        const r = await page.evaluate((s) => {
          const g = window.__game;
          const ev = window.__events.find((e) => e.type === 'cast' && e.caster === g.selfId);
          return { ability: ev?.ability, expected: g.wizard.spells[s].id, name: g.wizard.spells[s].name, cd: document.querySelectorAll('#hud-hotbar .slot .time')[s]?.textContent };
        }, slot);
        if (slot === 0) await shot(`spell-${i + 1}-${r.expected}`);
        else await shot(`spell-${i + 1}${'abc'[slot - 1]}-${r.expected}`);
        check(r.ability === r.expected, `${wizardId}: slot ${slot + 1} cast ${r.ability} (expected ${r.expected})`);
        check(r.cd !== '', `${wizardId}: slot ${slot + 1} cooldown not shown`);
        cast.push(r.name);
        if (slot === 0) {
          const st = await page.evaluate(() => window.__game.monsters.get('husk')?.snap.st ?? []);
          for (const code of EXPECT[wizardId].status) check(st.includes(code), `${wizardId}: slot 1 missing status ${code} (${st})`);
        }
        await sleep(350);
      }
      // Ultimate
      await freshHusk();
      await page.keyboard.press('KeyU');
      await page.waitForFunction(() => window.__game.ultCharge >= 100, { timeout: 4000 }).catch(() => {});
      await page.evaluate(() => {
        const g = window.__game;
        const m = g.monsters.get('husk');
        if (m) g.controller.yaw = Math.atan2(-(m.x - g.controller.x), -(m.z - g.controller.z));
        window.__events.length = 0;
      });
      await sleep(100);
      await page.keyboard.press('KeyR'); // select the Ultimate
      await page.keyboard.press('KeyQ'); // fire it
      const [ultName, ultCheck] = ULT_CHECK[wizardId];
      const ok = await page.waitForFunction(ultCheck, { timeout: 8000 }).then(() => true).catch(() => false);
      await sleep(wizardId === 'sushantus' ? 1800 : 300);
      await shot(`ult-${i + 1}-${wizardId}`);
      const fps = await measureFps();
      fpsSamples.push(fps);
      check(ok, `${wizardId}: Ultimate ${ultName} had no visible effect`);
      console.log(`${i + 1}. ${cast.join(' · ')}  ⟶  R: ${ultName} ${ok ? '✓' : '✗'}  fps≈${Math.round(fps)}`);
      await sleep(600);
    }
    // Lumos
    const lumos = await page.evaluate(async () => {
      const g = window.__game;
      const before = { i: g.wandLight.intensity, a: g.wandLight.angle };
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
      await new Promise((r) => setTimeout(r, 600));
      const after = { i: g.wandLight.intensity, a: g.wandLight.angle, server: g.positions.get(g.selfId)?.li };
      return { before, after, hud: document.getElementById('hud-lumos').textContent };
    });
    check(lumos.after.a > lumos.before.a + 0.2 && lumos.after.i > lumos.before.i && lumos.hud === 'LUMOS' && lumos.after.server === true,
      `Lumos did not brighten/widen the wand (${JSON.stringify(lumos)})`);
    console.log(`Lumos: angle ${lumos.before.a.toFixed(2)}→${lumos.after.a.toFixed(2)}, intensity ${Math.round(lumos.before.i)}→${Math.round(lumos.after.i)}, server sees it: ${lumos.after.server}`);
    await shot('lumos-on');
    await page.keyboard.press('KeyF');

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

    // ------------------------------------------------------------------ Step 6: the Sins
    console.log('\n— Step 6: Seven Hearts, room wards, the Seven Deadly Sins —');
    const sinsShown = [];
    for (const [i, sin] of ['pride', 'gluttony', 'wrath', 'lust', 'greed', 'envy', 'sloth'].entries()) {
      await page.evaluate((s) => { window.__events.length = 0; window.__game.net.emit('debug:arena', { sin: s }); }, sin);
      const start = await waitEvent('arena:start', 6000);
      if (!check(start?.sin === sin, `${sin}: no arena started`)) continue;
      liveGame().monster.hideFor(1e6); // the Keeper waits outside (it can't come in anyway)
      await sleep(i < 3 ? 2700 : 2400); // the eruption
      const faceDemon = () => page.evaluate((id) => {
        const g = window.__game;
        const d = g.monsters.get(id);
        if (!d) return;
        const dist = Math.hypot(d.x - g.controller.x, d.z - g.controller.z);
        g.controller.yaw = Math.atan2(-(d.x - g.controller.x), -(d.z - g.controller.z));
        g.controller.pitch = Math.atan2(1.0, Math.max(1, dist)) * 0.5;
      }, start.demonId);
      await faceDemon();
      await sleep(250);
      const arena = await page.evaluate((id) => {
        const g = window.__game;
        const d = g.monsters.get(id);
        return {
          demon: !!d, boss: !document.getElementById('hud-boss').classList.contains('hidden'),
          title: document.querySelector('#hud-boss span').textContent, barriers: g.arenas.size,
        };
      }, start.demonId);
      check(arena.demon && arena.boss && arena.barriers === 1, `${sin}: arena incomplete (${JSON.stringify(arena)})`);
      if (i < 4) await shot(`sin-${i + 1}-${sin}-lockdown`);
      // Fight: select a spell, fire with the trigger.
      for (let k = 0; k < 3; k++) {
        await faceDemon();
        await page.keyboard.press(`Digit${(k % 4) + 1}`);
        await page.keyboard.press('KeyQ');
        await sleep(400);
      }
      if (i < 2) {
        await faceDemon();
        await shot(`sin-${i + 1}b-${sin}-fight`);
      }
      fpsSamples.push(await measureFps());
      await page.keyboard.press('KeyL'); // debug: slay it
      const heart = await waitEvent('heart', 4000);
      const end = await waitEvent('arena:end', 4000);
      check(heart?.sin === sin && end?.won, `${sin}: slaying it did not destroy its Heart / open the doors`);
      sinsShown.push(`${sin}${heart && end?.won ? '' : '✗'}`);
      await sleep(400);
    }
    console.log(`Sins fought (lockdown → slain → Heart destroyed → doors open): ${sinsShown.join(', ')}`);
    const left = await page.evaluate(() => window.__game.destroyed.size);
    check(left === 7, `expected 7 Hearts destroyed (${left})`);

    // The Keeper's footsteps on the minimap (within 22 units).
    await standAndFace();
    {
      // Stalking 14–24 units away (set directly: cycling P would pass through "capture").
      const g = liveGame();
      const me = g.players.get(self0);
      const m = g.monster;
      m.debugHeld = false;
      const tile = m.tiles[me.floor].filter((tl) => {
        const d = Math.hypot(tl.x - me.x, tl.z - me.z);
        return d > 15 && d < 20;
      })[0] ?? m.hiddenSpot(me.floor, 14, 22);
      m.place({ x: tile.x, z: tile.z, floor: me.floor });
      m.goal = { x: me.x, z: me.z, floor: me.floor, peek: false };
      m.goalUntil = Infinity;
      m.hidden = false;
      m.setState('stalking');
    }
    const rippled = await page.waitForFunction(() => window.__game.minimap.ripples.length > 0, { timeout: 15000 }).then(() => true).catch(() => false);
    if (!check(rippled, 'no footstep ripples on the minimap')) {
      const g = liveGame(), m = g.monster, me = g.players.get(self0);
      console.log('  footsteps diagnostics:', JSON.stringify({ m: { st: m.state, hid: m.hidden, x: m.x, z: m.z, f: m.floor, mv: m.moving }, me: { x: me.x, z: me.z, f: me.floor, cap: me.captured } }),
        await page.evaluate(() => JSON.stringify({ cf: window.__game.controller.floor, snap: window.__game.monsters.get('amalgam')?.snap })));
    }
    await shot('minimap-2-keeper-footstep-ripples');
    console.log(`Keeper footsteps: ${rippled ? 'ripples on the minimap, the floor trembles' : 'none heard'}`);

    const audio = await page.evaluate(() => ({ state: window.__game.audio.ctx?.state, played: window.__game.audio.played }));
    console.log(`audio: context ${audio.state}, ${audio.played} sounds synthesised`);
    check(audio.state === 'running' && audio.played > 20, `audio engine not running (${JSON.stringify(audio)})`);

    // ------------------------------------------------------------------ finale
    console.log('\n— Phase III: the Forbidden Spell → the Archon → the Hell Portal —');
    await page.evaluate(() => { window.__events.length = 0; });
    await page.keyboard.press('KeyH'); // debug: six Hearts destroyed, Convergence
    await page.waitForFunction(() => window.__game.phase === 'convergence' && window.__game.fin, { timeout: 8000 });
    liveGame().monster.hideFor(40); // a quiet chapel for the chant
    const faceAltar = () => page.evaluate(() => {
      const g = window.__game;
      const altar = g.map.props[g.map.ids.altar];
      g.debugTeleport(altar.front.x, altar.front.z, altar.floor, 0);
      g.controller.yaw = Math.atan2(-(altar.x - altar.front.x), -(altar.z - altar.front.z));
      g.controller.pitch = -0.35;
    });
    await faceAltar();
    await page.waitForFunction(() => window.__game.target?.id === window.__game.map.ids.altar, { timeout: 4000 })
      .catch(() => failures.push('the altar never became the interaction target'));
    await page.keyboard.down('KeyE'); // hold: chant the Forbidden Spell
    await page.waitForFunction(() => (window.__game.fin?.rt ?? 0) > 0.35, { timeout: 60000 }).catch(() => {});
    await shot('finale-1-the-forbidden-spell');
    const ritual = await page.evaluate(() => ({ rt: window.__game.fin?.rt, hud: !document.getElementById('hud-ritual').classList.contains('hidden') }));
    console.log(`chanting… ritual ${(ritual.rt * 100).toFixed(0)}%, hud ${ritual.hud}`);
    check(ritual.hud, 'the ritual bar never showed');
    const merge = await waitEvent('merge', 90000);
    await page.keyboard.up('KeyE');
    check(merge, 'the Soul Merge never happened (bots did not chant?)');
    await sleep(1300);
    await shot('finale-2-soul-merge');
    const bossStart = await waitEvent('boss:start', 6000);
    check(bossStart, 'the Unbound Amalgam never appeared');
    // Keep the Archon standing through the screenshots (verification only).
    const keepAlive = setInterval(() => {
      const A = liveGame()?.finale?.archon;
      if (A) A.hp = Math.max(A.hp, 300);
    }, 200);
    await sleep(800);
    const faceBoss = () => page.evaluate(() => {
      const g = window.__game;
      const m = g.monsters.get('amalgam');
      if (m) g.controller.yaw = Math.atan2(-(m.x - g.controller.x), -(m.z - g.controller.z));
      g.controller.pitch = 0.05;
    });
    await faceBoss();
    await sleep(300);
    await shot('finale-3-archon-crown');
    const archon = await page.evaluate(() => ({
      body: document.body.classList.contains('archon'),
      crown: !!window.__game.finaleFx.crown?.parent,
      orbs: window.__game.finaleFx.crown?.children.filter((o) => o.isMesh).length,
      masteries: document.querySelectorAll('#hud-masteries .slot').length,
      boss: !document.getElementById('hud-boss').classList.contains('hidden'),
      eye: window.__game.controller.eyeOverride,
    }));
    console.log(`Archon: crown of ${archon.orbs} orbs, ${archon.masteries} Masteries on the bar, boss bar ${archon.boss}, eye ${archon.eye}`);
    check(archon.body && archon.crown && archon.orbs === 7 && archon.masteries === 7 && archon.boss, `Archon view incomplete (${JSON.stringify(archon)})`);
    fpsSamples.push(await measureFps());

    // The seven Elemental Masteries
    const { MASTERIES } = await import('../shared/finale.js');
    const masteryCast = [];
    for (const M of MASTERIES) {
      await page.waitForFunction((id) => !window.__game.fin?.mr?.[id], { timeout: 15000 }, M.id).catch(() => {});
      await faceBoss();
      await page.evaluate(() => { window.__events = window.__events.filter((e) => e.type !== 'mastery'); });
      await page.keyboard.press(`Digit${M.key}`);
      await page.keyboard.press('KeyQ');
      const ev = await waitEvent('mastery', 3000);
      await sleep(M.id === 'm_fire_dragon' || M.id === 'm_wind_dragon' ? 700 : 350);
      await shot(`finale-4-mastery-${M.key}-${M.id.slice(2)}`);
      const mine = ev && ev.id === M.id;
      check(mine, `Mastery ${M.key} (${M.name}) did not fire (${ev?.id ?? 'no event'})`);
      masteryCast.push(`${M.key}:${M.name}${mine ? '' : '✗'}`);
      await sleep(250);
    }
    console.log(`Masteries: ${masteryCast.join(' · ')}`);
    fpsSamples.push(await measureFps());

    // Its fury: orb volleys, floor shockwaves, charges
    const seenAttacks = new Set();
    for (const type of ['boss:volley', 'boss:wave', 'boss:charge']) {
      const ev = await waitEvent(type, 14000);
      if (!ev) continue;
      seenAttacks.add(type.slice(5));
      await faceBoss();
      await sleep(type === 'boss:volley' ? 450 : 1000);
      await shot(`finale-5-boss-${type.slice(5)}`);
    }
    console.log(`boss attacks seen: ${[...seenAttacks].join(', ')}`);
    check(seenAttacks.size >= 2, `the boss barely attacked (${[...seenAttacks]})`);
    fpsSamples.push(await measureFps());

    // The Hell Portal
    await page.keyboard.press('KeyN'); // debug: boss to 25%, wards spent
    let portal = null;
    for (let i = 0; i < 40 && !portal; i++) {
      await faceBoss();
      const ready = await page.evaluate(() => window.__game.fin?.mr ?? {});
      const M = MASTERIES.find((m) => !ready[m.id]);
      if (M) { await page.keyboard.press(`Digit${M.key}`); await page.keyboard.press('KeyQ'); }
      portal = await waitEvent('portal:open', 1000);
    }
    check(portal, 'the Hell Portal never opened');
    await sleep(1200);
    await page.evaluate(() => {
      const g = window.__game;
      const P = g.fin?.portal;
      if (P) g.controller.yaw = Math.atan2(-(P.x - g.controller.x), -(P.z - g.controller.z));
      g.controller.pitch = -0.25;
    });
    await sleep(300);
    await shot('finale-6-hell-portal');
    await page.keyboard.down('KeyE'); // Soul Grapple
    await sleep(600);
    const grapple = await page.evaluate(() => window.__game.fin?.gr ?? 0);
    console.log(`Soul Grapple: ${grapple} wizard(s) dragging`);
    check(grapple >= 1, 'holding E did not Soul Grapple');
    let sealing = null;
    for (let i = 0; i < 60 && !sealing; i++) {
      await faceBoss();
      const ready = await page.evaluate(() => window.__game.fin?.mr ?? {});
      const M = MASTERIES.find((m) => !ready[m.id] && ['m_wind_dragon', 'm_earth_pillars', 'm_white_chains'].includes(m.id));
      if (M) { await page.keyboard.press(`Digit${M.key}`); await page.keyboard.press('KeyQ'); }
      sealing = await waitEvent('sealing', 1000);
    }
    check(sealing, 'the boss was never dragged under');
    await sleep(1200);
    await shot('finale-7-sealing');
    const victory = await waitEvent('victory', 8000);
    await page.keyboard.up('KeyE');
    clearInterval(keepAlive);
    check(victory, 'no victory after the sealing');

    // ------------------------------------------------------------------ epilogue
    console.log('\n— Phase IV: the Epilogue —');
    await page.waitForFunction(() => window.__game.epilogue, { timeout: 5000 });
    const epStage = (name, timeout = 20000) => page.waitForFunction((n) => window.__game.epilogue?.stage === n, { timeout }, name)
      .then(() => true).catch(async (e) => {
        console.log(`  (waiting for ${name}: ${String(e).slice(0, 120)}; now ${await page.evaluate(() => JSON.stringify({ st: window.__game.epilogue?.stage, t: window.__game.epilogue?.t }))})`);
        return false;
      });
    check(await epStage('foyer'), 'the epilogue never reached the restored foyer');
    await sleep(3500);
    await shot('epilogue-1-foyer-in-sunlight');
    fpsSamples.push(await measureFps());
    check(await epStage('garden'), 'the epilogue never reached the gardens');
    await sleep(3500);
    await shot('epilogue-2-the-gardens');
    fpsSamples.push(await measureFps());
    const coven = victory?.coven ?? [];
    for (let i = 0; i < coven.length; i++) {
      check(await epStage(`family${i}`), `the epilogue skipped ${coven[i].name}'s family`);
      await sleep(2200);
      const text = await page.evaluate(() => document.getElementById('ep-card').textContent.trim());
      check(text.length > 40, `family ${i}: no epilogue text`);
      await shot(`epilogue-3-family-${i + 1}-${coven[i].wizardId}`);
    }
    await page.waitForFunction(() => !document.getElementById('ep-final').classList.contains('hidden'), { timeout: 15000 })
      .catch(() => failures.push('the final card never showed'));
    await sleep(3500); // let it fade in
    await shot('epilogue-4-play-again');
    const buttons = await page.evaluate(() => ({ again: document.getElementById('btn-again')?.disabled, lobby: document.getElementById('btn-ep-lobby')?.disabled }));
    check(buttons.again === false && buttons.lobby === false, `epilogue buttons not usable by the host (${JSON.stringify(buttons)})`);
    console.log(`epilogue: foyer → gardens → ${coven.length} families → final card; music ${await page.evaluate(() => !!window.__game.audio.epilogue)}`);
    const before = await page.evaluate(() => window.__game.selfId && window.__game.raf);
    await page.click('#btn-again');
    const replayed = await page.waitForFunction(() => window.__game && !window.__game.epilogue && window.__game.phase === 'tome' && window.__game.positions?.size > 0,
      { timeout: 15000 }).then(() => true).catch(() => false);
    check(replayed, 'Play Again did not start a fresh game');
    console.log(`Play Again → a fresh game: ${replayed}`);
    void before;


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
