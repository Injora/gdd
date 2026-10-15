// The in-game client: renderer, mansion, local wizard, teammates, HUD,
// interactions, and the network glue for a running match.

import * as THREE from 'three';
import { createCollisionWorld } from '/shared/collision.js';
import { roomAt } from '/shared/mapgen.js';
import { PHASE, INTERACT_RANGE, NET_SEND_RATE } from '/shared/constants.js';
import { WIZARD_BY_ID } from '/shared/wizards.js';
import { PROP_LABELS } from '/shared/propdefs.js';
import { buildMansion } from './world/MansionBuilder.js';
import { FirstPersonController } from './player/FirstPersonController.js';
import { WizardAvatar } from './entities/WizardAvatar.js';
import { HUD } from './ui/hud.js';
import { DebugMap } from './debug/DebugMap.js';

const REMOTE_LIGHTS = 3;
const WAND_INTENSITY = 70;
const $ = (id) => document.getElementById(id);

export class GameClient {
  constructor({ canvas, net, init, debug }) {
    this.net = net;
    this.canvas = canvas;
    this.debug = debug;
    this.map = init.map;
    this.selfId = init.selfId;
    this.roster = init.players;
    this.phase = init.phase;
    this.propState = init.propState ?? {};
    this.self = this.roster.find((m) => m.id === this.selfId);
    this.wizard = WIZARD_BY_ID[this.self.wizardId];
    this.world = createCollisionWorld(this.map, (prop) => !this.propState[prop.id]?.open);
    this.interactables = this.map.props.filter((p) => p.interact);
    this.heartIds = new Set();
    this.heartNames = new Map();
    this.destroyed = new Set(init.destroyed);
    this.tomeRead = !!init.tome;
    this.positions = new Map();
    this.avatars = new Map();
    this.channel = null;
    this.target = null;
    this.lightOn = true;
    this.tseq = 0;
    this.sendAt = 0;
    this.shake = 0;
    this.time = 0;
    this.activeFloor = -1;

    this.initRenderer();
    this.initScene();

    const idx = Math.max(0, this.roster.findIndex((m) => m.id === this.selfId));
    const sp = this.map.spawn.points[idx % this.map.spawn.points.length];
    this.controller = new FirstPersonController(this.camera, canvas, this.world, {
      x: sp.x, z: sp.z, floor: this.map.spawn.floor, yaw: this.map.spawn.yaw,
    });

    this.hud = new HUD();
    this.hud.show();
    this.hud.setPhase(this.phase);
    this.hud.light(true);
    if (init.tome) this.applyTome(init.tome, true);
    for (const id of this.destroyed) {
      this.mansion.destroyHeart(id, true);
      this.hud.heartDestroyed(id);
    }

    this.debugMap = new DebugMap($('debug-map'), this.map, (floor, x, z) => this.debugTeleport(x, z, floor));
    $('debug-stats').classList.toggle('hidden', !debug);
    document.body.classList.toggle('debug', debug);

    this.bindNetwork();
    this.bindInput();
    this.showPause('Click to enter the mansion');
    this.hud.banner('THE MANSION', 'Somewhere in the dark, a book is waiting to be read.', 5000);

    if (debug) window.__game = this; // console access for testing
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ---- setup ----------------------------------------------------------------

  initRenderer() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this._onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      r.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', this._onResize);
  }

  initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.075);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 90);
    scene.add(this.camera);

    // Barely-there moonlight so silhouettes exist outside the wand cone.
    scene.add(new THREE.HemisphereLight(0x1a1e33, 0x070404, 0.35));

    this.mansion = buildMansion(this.map);
    scene.add(this.mansion.group);

    // Local wand: viewmodel + shadow-casting spotlight offset from the eye.
    const tint = new THREE.Color(this.wizard.lightTint);
    const rig = new THREE.Group();
    rig.position.set(0.2, -0.2, -0.36);
    rig.rotation.set(0.12, 0.08, 0);
    const wand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.007, 0.26, 6).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0d0805, roughness: 0.7 }),
    );
    wand.position.z = -0.1;
    rig.add(wand);
    this.wandTipMat = new THREE.MeshBasicMaterial({ color: this.wizard.color });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), this.wandTipMat);
    tip.position.z = -0.235;
    rig.add(tip);
    this.camera.add(rig);
    this.wandRig = rig;

    const spot = new THREE.SpotLight(tint, WAND_INTENSITY, 30, 0.44, 0.6, 1.6);
    spot.position.set(0.24, -0.16, -0.6);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 0.15;
    spot.shadow.camera.far = 30;
    spot.shadow.bias = -0.0004;
    spot.shadow.normalBias = 0.02;
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, 0, -8);
    this.camera.add(spot, spotTarget);
    spot.target = spotTarget;
    this.wandLight = spot;

    this.fillLight = new THREE.PointLight(tint, 1.4, 5, 2);
    this.fillLight.position.set(0.1, -0.05, -1.2);
    this.camera.add(this.fillLight);

    // Pool of spotlights for teammates' wands (fixed count: no shader recompiles).
    this.remoteLights = [];
    for (let i = 0; i < REMOTE_LIGHTS; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 24, 0.44, 0.6, 1.6);
      scene.add(l, l.target);
      this.remoteLights.push(l);
    }
  }

  // ---- networking -------------------------------------------------------------

  bindNetwork() {
    this.handlers = {
      'game:snap': (s) => this.onSnapshot(s),
      'game:event': (e) => this.onEvent(e),
      'game:teleport': (d) => {
        this.tseq = d.tseq;
        this.controller.setPosition(d.x, d.z, d.floor, d.yaw);
      },
      'game:channel': (d) => {
        this.channel = d.propId === null ? null : { propId: d.propId, start: performance.now(), duration: d.duration * 1000 };
        if (!this.channel) this.hud.progress(null);
      },
    };
    for (const [ev, fn] of Object.entries(this.handlers)) this.net.on(ev, fn);
  }

  onSnapshot(s) {
    if (s.phase !== this.phase) this.setPhase(s.phase);
    const seen = new Set();
    for (const p of s.players) {
      seen.add(p.id);
      this.positions.set(p.id, p);
      if (p.id === this.selfId) continue;
      let av = this.avatars.get(p.id);
      if (!av) {
        const info = this.roster.find((m) => m.id === p.id);
        if (!info) continue;
        av = new WizardAvatar(info, WIZARD_BY_ID[info.wizardId]);
        const free = this.remoteLights.find((l) => !l.userData.owner);
        if (free) {
          free.userData.owner = p.id;
          av.attachLight(free);
        }
        this.scene.add(av.group);
        this.avatars.set(p.id, av);
      }
      av.setSnapshot(p);
    }
    for (const id of [...this.avatars.keys()]) if (!seen.has(id)) this.removeAvatar(id);
  }

  removeAvatar(id) {
    const av = this.avatars.get(id);
    if (!av) return;
    if (av.light) av.light.userData.owner = null;
    this.scene.remove(av.group);
    av.dispose();
    this.avatars.delete(id);
    this.positions.delete(id);
  }

  onEvent(e) {
    switch (e.type) {
      case 'whisper':
        this.hud.whisper(e.text);
        break;
      case 'journal':
        this.openJournal(true);
        break;
      case 'tome':
        this.applyTome(e.tome, false);
        break;
      case 'heart':
        this.destroyed.add(e.propId);
        this.mansion.destroyHeart(e.propId);
        this.hud.heartDestroyed(e.propId);
        this.hud.banner(`${e.name.toUpperCase()} IS SILENT`, `${e.by} destroyed it. ${e.count} of 6.`);
        this.shake = 0.6;
        break;
      case 'phase':
        this.setPhase(e.phase);
        if (e.phase === PHASE.CONVERGENCE) {
          setTimeout(() => this.hud.banner('SIX HEARTS ARE SILENT', 'Return to the Ritual Altar. All of you.', 6000), 4500);
        }
        break;
      case 'left':
        this.removeAvatar(e.id);
        this.roster = this.roster.filter((m) => m.id !== e.id);
        this.hud.whisper(`${e.name} is gone from the mansion.`);
        break;
    }
  }

  applyTome(tome, silent) {
    this.tomeRead = true;
    for (const h of tome.hearts) {
      this.heartIds.add(h.propId);
      this.heartNames.set(h.propId, h.name);
    }
    this.mansion.revealHearts(this.heartIds);
    this.hud.setJournal(tome);
    this.hud.setHearts(tome.hearts);
    if (!silent) {
      this.hud.banner('SOMETHING HAS AWOKEN', `${tome.by} read the Forbidden Convergence aloud.`, 5500);
      setTimeout(() => this.hud.whisper('Six hearts beat inside this house. Press J to read what the Tome revealed.', 6000), 3000);
      this.shake = 1.2;
    }
  }

  setPhase(phase) {
    this.phase = phase;
    this.hud.setPhase(phase);
  }

  // ---- input --------------------------------------------------------------------

  bindInput() {
    this._onKeyDown = (e) => {
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyE':
          if (this.target && !this.hud.journalOpen) {
            this.net.emit('p:interact', { propId: this.target.id });
          }
          break;
        case 'KeyF':
          this.lightOn = !this.lightOn;
          this.hud.light(this.lightOn);
          break;
        case 'KeyJ':
          this.openJournal(!this.hud.journalOpen);
          break;
        case 'Escape':
          if (this.hud.journalOpen) this.openJournal(false);
          break;
        case 'KeyM':
          if (this.debug) this.debugMap.toggle();
          break;
      }
    };
    this._onKeyUp = (e) => {
      if (e.code === 'KeyE' && this.channel) this.net.emit('p:cancel');
    };
    this._onClick = () => {
      if (!this.hud.journalOpen) this.controller.lock();
    };
    this._onLockChange = () => {
      if (this.controller.locked) this.hidePause();
      else if (!this.hud.journalOpen) this.showPause('Paused');
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.canvas.addEventListener('click', this._onClick);
    $('pause').addEventListener('click', this._onClick);
    $('journal').addEventListener('click', this._onJournalClick = () => this.openJournal(false));
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  /** Solo-debug lobbies only; the server ignores this otherwise. */
  debugTeleport(x, z, floor = this.controller.floor, yaw = this.controller.yaw) {
    this.net.emit('debug:teleport', { x, z, floor, yaw });
  }

  openJournal(open) {
    const isOpen = this.hud.toggleJournal(open);
    this.controller.enabled = !isOpen;
    if (isOpen) {
      if (this.channel) this.net.emit('p:cancel');
      document.exitPointerLock?.();
      this.hidePause();
    } else {
      this.controller.lock();
    }
  }

  showPause(title) {
    $('pause-title').textContent = title;
    $('pause').classList.remove('hidden');
  }

  hidePause() { $('pause').classList.add('hidden'); }

  // ---- per-frame --------------------------------------------------------------

  findTarget() {
    const c = this.controller;
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    let best = null;
    for (const p of this.interactables) {
      if (p.floor !== c.floor) continue;
      if (this.destroyed.has(p.id)) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > INTERACT_RANGE) continue;
      const dot = d > 1e-3 ? (dx * fx + dz * fz) / d : 1;
      if (d > 0.9 && dot < 0.72) continue;
      const score = d * (2 - dot);
      if (!best || score < best.score) best = { p, score };
    }
    return best?.p ?? null;
  }

  promptFor(p) {
    switch (p.interact) {
      case 'tome': return this.tomeRead ? ['Open your journal', false] : ['Read the Forbidden Tome', true];
      case 'curio':
        if (this.heartIds.has(p.id)) return [`Destroy ${this.heartNames.get(p.id)}`, true];
        return [`Examine the ${PROP_LABELS[p.kind] ?? p.kind}`, false];
      case 'stairs': return [p.kind === 'stairs_down' ? 'Descend the servants’ stair' : 'Climb back up the stair', false];
      case 'altar': return ['Approach the Ritual Altar', false];
      case 'gate': return ['Inspect the cell gate', false];
      default: return [null, false];
    }
  }

  roomLabel(p) {
    return roomAt(this.map, p.f, p.x, p.z)?.name ?? (p.f === 1 ? 'Basement passage' : 'Hallway');
  }

  frame(now) {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const c = this.controller;

    c.update(dt);
    if (c.floor !== this.activeFloor) {
      this.activeFloor = c.floor;
      this.mansion.setActiveFloor(c.floor);
    }

    // Camera shake (events)
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const s = this.shake * 0.02;
      this.camera.rotation.x += (Math.random() - 0.5) * s;
      this.camera.rotation.y += (Math.random() - 0.5) * s;
    }

    // Wand light: a living, slightly unsteady flame.
    const flicker = 0.92 + Math.sin(this.time * 7.3) * 0.04 + Math.sin(this.time * 17.1) * 0.03 + (Math.random() - 0.5) * 0.03;
    const channelBoost = this.channel ? 1.4 + Math.sin(this.time * 28) * 0.15 : 1;
    this.wandLight.intensity = this.lightOn ? WAND_INTENSITY * flicker * channelBoost : 0;
    this.fillLight.intensity = this.lightOn ? 1.4 * flicker : 0.25;
    this.wandTipMat.color.set(this.wizard.color).multiplyScalar(this.lightOn ? 1 : 0.2);
    this.wandRig.position.y = -0.2 + Math.sin(c.bobPhase * 2) * 0.006;

    for (const av of this.avatars.values()) av.update(dt, this.time, this.camera, c.floor);

    // Interaction
    this.target = this.hud.journalOpen ? null : this.findTarget();
    const [label, hold] = this.target ? this.promptFor(this.target) : [null, false];
    this.hud.prompt(this.channel ? null : label, hold);
    if (this.channel) this.hud.progress((now - this.channel.start) / this.channel.duration);

    this.hud.stamina(c.stamina);
    const room = roomAt(this.map, c.floor, c.x, c.z);
    if (room) this.hud.room(room.name);
    if ((this._teamAt ?? 0) <= this.time) {
      this._teamAt = this.time + 0.5;
      this.hud.team(this.roster, this.positions, this.selfId, (p) => this.roomLabel(p));
    }

    // Send state
    if (this.time >= this.sendAt) {
      this.sendAt = this.time + 1 / NET_SEND_RATE;
      this.net.emit('p:state', {
        tseq: this.tseq,
        x: Math.round(c.x * 100) / 100,
        z: Math.round(c.z * 100) / 100,
        yaw: Math.round(c.yaw * 1000) / 1000,
        pitch: Math.round(c.pitch * 1000) / 1000,
        cr: c.crouch,
        sp: c.sprinting && c.moving,
        li: this.lightOn,
        mv: c.moving,
      });
    }

    this.mansion.update(this.time, dt, this.camera);

    if (this.debug) {
      const me = { x: c.x, z: c.z, f: c.floor, yaw: c.yaw };
      const players = new Map(this.positions);
      players.set(this.selfId, me);
      this.debugMap.draw(c.floor, players, this.roster, this.heartIds, this.destroyed);
    }

    this.renderer.render(this.scene, this.camera);

    if (this.debug && (this._statsAt ?? 0) <= this.time) {
      this._statsAt = this.time + 0.25;
      const info = this.renderer.info.render;
      $('debug-stats').textContent =
        `${Math.round(1 / Math.max(dt, 1e-3))} fps · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · ` +
        `floor ${c.floor} · (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) · ${room?.name ?? 'hall'} · seed ${this.map.seed}`;
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const [ev, fn] of Object.entries(this.handlers)) this.net.off(ev, fn);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('click', this._onClick);
    $('pause').removeEventListener('click', this._onClick);
    $('journal').removeEventListener('click', this._onJournalClick);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    this.controller.dispose();
    for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
    this.hud.hide();
    this.hidePause();
    $('debug-map').classList.add('hidden');
    $('debug-stats').classList.add('hidden');
    this.renderer.dispose();
  }
}
