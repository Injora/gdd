// The in-game client: renderer, mansion, local wizard, teammates, HUD,
// interactions, and the network glue for a running match.

import * as THREE from 'three';
import { createCollisionWorld, addBarrier, removeBarrier, lineOfSight } from '/shared/collision.js';
import { roomAt } from '/shared/mapgen.js';
import { PHASE, INTERACT_RANGE, NET_SEND_RATE, FLOOR_Y, STAMINA, HP, LUMOS, INVIS, FLOOR, HEART_COUNT } from '/shared/constants.js';
import { WIZARDS, WIZARD_BY_ID, ABILITY_BY_ID } from '/shared/wizards.js';
import { PROP_LABELS } from '/shared/propdefs.js';
import { TASKS, TASK_STEPS } from '/shared/lore.js';
import { SINS } from '/shared/sins.js';
import { SpellInput } from './input/SpellInput.js';
import { Minimap, FOOTSTEP_RANGE } from './ui/Minimap.js';
import { SinDemonAvatar } from './entities/SinDemonAvatar.js';
import { buildMansion } from './world/MansionBuilder.js';
import { FirstPersonController } from './player/FirstPersonController.js';
import { WizardAvatar } from './entities/WizardAvatar.js';
import { MonsterAvatar } from './entities/MonsterAvatar.js';
import { SpellFX } from './fx/SpellFX.js';
import { GrimoireFX } from './fx/GrimoireFX.js';
import { FinaleFX } from './fx/FinaleFX.js';
import { Epilogue } from './epilogue/Epilogue.js';
import { FINALE, MASTERIES } from '/shared/finale.js';
import { PostFX } from './fx/PostFX.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { AmalgamAvatar } from './entities/AmalgamAvatar.js';
import { HUD } from './ui/hud.js';
import { DebugMap } from './debug/DebugMap.js';

const REMOTE_LIGHTS = 3;
const LUMOS_COLOR = new THREE.Color(0xfff3dc);
const NIGHT_SKY = new THREE.Color(0x1a1e33), NIGHT_GROUND = new THREE.Color(0x070404);
const DAWN_SKY = new THREE.Color(0xffe2a8), DAWN_GROUND = new THREE.Color(0x6a4a20);
const WAND_INTENSITY = 70;
const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** World-space point for audio: (x, z) on `floor`, `h` units above it. */
const wpos = (floor, x, z, h = 1.5) => ({ x, y: FLOOR_Y[floor] + h, z });

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
    this.lumos = false; // F: Lumos (bright torch) / Nox (plain wand glow)
    this.tseq = 0;
    this.sendAt = 0;
    this.shake = 0;
    this.time = 0;
    this.activeFloor = -1;
    this.monsters = new Map();
    this.slotCd = [0, 1, 2, 3].map(() => ({ readyAt: 0, duration: 1 }));
    this.selected = 0;
    this.ultCharge = 0;
    this.hp = HP.MAX;
    this.buffs = [];
    this.ents = [];
    this.dawnK = 0;
    this.recoil = 0;
    this.audio = new AudioEngine();
    this.terror = 0; // 0..1: staring at the Amalgam up close
    this.chromaPulse = 0;
    this.redPulse = 0;
    this.lightCutUntil = 0;
    this.nextCutAt = 0;
    this.jumpscare = null;
    this.captured = false;
    this.gameIsOver = false;
    this.heartTellAt = 0;
    this.scrapeAt = 0;
    this.pings = [];
    this.input = new SpellInput(); // 1–4 / R select; LMB / Q fire
    this.invisUntil = 0;
    this.invisReadyAt = 0;
    this.arenas = new Map(); // barrierId -> arena info
    this.visibleFloors = [FLOOR.GROUND, FLOOR.UPPER];
    this.captureUntil = 0;
    this.invisK = 0;
    this.tremor = 0;
    this.lastTremorStep = 0;

    this.initRenderer();
    this.initScene();
    this.fx = new SpellFX(this.scene, {
      localId: this.selfId,
      screen: (kind, strength) => this.hud.screen(kind, strength),
      shake: (amount) => { this.shake = Math.max(this.shake, amount); },
    });
    this.grimoire = new GrimoireFX(this.fx, {
      localId: this.selfId,
      screen: (kind, strength) => this.hud.screen(kind, strength),
      shake: (amount) => { this.shake = Math.max(this.shake, amount); },
      avatarOf: (id) => this.avatars.get(id),
    });
    this.finaleFx = new FinaleFX(this.fx, this.scene, this.map, {
      screen: (kind, strength) => this.hud.screen(kind, strength),
      shake: (amount) => { this.shake = Math.max(this.shake, amount); },
    });
    this.fin = null;
    this.mergeUntil = 0;
    this.epilogue = null;
    this.grappling = false;
    this.fx.prewarm(this.renderer, this.camera);
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.renderer.info.autoReset = false; // the composer renders several passes per frame
    for (const b of init.barriers ?? []) {
      addBarrier(this.world, b.floor, b.id, b.tiles);
      this.fx.barricade(b.id, b.floor, b.tiles, b.remaining);
    }

    const idx = Math.max(0, this.roster.findIndex((m) => m.id === this.selfId));
    const sp = this.map.spawn.points[idx % this.map.spawn.points.length];
    this.controller = new FirstPersonController(this.camera, canvas, this.world, {
      x: sp.x, z: sp.z, floor: this.map.spawn.floor, yaw: this.map.spawn.yaw,
    });

    this.hud = new HUD();
    this.hud.show();
    this.hud.setPhase(this.phase);
    this.hud.lumos(false);
    this.hud.setWizard(this.wizard);
    this.hud.hp(HP.MAX);
    if (init.tome) this.applyTome(init.tome, true);
    for (const id of this.destroyed) {
      this.heartIds.add(id);
      this.mansion.destroyHeart(id, true);
    }

    this.debugMap = new DebugMap($('debug-map'), this.map, (floor, x, z) => this.debugTeleport(x, z, floor));
    this.minimap = new Minimap($('minimap'), this.map);
    // Hearts already broken open or destroyed (joining mid-game).
    for (const [id, st] of Object.entries(this.propState)) {
      if (st?.unsealed) this.unsealHeart(Number(id), true);
      if (st?.done !== undefined || st?.turns !== undefined) this.mansion.setPropState(Number(id), st);
    }
    for (const a of init.arenas ?? []) this.onArenaStart(a, true);
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
      this.post?.resize();
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
    this.hemi = new THREE.HemisphereLight(0x1a1e33, 0x070404, 0.35);
    scene.add(this.hemi);

    this.mansion = buildMansion(this.map);
    scene.add(this.mansion.group);

    // Local wand: viewmodel + shadow-casting spotlight offset from the eye.
    const tint = new THREE.Color(this.wizard.lightTint);
    const rig = new THREE.Group();
    rig.position.set(0.2, -0.2, -0.36);
    rig.rotation.set(0.12, 0.08, 0);
    // First person: a robed sleeve with a cuff in your colour, a hand, and a carved wand.
    this.handMats = [];
    const fp = (m) => { this.handMats.push(m); return m; };
    const sleeveMat = fp(new THREE.MeshStandardMaterial({ color: 0x0c0a0e, roughness: 0.85 }));
    const cuffMat = fp(new THREE.MeshStandardMaterial({ color: this.wizard.color, roughness: 0.45, emissive: this.wizard.color, emissiveIntensity: 0.08 }));
    const skinMat = fp(new THREE.MeshStandardMaterial({ color: 0xd2b49a, roughness: 0.6 }));
    const woodMat = fp(new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.55 }));
    const goldMat = fp(new THREE.MeshStandardMaterial({ color: 0xc8a040, roughness: 0.35, metalness: 0.85 }));
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.2, 10).rotateX(Math.PI / 2), sleeveMat);
    sleeve.position.set(0.03, -0.03, 0.13);
    rig.add(sleeve);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.008, 6, 16), cuffMat);
    cuff.position.set(0.035, -0.035, 0.03);
    rig.add(cuff);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), skinMat);
    hand.scale.set(1, 0.85, 1.25);
    hand.position.set(0.01, -0.012, 0.0);
    rig.add(hand);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.006, 0.07, 8).rotateX(Math.PI / 2), woodMat);
    handle.position.z = -0.02;
    rig.add(handle);
    for (const z of [-0.045, 0.0]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0075, 0.002, 4, 10), goldMat);
      ring.position.z = z;
      rig.add(ring);
    }
    const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0065, 0.22, 6).rotateX(Math.PI / 2), woodMat);
    wand.position.z = -0.15;
    rig.add(wand);
    this.wandTipMat = new THREE.MeshBasicMaterial({ color: this.wizard.color, transparent: true });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), this.wandTipMat);
    tip.position.z = -0.262;
    rig.add(tip);
    this.wandTip = tip;
    // The elemental preview aura: what the selected slot will cast.
    this.wandAura = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.mansion.kit.glow(new THREE.Group(), 0, 0, 0, 0xffffff, 1).material.map,
      color: this.wizard.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5,
    }));
    this.wandAura.position.z = -0.262;
    this.wandAura.scale.setScalar(0.05);
    rig.add(this.wandAura);
    this.camera.add(rig);
    this.wandRig = rig;
    // Dust motes drifting in your own Lumos beam.
    {
      const n = 160;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, -1 - Math.random() * 7], i * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.motes = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.025, color: 0xfff0d0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
        map: this.wandAura.material.map,
      }));
      this.camera.add(this.motes);
    }

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
      'game:cooldown': (d) => this.onCooldown(d),
      'game:channel': (d) => {
        this.channel = d.propId === null ? null : { propId: d.propId, start: performance.now(), duration: d.duration * 1000 };
        if (!this.channel) this.hud.progress(null);
      },
      // A Sin's ribbons or vacuum yank you along.
      'game:impulse': (d) => this.controller.impulse?.(d.vx, d.vz, d.duration),
      'game:invis': (d) => {
        const now = performance.now();
        if (d.ok) {
          this.invisUntil = now + d.duration * 1000;
          this.invisReadyAt = now + d.readyIn * 1000;
          if (d.late) this.hud.whisper('Too late. It has already seen you — it can still smell you out.', 3500);
        } else if (d.reason === 'cooldown') {
          this.invisReadyAt = now + d.readyIn * 1000;
          this.hud.denied('invis');
        }
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

    const me = s.players.find((p) => p.id === this.selfId);
    if (me) {
      this.hp = me.hp ?? this.hp;
      this.ultCharge = me.u ?? 0;
      this.buffs = me.bf ?? [];
    }
    this.grimoire.syncProjectiles(s.prj ?? []);
    this.ents = s.ents ?? [];
    this.grimoire.syncEntities(this.ents);
    this.flooded = (s.fl ?? 0) > 0;
    this.fin = s.fin ?? null;
    this.dawnActive = (s.dw ?? 0) > 0;

    const seenMonsters = new Set();
    for (const m of s.monsters ?? []) {
      seenMonsters.add(m.id);
      let av = this.monsters.get(m.id);
      if (!av) {
        if (m.kind === 'amalgam') {
          av = new AmalgamAvatar(m, {
            map: this.map, fx: this.fx, debug: this.debug,
            onStep: (a, hunting) => this.onKeeperStep(a, hunting),
          });
        } else if (m.kind === 'sin') {
          av = new SinDemonAvatar(m, { fx: this.fx, getPos: (id) => (id === this.selfId ? this.localPos() : this.positions.get(id)) });
          this.scene.add(av.hazardGroup);
        } else {
          av = new MonsterAvatar(m, this.fx);
        }
        this.scene.add(av.group);
        this.monsters.set(m.id, av);
      }
      av.setSnapshot(m);
    }
    for (const [id, av] of this.monsters) {
      if (seenMonsters.has(id)) continue;
      this.scene.remove(av.group);
      if (av.hazardGroup) this.scene.remove(av.hazardGroup);
      av.dispose();
      this.monsters.delete(id);
    }
  }

  localPos() {
    const c = this.controller;
    return { x: c.x, z: c.z, floor: c.floor };
  }

  onCooldown(d) {
    const now = performance.now();
    if (d.slot === 'ult') {
      if (!d.ok) {
        this.hud.denied('ult');
        if (d.reason === 'no-target') this.hud.whisper('Your Ultimate finds nothing to strike.');
      }
      return;
    }
    const cd = this.slotCd[d.slot ?? 0];
    if (d.ok) Object.assign(cd, { readyAt: now + d.readyIn * 1000, duration: d.duration });
    else {
      if (d.reason === 'cooldown') cd.readyAt = now + d.readyIn * 1000;
      this.hud.denied(d.slot);
    }
  }

  /** Cast hotbar slot 0–3, or 'ult'. */
  cast(slot = this.selected) {
    if (this.hud.journalOpen || this.jumpscare || this.gameIsOver) return;
    const now = performance.now();
    const c = this.controller;
    if (slot === 'ult') {
      if (this.ultCharge < 100) return this.hud.denied('ult');
      this.net.emit('p:cast', { yaw: c.yaw, pitch: c.pitch, slot: 'ult' });
      this.recoil = 1.4;
      return;
    }
    const cd = this.slotCd[slot];
    if (now < cd.readyAt) return this.hud.denied(slot);
    this.net.emit('p:cast', { yaw: c.yaw, pitch: c.pitch, slot });
    // Optimistic: the server's game:cooldown reply re-syncs the slot.
    const spell = this.wizard.spells[slot];
    Object.assign(cd, { readyAt: now + spell.cooldown * 1000, duration: spell.cooldown });
    this.recoil = 1;
  }

  /** Number keys and R only select (the HUD highlights it, the wand tip previews it). */
  select(slot) {
    this.selected = slot;
    this.hud.select(slot);
    this.audio.selectSpell?.(slot === 'ult');
  }

  /** The trigger (LMB, or Q for headless tests): fire whatever is selected. */
  castSelectedSpell() {
    if (this.hud.journalOpen || this.gameIsOver) return;
    const f = this.input.fire({ archon: this.archonMode() });
    if (f.action === 'mastery') {
      this.net.emit('p:mastery', { key: f.key, yaw: this.controller.yaw });
      this.recoil = 1.2;
      return;
    }
    this.cast(f.slot);
  }

  /** V: the Disillusionment Charm. */
  castInvis() {
    if (this.gameIsOver || this.captured || this.archonMode()) return;
    if (performance.now() < this.invisReadyAt) return this.hud.denied('invis');
    this.net.emit('p:invis');
  }

  setRoster(players) {
    const old = new Map(this.roster.map((m) => [m.id, m.wizardId]));
    this.roster = players;
    for (const m of players) {
      if (old.get(m.id) === m.wizardId) continue;
      if (m.id === this.selfId) {
        this.wizard = WIZARD_BY_ID[m.wizardId];
        const tint = new THREE.Color(this.wizard.lightTint);
        this.wandLight.color.copy(tint);
        this.fillLight.color.copy(tint);
        this.hud.setWizard(this.wizard);
        for (const cd of this.slotCd) Object.assign(cd, { readyAt: 0, duration: 1 });
        this.hud.whisper(`You now walk as ${this.wizard.name}, ${this.wizard.title}.`);
      } else {
        this.removeAvatar(m.id); // re-created with the new wizard on the next snapshot
      }
    }
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
        this.audio.gong();
        break;
      case 'heart':
        this.destroyed.add(e.propId);
        this.heartIds.add(e.propId);
        this.mansion.destroyHeart(e.propId);
        this.hud.heartDestroyed(e.heartType);
        this.hud.banner(`${e.name.toUpperCase()} IS SILENT`, `${SINS[e.sin]?.name ?? 'Its Sin'} is slain. ${e.count} of ${HEART_COUNT}.`);
        this.shake = 0.6;
        {
          const prop = this.map.props[e.propId];
          this.audio.heartDestroyed(wpos(prop.floor, prop.x, prop.z));
        }
        break;
      case 'phase':
        this.setPhase(e.phase);
        if (e.phase === PHASE.CONVERGENCE) {
          setTimeout(() => this.hud.banner('SEVEN HEARTS ARE SILENT', 'Return to the Ritual Altar. All of you.', 6000), 4500);
        }
        break;
      case 'left':
        this.removeAvatar(e.id);
        this.roster = this.roster.filter((m) => m.id !== e.id);
        this.hud.whisper(`${e.name} is gone from the mansion.`);
        break;
      case 'roster':
        this.setRoster(e.players);
        break;

      // ---- spells
      case 'cast':
        if (e.caster !== this.selfId) this.avatars.get(e.caster)?.castPulse();
        if (e.wall) addBarrier(this.world, e.floor, e.id, e.wall.tiles);
        this.fx.onCast(e, this.localPos());
        this.grimoire.onCast(e, this.localPos());
        this.audio.spell(e.ability, wpos(e.floor, e.x, e.z));
        this.audio.grimoire(e.ability, wpos(e.floor, e.x, e.z));
        if (e.ult) {
          const who = e.caster === this.selfId ? 'You unleash' : `${this.roster.find((m) => m.id === e.caster)?.name ?? 'A wizard'} unleashes`;
          this.hud.banner(ABILITY_BY_ID[e.ability].name.toUpperCase(), `${who} an Ultimate.`, 3200);
        }
        if (e.ability === 'psychic_torment' && e.caster === this.selfId) this.chromaPulse = 1;
        break;
      case 'impact':
        if (e.ability === 'ignis_blast') {
          this.fx.onImpact(e);
          this.audio.fireImpact(wpos(e.floor, e.x, e.z));
        } else {
          this.grimoire.onImpact(e);
          this.audio.boom(wpos(e.floor, e.x, e.z), e.kind === 'dragon' ? 50 : 110, e.kind === 'dragon' ? 1.4 : 0.4, e.kind === 'dragon' ? 1.4 : 0.6);
        }
        break;
      case 'spell:hit':
        this.grimoire.explosion(e.floor, e.x, e.z, 0.8, ABILITY_BY_ID[e.ability]?.source === 'earth' ? new THREE.Color(0x7fd36a) : new THREE.Color(0xff6a10));
        break;
      case 'zone:trigger':
        this.grimoire.onZoneTrigger(e);
        this.audio.whoosh(wpos(e.floor, e.x, e.z), 200, 1800, 1.2, { type: 'lowpass', gain: 1 });
        break;
      case 'entity:end':
        this.grimoire.onEntityEnd(e);
        break;
      case 'tree:eat':
        this.grimoire.onTreeEat(e);
        if (e.by === this.selfId) {
          this.terror = 0;
          this.audio.fruit();
          this.hud.whisper('The fruit is warm and sweet. Your fear drains away.');
        }
        break;
      case 'player:hit':
        if (e.id === this.selfId) {
          this.hp = e.hp;
          this.hud.screen('hurt', Math.min(1, 0.4 + e.amount / 40));
          this.shake = Math.max(this.shake, 0.3 + e.amount / 60);
          this.audio.hurt(e.amount);
          if (e.absorbed) this.hud.whisper(`The water swallows the blow (${e.absorbed} absorbed).`, 1800);
        }
        break;
      case 'player:immune': {
        const p = this.positions.get(e.id);
        if (p) this.fx.glow.burst(40, p.x, FLOOR_Y[p.f] + 1.2, p.z, { speed: 4, life: 0.6, color: new THREE.Color(0xc0102a), drag: 2.5 });
        break;
      }
      case 'monster:attack': {
        const av = this.monsters.get(e.id);
        const tp = e.targetId ? (e.targetId === this.selfId ? { x: this.controller.x, z: this.controller.z } : this.positions.get(e.targetId)) : null;
        this.grimoire.monsterAttack(e, av, tp);
        if (e.stage === 'strike') this.audio.monsterAttack(e.kind, wpos(e.floor, e.x, e.z, 1.5));
        break;
      }
      case 'monster:phantoms':
        this.grimoire.phantoms(e, (spot, floor) => this.makePhantom(spot, floor));
        if (e.floor === this.controller.floor) this.audio.whisper(Math.random() < 0.5 ? -1 : 1);
        break;
      case 'barrier:hit':
        this.shake = Math.max(this.shake, 0.2);
        break;
      case 'barrier:end':
        removeBarrier(this.world, e.id);
        this.fx.onBarrierEnd(e.id);
        break;
      case 'gate':
        this.propState[e.propId] = { open: e.open };
        this.mansion.setGateOpen(e.propId, e.open);
        if (e.open && e.by) this.hud.whisper(`${e.by} broke the ritual lock. The cell gate swings open.`);
        {
          const gate = this.map.props[e.propId];
          this.audio.gate(wpos(gate.floor, gate.x, gate.z), e.open);
        }
        break;

      // ---- monsters (Training Husk, the Keeper, the Sins)
      case 'monster:damage':
        if (e.immune) {
          if ((this._immuneAt ?? 0) < this.time) {
            this._immuneAt = this.time + 6;
            this.hud.caption('[ nothing harms it while a single Heart still beats ]', 2600);
          }
          this.monsters.get(e.id)?.showImmune?.();
          break;
        }
        this.monsters.get(e.id)?.showDamage(e.amount, e.source);
        break;
      case 'monster:lockbroken': {
        if (e.reason === 'arena') break;
        const why = { dawn: 'Chained in golden light, it forgets you.', fracture: 'Its mind is locked; its sight is wiped.', union: 'It touched the Union and recoiled, blind.' }[e.reason] ?? '';
        this.hud.banner('ITS SIGHT IS BROKEN', `${why} Get out of its sight and hide — V, and hold still.`, 4500);
        this.audio.lockBroken?.();
        break;
      }
      case 'monster:recoil':
        this.fx.glow.burst(70, e.x, FLOOR_Y[e.floor] + 1.6, e.z, { speed: 6, life: 0.8, color: new THREE.Color(0xc0102a), drag: 2.5 });
        this.audio.shriek(wpos(e.floor, e.x, e.z, 2.8), { volume: 0.7, length: 1.4, pitch: 1.1 });
        break;
      case 'invis':
        if (e.id !== this.selfId) {
          const p = this.positions.get(e.id);
          if (p) this.fx.glow.burst(30, p.x, FLOOR_Y[p.f] + 1.1, p.z, { speed: 2, life: 0.6, color: new THREE.Color(0xbfe6ff), drag: 3 });
        } else {
          this.audio.invis?.();
        }
        break;

      // ---- Hearts: room tasks, the Sins' arenas
      case 'task': {
        this.mansion.setPropState(e.propId, e.state);
        this.propState[e.propId] = e.state;
        const t = TASKS[e.task];
        this.hud.whisper(e.state.done ? `${t.done}. (${e.progress} of ${e.of})` : `The mirror turns, but not yet true.`, 2600);
        const prop = this.map.props[e.propId];
        this.audio.taskStep?.(wpos(prop.floor, prop.x, prop.z, 1), e.task, !!e.state.done);
        break;
      }
      case 'heart:unsealed':
        this.unsealHeart(e.propId);
        this.hud.banner(`${e.name.toUpperCase()} IS UNSEALED`, `The wards of the ${e.room} are broken. Something waits inside it: ${SINS[e.sin].name}.`, 5000);
        break;
      case 'arena:start':
        this.onArenaStart(e, false);
        break;
      case 'arena:end':
        this.onArenaEnd(e);
        break;
      case 'sin:attack':
      case 'sin:impact':
      case 'sin:reflect': {
        const av = this.monsters.get(e.id);
        av?.onAttack?.(e);
        if (e.type === 'sin:attack') this.audio.sinCue?.(e.sin, e.kind, e.stage, wpos(e.floor, e.x, e.z, 1.5));
        if (e.type === 'sin:reflect') this.audio.sinCue?.('pride', 'reflect', 'strike', wpos(e.floor, e.x, e.z, 1.5));
        if (e.type === 'sin:impact') this.audio.boom(wpos(e.floor, e.x, e.z), 90, 0.5, 0.7);
        if ((e.hits ?? []).includes(this.selfId)) this.shake = Math.max(this.shake, 0.4);
        break;
      }
      case 'monster:scream': {
        // Psychic Torment: the multi-layered shriek echoes through the mansion.
        const c = this.controller;
        const d = e.floor === c.floor ? Math.hypot(e.x - c.x, e.z - c.z) : 30;
        this.audio.shriek(wpos(e.floor, e.x, e.z, 2.8));
        this.shake = Math.max(this.shake, 0.6 * clamp01(1 - d / 40));
        if (d < 15) this.chromaPulse = Math.max(this.chromaPulse, 0.7);
        this.onScream?.(e);
        break;
      }
      case 'monster:awaken':
        setTimeout(() => {
          const am = this.monsters.get('amalgam');
          if (am) this.audio.shriek(wpos(am.floor, am.x, am.z, 2.8), { volume: 0.8, length: 2.4, pitch: 0.8 });
        }, 2600);
        break;
      case 'monster:hunt':
        if (e.targetId === this.selfId) {
          this.audio.huntStinger();
          this.shake = Math.max(this.shake, 0.3);
        }
        break;
      case 'monster:haunt':
        if (e.targetId === this.selfId) setTimeout(() => this.audio.hauntSting(), 400);
        break;
      case 'monster:banished': {
        const am = this.monsters.get('amalgam');
        if (am && e.reason !== 'capture') this.audio.shriek(wpos(am.floor, am.x, am.z, 2.8), { volume: 0.6, length: 1.2, pitch: 0.7 });
        if (e.reason === 'combo' || e.reason === 'stagger') this.hud.caption('[ the Amalgam reels and flees into the dark ]', 2500);
        break;
      }
      case 'monster:blocked':
        this.fx.shieldHit(e.targetId);
        if (e.targetId === this.selfId) this.hud.screen('blocked', 1);
        break;

      // ---- capture / rescue / game over
      case 'capture':
        if (e.id === this.selfId) this.startJumpscare(e);
        else {
          this.hud.whisper(`${e.name} has been dragged into the dark!`);
          this.audio.shriek(wpos(e.floor, e.mx, e.mz, 2.5), { volume: 0.5, length: 0.8, pitch: 1.3 });
        }
        break;
      case 'captured':
        if (e.id === this.selfId) {
          this.captured = true;
          setTimeout(() => this.hud.banner('LOCKED IN THE UNDERGROUND IRON CAGE', 'Press G to call for help. Your spells still pass between the bars.', 6000), 200);
        } else {
          this.hud.whisper(`${e.name} is locked in the Underground Iron Cage. Break the lock!`);
        }
        break;
      case 'freed':
        if (e.ids.includes(this.selfId)) {
          this.captured = false;
          this.hud.banner('THE LOCK BREAKS', `${e.by} came for you. Run.`, 3500);
        } else {
          this.hud.whisper(`${e.names.join(' and ')} ${e.names.length > 1 ? 'are' : 'is'} free.`);
        }
        break;
      case 'gameover':
        this.gameIsOver = true;
        this.controller.enabled = false;
        document.exitPointerLock?.();
        this.hidePause();
        this.hud.gameOver(true, e.hostId === this.selfId);
        this.audio.shriek(null, { volume: 0.9, length: 3, pitch: 0.6 });
        break;
      case 'restart':
        this.gameIsOver = false;
        this.captured = false;
        this.jumpscare = null;
        this.controller.enabled = true;
        this.hud.gameOver(false);
        this.hud.banner('THE RITUAL BEGINS AGAIN', 'The Amalgam gives you a few heartbeats\u2019 head start.', 4500);
        this.showPause('Click to continue');
        break;
      case 'ping':
        this.addPing(e);
        break;
      // ---- Phase III / IV
      case 'merge':
        this.startMerge(e);
        break;
      case 'boss:start':
        this.finaleFx.hellfire(e.floor);
        this.hud.banner('THE UNBOUND MALPHAS AMALGAM', 'The Chapel splits with hellfire. Keys 1\u20137 choose an Elemental Mastery; click to cast it.', 5000);
        this.audio.shriek(wpos(e.floor, e.x, e.z, 3), { volume: 1, length: 2.6, pitch: 0.65 });
        break;
      case 'mastery':
        this.finaleFx.mastery(e, this.grimoire);
        this.audio.mastery(e.id, wpos(e.floor, e.to.x, e.to.z, 2));
        break;
      case 'boss:volley':
      case 'boss:wave':
      case 'boss:charge':
      case 'boss:ward':
        this.audio.bossCue(e.type.slice(5), wpos(e.floor, e.x, e.z, 2));
        if (e.type === 'boss:ward') this.hud.caption('[ a crimson ward: break it with the Anti-Magic Slash (7) ]', 3000);
        if (e.type === 'boss:charge') this.hud.caption('[ it rears back to charge ]', 1200);
        break;
      case 'archon:hit':
        this.hud.screen('hurt', Math.min(1, 0.3 + e.amount / 50));
        this.shake = Math.max(this.shake, 0.3 + e.amount / 80);
        this.audio.hurt(e.amount);
        break;
      case 'portal:open':
        this.finaleFx.openPortal(e);
        this.hud.banner('THE HELL PORTAL TEARS OPEN', 'Bind it, shove it in with Wind. HOLD E: Soul Grapple.', 6000);
        this.audio.bossCue('portal', wpos(e.floor, e.x, e.z, 1));
        break;
      case 'sealing':
        this.finaleFx.sealing(e);
        this.hud.banner('DRAG IT UNDER', 'The rift is closing\u2026', e.duration * 1000);
        this.audio.bossCue('sealing', wpos(e.floor, e.x, e.z, 1));
        break;
      case 'victory':
        this.startEpilogue(e);
        break;
      case 'debug:mode':
        this.hud.caption(`DEBUG \u00b7 monster mode: ${e.mode.toUpperCase()}`, 2500);
        break;
      case 'husk:spawn':
        this.hud.whisper('A Test Monster Husk claws its way up through the floorboards. [P] to dismiss.');
        break;
      case 'husk:despawn':
        this.hud.whisper('The husk collapses into dust.');
        break;
      case 'husk:crumble':
        this.hud.caption('[ the husk crumbles \u2014 it will re-form in 3s ]', 2500);
        break;
      case 'husk:hit':
        if (e.targetId === this.selfId) {
          this.hud.screen('hit', 1);
          this.shake = Math.max(this.shake, 0.5);
          this.hud.whisper('The husk\u2019s claws rake across you.');
        }
        break;
      case 'husk:blocked':
        this.fx.shieldHit(e.targetId);
        this.monsters.get(e.id)?.blocked();
        if (e.targetId === this.selfId) this.hud.screen('blocked', 1);
        break;
    }
  }

  applyTome(tome, silent) {
    this.tomeRead = true;
    // Riddles only: a Heart shows itself when its room's wards are broken.
    this.hud.setJournal(tome);
    this.hud.setHearts(tome.hearts);
    for (const h of tome.hearts) if (h.destroyed) this.hud.heartDestroyed(h.type);
    if (!silent) {
      this.hud.banner('SOMETHING HAS AWOKEN', `${tome.by} read the Forbidden Convergence aloud.`, 5500);
      setTimeout(() => this.hud.whisper('Seven hearts beat inside this house, each sealed by its room. Press J to read the riddles.', 6000), 3000);
      this.shake = 1.2;
    }
  }

  /** A Heart's room wards are broken: it shows itself, and its tell begins. */
  unsealHeart(propId, silent = false) {
    this.heartIds.add(propId);
    const prop = this.map.props[propId];
    this.heartNames.set(propId, prop ? `the ${PROP_LABELS[prop.kind] ?? prop.kind}` : 'the Heart');
    this.mansion.revealHearts([propId]);
    if (!this.destroyed.has(propId)) this.mansion.unsealHeart(propId);
    if (!silent && prop) this.audio.heartTell(wpos(prop.floor, prop.x, prop.z, 1.4), 1);
  }

  onArenaStart(e, silent) {
    const info = { barrierId: e.barrierId, tiles: e.tiles, floor: e.floor, roomId: e.roomId, sin: e.sin, heartPropId: e.heartPropId, demonId: e.demonId };
    this.arenas.set(e.barrierId, info);
    addBarrier(this.world, e.floor, e.barrierId, e.tiles);
    this.mansion.addArena(info);
    if (silent) return;
    const inside = (e.inside ?? []).includes(this.selfId);
    const S = SINS[e.sin];
    this.hud.banner(e.title, inside ? `${S.blurb} The doors will not open until it dies.` : `${e.by} broke ${e.name} open. The doors are sealed in blood.`, 6000);
    this.shake = Math.max(this.shake, 1);
    this.redPulse = Math.max(this.redPulse, 0.6);
    this.audio.arenaSlam?.(inside);
    const prop = this.map.props[e.heartPropId];
    if (prop) this.mansion.burst(prop.floor, prop.x, prop.z, 0xff2a1a);
  }

  onArenaEnd(e) {
    removeBarrier(this.world, e.barrierId);
    this.mansion.removeArena(e.barrierId);
    this.arenas.delete(e.barrierId);
    if (e.won) {
      this.audio.arenaWin?.();
      this.hud.caption('[ the blood-runes fade; the doors are open ]', 3000);
    } else {
      this.hud.banner('THE SIN WITHDRAWS', 'Everyone inside was taken. It waits in its Heart for the next of you.', 4500);
    }
  }

  /** A Keeper footstep (from its walk cycle): loud, heavy, and on the map. */
  onKeeperStep(a, hunting) {
    const c = this.controller;
    const d = a.floor === c.floor ? Math.hypot(a.x - c.x, a.z - c.z) : Infinity;
    this.audio.monsterStep(wpos(a.floor, a.x, a.z, 0.2), hunting);
    if (d <= FOOTSTEP_RANGE) {
      this.minimap.footstep(a.x, a.z, a.floor);
      // The floorboards tremble under you.
      this.tremor = Math.max(this.tremor, 0.25 + (1 - d / FOOTSTEP_RANGE) * 0.75 * (hunting ? 1.3 : 1));
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
          if (this.grappleStage()) { this.setGrapple(true); break; }
          if (this.target && !this.hud.journalOpen) {
            if (this.target.entity) this.net.emit('p:interact', { entityId: this.target.id });
            else this.net.emit('p:interact', { propId: this.target.id });
          }
          break;
        case 'KeyF':
          this.lumos = !this.lumos;
          this.hud.lumos(this.lumos);
          this.audio.lumos(this.lumos);
          break;
        case 'KeyR': {
          // R selects the Ultimate (the trigger fires it); at the Hell Portal it grapples.
          if (this.grappleStage()) { this.setGrapple(true); break; }
          const r = this.input.key('KeyR', { archon: this.archonMode() });
          if (r) this.select(r.slot);
          break;
        }
        case 'KeyV':
          this.castInvis();
          break;
        case 'KeyL':
          if (this.debug) this.net.emit('debug:arena', {});
          break;
        case 'KeyH':
          if (this.debug) this.net.emit('debug:finale');
          break;
        case 'KeyN':
          if (this.debug) this.net.emit('debug:portal');
          break;
        case 'KeyU':
          if (this.debug) this.net.emit('debug:ult');
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
        case 'KeyQ':
          this.castSelectedSpell(); // alternate trigger (headless tests have no pointer lock)
          break;
        case 'KeyP':
          if (this.debug) this.net.emit('debug:mode');
          break;
        case 'KeyK':
          if (this.debug) this.net.emit('debug:capture');
          break;
        case 'KeyG':
          this.net.emit('p:ping');
          break;
        default:
          if (/^Digit[1-7]$/.test(e.code) && e.shiftKey) {
            // Debug: Shift+1–7 hot-swaps your wizard.
            if (this.debug) this.net.emit('debug:wizard', { wizardId: WIZARDS[Number(e.code.slice(5)) - 1].id });
          } else {
            // 1–4 (or 1–7 as the Archon) only SELECT; the trigger fires.
            const r = this.input.key(e.code, { archon: this.archonMode() });
            if (r?.action === 'select') this.select(r.slot);
            else if (r?.action === 'select-mastery') this.hud.selectMastery?.(r.key);
          }
      }
    };
    this._onMouseDown = (e) => {
      if (e.button === 0 && this.controller.locked) this.castSelectedSpell();
    };
    this._onKeyUp = (e) => {
      if (e.code === 'KeyE' && this.channel) this.net.emit('p:cancel');
      if ((e.code === 'KeyE' || e.code === 'KeyR') && this.grappling) this.setGrapple(false);
    };
    $('btn-retry').onclick = () => this.net.emit('game:restart', { mode: 'phase' });
    $('btn-to-lobby').onclick = () => this.net.emit('game:restart', { mode: 'lobby' });
    this._unlockAudio = () => this.audio.unlock();
    window.addEventListener('keydown', this._unlockAudio);
    window.addEventListener('pointerdown', this._unlockAudio);
    this.controller.onStep = (info) => {
      this.audio.playerStep(this.controller.floor === FLOOR.BASEMENT, info.speed);
      // Footsteps under the Charm give you away (the server judges it).
    };
    this._onClick = () => {
      if (!this.hud.journalOpen && !this.epilogue) this.controller.lock();
    };
    this._onLockChange = () => {
      if (this.controller.locked) this.hidePause();
      else if (!this.hud.journalOpen && !this.gameIsOver) this.showPause('Paused');
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.canvas.addEventListener('click', this._onClick);
    document.addEventListener('mousedown', this._onMouseDown);
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
    if (this.epilogue) return; // nothing to pause: the ending plays on its own
    $('pause-title').textContent = title;
    $('pause').classList.remove('hidden');
  }

  hidePause() { $('pause').classList.add('hidden'); }

  // ---- per-frame --------------------------------------------------------------

  findTarget() {
    if (this.phase === PHASE.ARCHON) return null; // inside the Archon there is nothing to pick up
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
    // The Tree of Life
    for (const e of this.ents) {
      if (e.k !== 'tree' || e.f !== c.floor || !(e.n > 0)) continue;
      const d = Math.hypot(e.x - c.x, e.z - c.z);
      if (d > 3.1) continue;
      const score = d;
      if (!best || score < best.score) best = { p: { entity: true, id: e.id, kind: 'tree', n: e.n }, score };
    }
    return best?.p ?? null;
  }

  promptFor(p) {
    if (p.entity) return [`Eat a golden fruit (${p.n} left)`, false];
    switch (p.interact) {
      case 'tome': return this.tomeRead ? ['Open your journal', false] : ['Read the Forbidden Tome', true];
      case 'curio':
        if (this.heartIds.has(p.id) && !this.destroyed.has(p.id)) {
          return [[...this.arenas.values()].some((a) => a.heartPropId === p.id) ? null : 'Break open the Cursed Heart (it will release its Sin)', !!p];
        }
        return [`Examine the ${PROP_LABELS[p.kind] ?? p.kind}`, false];
      case 'task': {
        const t = TASKS[p.task];
        const st = this.propState[p.id];
        if (st?.done) return [`${t.done}`, false];
        if (t.turns) return [`${t.label} (${st?.turns ?? p.turns} more)`, true];
        return [t.label, true];
      }
      case 'stairs': return [p.label ?? (p.kind === 'stairs_down' ? 'Descend the stair' : 'Climb the stair'), false];
      case 'altar': return ['Approach the Ritual Altar', false];
      case 'gate': return this.propState[p.id]?.open ? [null, false] : ['Break the ritual lock', true];
      default: return [null, false];
    }
  }

  roomLabel(p) {
    return roomAt(this.map, p.f, p.x, p.z)?.name ?? (p.f === FLOOR.BASEMENT ? 'Basement passage' : p.f === FLOOR.UPPER ? 'Upper hallway' : 'Hallway');
  }

  frame(now) {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const c = this.controller;

    if (this.epilogue) {
      this.epilogue.update(dt);
      return;
    }
    this.renderer.info.reset();
    this.updateArchon(dt, now);
    c.update(dt);
    this.updateJumpscare(now);
    if (c.floor !== this.activeFloor) {
      this.activeFloor = c.floor;
      this.mansion.setActiveFloor(c.floor);
      this.visibleFloors = this.mansion.visibleFloors(c.floor);
    }

    // Camera shake (events), and the micro-tremor of the Keeper's footsteps.
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const s = this.shake * 0.02;
      this.camera.rotation.x += (Math.random() - 0.5) * s;
      this.camera.rotation.y += (Math.random() - 0.5) * s;
    }
    if (this.tremor > 0.01) {
      this.tremor = Math.max(0, this.tremor - dt * 2.2);
      const s = this.tremor * 0.006;
      this.camera.position.y += (Math.random() - 0.5) * s * 3;
      this.camera.rotation.z += (Math.random() - 0.5) * s;
    }

    // Wand light: a living, slightly unsteady flame.
    const flicker = 0.92 + Math.sin(this.time * 7.3) * 0.04 + Math.sin(this.time * 17.1) * 0.03 + (Math.random() - 0.5) * 0.03;
    const channelBoost = this.channel ? 1.4 + Math.sin(this.time * 28) * 0.15 : 1;
    // Lights Out: near the Amalgam the wand gutters; while it hunts, it cuts out.
    const am = this.monsters.get('amalgam');
    const amNear = am && !am.snap.hid && am.snap.f === c.floor;
    const amDist = amNear ? Math.hypot(am.x - c.x, am.z - c.z) : Infinity;
    const dread = this.archonMode() ? 0 : clamp01((15 - amDist) / 15); // the Archon is no one's prey
    let wandK = flicker;
    if (dread > 0) wandK *= Math.random() < dread * 0.18 ? 0.08 : 1 - dread * 0.35 * Math.random();
    if (amNear && am.snap.state === 'hunting' && amDist < 22 && !this.archonMode()) {
      if (now >= this.nextCutAt) {
        this.lightCutUntil = now + 300;
        this.nextCutAt = now + 900 + Math.random() * 1700;
      }
      if (now < this.lightCutUntil) wandK = 0.02;
    }
    // Lumos warns you: within 12u of a hunting Amalgam it strobes violently.
    if (this.lumos && amNear && am.snap.state === 'hunting' && amDist < 12) wandK *= Math.random() < 0.35 ? 0.05 : 0.6 + Math.random() * 0.6;
    const nulled = this.grimoire.inNullZone(c.floor, c.x, c.z);
    if (nulled) wandK = flicker; // Null Zone: the lights hold steady
    this.mansion.setDread(nulled || this.dawnK > 0.5 ? 0 : dread);
    this.applyLumos(wandK, channelBoost);
    if (this.jumpscare) this.fillLight.intensity = 5; // its face, lit from the front
    this.wandTipMat.color.set(this.wizard.color).multiplyScalar(this.lumos ? 1.6 : 1);
    this.updateWandAura(dt);
    this.updateInvis(now);
    this.applyBuffs(c, dt);
    this.applyEnvironment(dt);
    // Cast recoil: the wand kicks up and back, the tip and light flare in the element colour.
    this.recoil = Math.max(0, this.recoil - dt * 4);
    const r = this.recoil * this.recoil;
    this.wandRig.position.y = -0.2 + Math.sin(c.bobPhase * 2) * 0.006 + r * 0.03;
    this.wandRig.position.z = -0.36 + r * 0.09;
    this.wandRig.rotation.x = 0.12 + r * 0.45;
    this.wandTip.scale.setScalar(1 + r * 5);
    if (r > 0.01) {
      this.wandLight.intensity += WAND_INTENSITY * r * 1.5;
      this.wandTipMat.color.set(this.wizard.color).multiplyScalar(1 + r * 2);
    }

    for (const av of this.avatars.values()) {
      av.update(dt, this.time, this.camera, this.visibleFloors);
      if (this.archonMode()) { av.group.visible = false; if (av.light) av.light.intensity = 0; } // inside the Archon
    }
    for (const m of this.monsters.values()) m.update(dt, this.time, m instanceof SinDemonAvatar ? this.visibleFloors : c.floor);
    am?.setHeartsLit(HEART_COUNT - this.destroyed.size);
    this.updateSinHud();
    this.updateHorror(dt, now, c, am, amNear, amDist, nulled || this.dawnK > 0.5 ? 0 : dread, nulled);
    for (const m of this.monsters.values()) this.grimoire.monsterStatus(m, m.snap.st);
    this.updatePings(dt);

    // Void shields: one dome per shielded wizard, following them.
    for (const [id, p] of this.positions) {
      const self = id === this.selfId;
      const av = this.avatars.get(id);
      const x = self ? c.x : av?.x ?? p.x, z = self ? c.z : av?.z ?? p.z, f = self ? c.floor : p.f;
      this.fx.shield(id, !!p.sh && f === c.floor, x, FLOOR_Y[f], z);
      this.grimoire.aura(id, f === c.floor && !this.archonMode() ? p.bf ?? [] : [], x, FLOOR_Y[f], z, self, dt);
    }
    this.fx.update(dt, this.time);
    this.grimoire.update(dt, this.time, c.floor, this.localPos());
    this.hud.cooldowns(this.slotCd.map((cd) => ({ remaining: Math.max(0, (cd.readyAt - now) / 1000), duration: cd.duration })));
    this.hud.ult(this.ultCharge);
    this.hud.hp(this.archonMode() && this.fin?.ar ? (this.fin.ar.hp / this.fin.ar.max) * 100 : this.hp);
    this.updateFinaleHud(dt);
    this.hud.buffs(this.buffs);

    // Interaction
    this.target = this.hud.journalOpen ? null : this.findTarget();
    const [label, hold] = this.target ? this.promptFor(this.target) : [null, false];
    this.hud.prompt(this.channel ? null : label, hold);
    if (this.channel && Number.isFinite(this.channel.duration)) this.hud.progress((now - this.channel.start) / this.channel.duration);
    if (this.grappleStage()) this.hud.prompt(this.grappling ? 'Soul Grapple: dragging it toward the rift\u2026' : 'Soul Grapple: drag it into the rift', true);

    this.hud.stamina(c.stamina);
    const room = roomAt(this.map, c.floor, c.x, c.z);
    // The other story is only drawn where you can see it: from the Foyer, or the balcony.
    this.mansion.setOverlook(!!room && (room.id === this.map.ids.foyer || room.id === this.map.ids.gallery));
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
        li: this.lumos,
        mv: c.moving,
      });
    }

    this.mansion.update(this.time, dt, this.camera, this.lumos);

    // The Marauder's Map, top-left (~20 Hz).
    if ((this._mapAt ?? 0) <= this.time) {
      const mdt = this.time - (this._mapT ?? this.time);
      this._mapT = this.time;
      this._mapAt = this.time + 0.05;
      const others = [];
      for (const [id, p] of this.positions) {
        if (id === this.selfId) continue;
        const av = this.avatars.get(id);
        const w = WIZARD_BY_ID[this.roster.find((m) => m.id === id)?.wizardId];
        others.push({ x: av?.x ?? p.x, z: av?.z ?? p.z, f: p.f, yaw: p.yaw, color: w?.color ?? '#ddd', held: p.cap });
      }
      this.minimap.draw(mdt, this.time, { x: c.x, z: c.z, floor: c.floor, yaw: c.yaw }, others, [...this.arenas.values()]);
    }

    if (this.debug) {
      const me = { x: c.x, z: c.z, f: c.floor, yaw: c.yaw };
      const players = new Map(this.positions);
      players.set(this.selfId, me);
      this.debugMap.draw(c.floor, players, this.roster, this.heartIds, this.destroyed);
    }

    this.post.render(this.time);

    if (this.debug && (this._statsAt ?? 0) <= this.time) {
      this._statsAt = this.time + 0.25;
      const info = this.renderer.info.render;
      $('debug-stats').textContent =
        `${Math.round(1 / Math.max(dt, 1e-3))} fps · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · ` +
        `floor ${c.floor} · (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) · ${room?.name ?? 'hall'} · seed ${this.map.seed}`;
    }
  }

  // ---- horror layer --------------------------------------------------------------

  updateHorror(dt, now, c, am, amNear, amDist, dread, nulled = false) {
    // Terror: staring at it up close warps the view (a Null Zone shields you).
    let staring = false;
    if (amNear && amDist < 12 && !this.archonMode()) {
      const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
      const dx = am.x - c.x, dz = am.z - c.z;
      staring = (dx * fx + dz * fz) / Math.max(amDist, 1e-3) > 0.9 && lineOfSight(this.map, c.floor, c.x, c.z, am.x, am.z);
    }
    this.terror = nulled ? 0 : clamp01(this.terror + (staring ? dt * 0.45 : -dt * 0.3));
    this.chromaPulse = Math.max(0, this.chromaPulse - dt * 1.6);
    this.redPulse = Math.max(0, this.redPulse - dt * 0.7);
    const lunging = amNear && amDist < 6 && (am.snap.act === 'windup' || am.snap.act === 'lunge');

    const js = this.jumpscare ? (now - this.jumpscare.start) / 1000 : -1;
    const fov = 72 + this.terror * 9 + (js >= 0 && js < 0.85 ? 18 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }
    const tired = 1 - c.stamina / STAMINA.max;
    this.post.set({
      grain: 0.05 + this.terror * 0.18 + dread * 0.06 + (this.captured ? 0.05 : 0),
      vignette: clamp01(0.2 + dread * 0.45 + tired * 0.35 + this.terror * 0.2 + (this.captured ? 0.2 : 0)),
      chroma: 0.0012 + this.terror * 0.007 + this.chromaPulse * 0.012 + (lunging ? 0.012 : 0),
      warp: this.terror * 0.6,
      desat: this.captured ? 0.55 : this.terror * 0.25,
      red: this.redPulse * 0.8,
      black: js > 0.7 ? clamp01((js - 0.7) / 0.25) : 0,
    }, dt);

    this.audio.update(dt, { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z, fx: -Math.sin(c.yaw), fz: -Math.cos(c.yaw) }, {
      dist: amDist,
      hunting: amNear && am.snap.state === 'hunting' && am.snap.tg === this.selfId,
      stalking: amNear && am.snap.state === 'stalking',
    });

    // Disguised Hearts beat faintly when you're close (once the Tome has named them).
    if (this.time >= this.heartTellAt) {
      this.heartTellAt = this.time + 1.3;
      for (const id of this.heartIds) {
        if (this.destroyed.has(id)) continue;
        const prop = this.map.props[id];
        if (prop.floor !== c.floor) continue;
        const d = Math.hypot(prop.x - c.x, prop.z - c.z);
        if (d < 7) this.audio.heartTell(wpos(prop.floor, prop.x, prop.z, 1.4), (1 - d / 7) * 0.8);
      }
    }
    // Grinding metal while you work the Cell's lock.
    if (this.channel && this.channel.propId === this.map.ids.gate && this.time >= this.scrapeAt) {
      this.scrapeAt = this.time + 0.35;
      const gate = this.map.props[this.map.ids.gate];
      this.audio.lockScrape(wpos(gate.floor, gate.x, gate.z));
    }
  }

  /** Nox: the plain narrow wand glow. Lumos: a bright, wide crystalline torch. */
  applyLumos(wandK, channelBoost) {
    const L = this.wandLight;
    const on = this.lumos;
    const k = Math.min(1, this.lumosK = (this.lumosK ?? 0) + ((on ? 1 : 0) - (this.lumosK ?? 0)) * 0.2);
    L.angle = 0.44 + (LUMOS.angle - 0.44) * k;
    L.distance = 30 - (30 - LUMOS.range) * k;
    L.penumbra = 0.6 + 0.2 * k;
    L.color.set(this.wizard.lightTint).lerp(LUMOS_COLOR, k);
    L.intensity = (WAND_INTENSITY + (170 - WAND_INTENSITY) * k) * wandK * channelBoost;
    this.fillLight.intensity = (1.4 + 3 * k) * wandK;
    this.fillLight.distance = 5 + 5 * k;
  }

  /** Spell buffs on yourself: speed, phasing, tireless sprinting. */
  applyBuffs(c) {
    const b = this.buffs;
    const sloth = b.includes('sloth');
    c.speedMul = (1 + (b.includes('shadow') ? 0.4 : 0) + (b.includes('tailwind') ? 0.45 : 0) + (b.includes('phoenix') && c.sprinting ? 0.3 : 0)) *
      (this.archonMode() ? FINALE.ARCHON_SPEED : 1) * (sloth ? 1 - SINS.sloth.aura.slow : 1);
    c.fatigue = sloth ? SINS.sloth.aura.drain : 0;
    c.ignoreProps = b.includes('shadow');
    c.noStamina = b.includes('tailwind');
  }

  /** Dawn of the Sacred Order (golden cathedral light) and the Abyssal Deluge. */
  applyEnvironment(dt) {
    this.dawnK += ((this.dawnActive ? 1 : 0) - this.dawnK) * Math.min(1, dt * 1.2);
    const k = this.dawnK;
    this.hemi.intensity = 0.35 + k * 2.6;
    this.hemi.color.copy(NIGHT_SKY).lerp(DAWN_SKY, k);
    this.hemi.groundColor.copy(NIGHT_GROUND).lerp(DAWN_GROUND, k);
    this.scene.fog.density = 0.075 - k * 0.063;
    this.renderer.toneMappingExposure = 1.15 + k * 0.2;
    if (this.flooded !== this._wasFlooded) {
      this._wasFlooded = this.flooded;
      this.grimoire.setFlood(this.flooded, this.map);
      this.audio.setFlooded(this.flooded);
    }
  }

  makePhantom(spot, floor) {
    const av = new AmalgamAvatar({ id: 'phantom', x: spot.x, z: spot.z, f: floor, yaw: spot.yaw, st: [], state: 'stalking', act: 'peek', mv: false, hid: false, hp: 0, maxHp: 0 },
      { map: this.map, fx: this.fx, debug: false });
    av.ghostify();
    this.scene.add(av.group);
    return {
      setOpacity: (v) => av.setOpacity(v),
      update: (dt, t) => av.update(dt, t, this.controller.floor),
      dispose: () => { this.scene.remove(av.group); av.dispose(); },
    };
  }

  /**
   * The Scary Capture Screen (1.5s): the camera snaps into the Amalgam's
   * unhinged, screaming skull; blood-red glyphs flash; the screen shakes
   * violently; a multi-layered distorted shriek. Then black, and you wake up
   * in the Underground Iron Cage.
   */
  startJumpscare(e) {
    this.jumpscare = { ...e, start: performance.now(), duration: (e.duration ?? 1.5) * 1000 };
    this.controller.enabled = false;
    this.channel = null;
    this.hud.progress(null);
    this.audio.jumpscare(true);
    this.redPulse = 1;
    this.chromaPulse = 2;
    this.shake = 1.5;
    this.hud.captureScreen(true);
    const am = this.monsters.get('amalgam');
    if (am) {
      am.x = e.mx;
      am.z = e.mz;
      am.yaw = e.myaw;
      am.force('scream', (e.duration ?? 1.5) + 0.2);
    }
  }

  updateJumpscare(now) {
    const js = this.jumpscare;
    if (!js) return;
    const k = (now - js.start) / 1000;
    const dur = js.duration / 1000;
    const am = this.monsters.get('amalgam');
    if (am && k < dur - 0.2) {
      const face = am.face(this._face ??= new THREE.Vector3());
      const fx = -Math.sin(js.myaw), fz = -Math.cos(js.myaw);
      // Snapped into its skull: arm's length to inches away, jolting violently.
      const dist = 0.8 - Math.min(1, k / 0.5) * 0.45;
      const jolt = 0.04 + Math.max(0, 1 - k / dur) * 0.08;
      this.camera.position.set(face.x + fx * dist + (Math.random() - 0.5) * jolt, face.y - 0.06 + (Math.random() - 0.5) * jolt, face.z + fz * dist);
      this.camera.lookAt(face);
      this.camera.rotation.z += (Math.random() - 0.5) * 0.12;
      // Light the face from the front (the wand light points the wrong way here).
      this.fillLight.position.set(0, 0.15, -0.05);
      this.fillLight.intensity = 6 + Math.random() * 6;
    }
    if (k > dur - 0.05) this.hud.captureScreen(false);
    if ((k > dur + 0.15 && this.captured) || k > dur + 2.5) {
      this.jumpscare = null;
      this.hud.captureScreen(false);
      this.fillLight.position.set(0.1, -0.05, -1.2);
      this.controller.enabled = !this.gameIsOver;
    }
  }

  /** The wand tip previews what the trigger will cast: brighter, bigger and gold for the Ultimate. */
  updateWandAura(dt) {
    const a = this.wandAura;
    let color = this.wizard.color, size = 0.045, pulse = 4, op = 0.45;
    if (this.archonMode()) {
      const M = MASTERIES.find((m) => m.key === this.input.mastery);
      color = this.input.archonPick === 'ult' ? '#ffd76a' : M?.color ?? color;
      size = 0.07;
      pulse = 7;
      op = 0.7;
    } else if (this.selected === 'ult') {
      const ready = this.ultCharge >= 100;
      color = ready ? '#ffd76a' : '#a08a50';
      size = ready ? 0.09 : 0.05;
      pulse = ready ? 9 : 2;
      op = ready ? 0.85 : 0.35;
    } else {
      size = 0.04 + this.selected * 0.006;
      pulse = 3 + this.selected * 1.5;
    }
    const k = 0.85 + Math.sin(this.time * pulse) * 0.15;
    a.material.color.set(color);
    a.material.opacity = op * k * (1 - this.invisK * 0.7);
    a.scale.setScalar(size * k * (1 + this.recoil * 0.8));
    this.wandTipMat.color.set(color);
    // Dust in your own Lumos beam.
    this.motes.material.opacity += ((this.lumos ? 0.55 : 0) - this.motes.material.opacity) * Math.min(1, dt * 4);
    if (this.motes.material.opacity > 0.01) {
      const pos = this.motes.geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i] += Math.sin(this.time * 0.4 + i) * 0.0015;
        pos[i + 1] += dt * 0.03 * ((i % 7) - 3) * 0.3;
        if (pos[i + 1] > 1) pos[i + 1] = -1;
        if (pos[i + 1] < -1) pos[i + 1] = 1;
      }
      this.motes.geometry.attributes.position.needsUpdate = true;
    }
  }

  /** The Disillusionment Charm on yourself: glassy hands, a chameleon shimmer, the HUD timer. */
  updateInvis(now) {
    const active = now < this.invisUntil && !this.captured;
    this.invisK = (this.invisK ?? 0) + ((active ? 1 : 0) - (this.invisK ?? 0)) * 0.15;
    const alpha = 1 - this.invisK * (0.8 - Math.sin(this.time * 6) * 0.08);
    for (const m of this.handMats) {
      m.transparent = this.invisK > 0.01;
      m.opacity = alpha;
    }
    this.hud.invis(active, Math.max(0, (this.invisUntil - now) / 1000), Math.max(0, (this.invisReadyAt - now) / 1000));
  }

  /** In a Sin's arena: its name and health across the top. */
  updateSinHud() {
    const c = this.controller;
    const room = roomAt(this.map, c.floor, c.x, c.z);
    const arena = room && [...this.arenas.values()].find((a) => a.roomId === room.id && a.floor === c.floor);
    const av = arena && this.monsters.get(arena.demonId);
    this.sinBarActive = !!av && !av.snap.dead;
    if (!this.sinBarActive) return;
    const S = SINS[av.sin];
    this.hud.boss(av.snap.hp, av.snap.maxHp, false, S.blurb, `${S.name.toUpperCase()} · ${S.title.toUpperCase()}`, S.color);
  }

  addPing(e) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const ctx = c.getContext('2d');
    ctx.textAlign = 'center';
    ctx.font = 'bold 54px Cinzel, Georgia, serif';
    ctx.fillStyle = e.captured ? '#ff3a3a' : '#ffd76a';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 10;
    ctx.fillText('!', 128, 52);
    ctx.font = '22px Georgia, serif';
    ctx.fillText(e.name, 128, 86);
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(1.6, 0.6, 1);
    sprite.position.set(e.x, FLOOR_Y[e.floor] + 2.4, e.z);
    sprite.renderOrder = 1001;
    this.scene.add(sprite);
    this.pings.push({ sprite, tex, age: 0, floor: e.floor });
    this.audio.ping(wpos(e.floor, e.x, e.z, 1.6));
    if (e.id !== this.selfId) {
      const where = roomAt(this.map, e.floor, e.x, e.z)?.name ?? (e.floor === 1 ? 'the basement' : 'a hallway');
      this.hud.whisper(e.captured ? `${e.name} cries out from the Ritual Cell!` : `${e.name} calls from ${where}.`);
    }
  }

  updatePings(dt) {
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.age += dt;
      p.sprite.visible = p.floor === this.controller.floor;
      p.sprite.material.opacity = clamp01(1 - (p.age - 4) / 2) * (0.7 + Math.sin(p.age * 8) * 0.3);
      if (p.age > 6) {
        this.scene.remove(p.sprite);
        p.tex.dispose();
        p.sprite.material.dispose();
        this.pings.splice(i, 1);
      }
    }
  }

  // ---- Phase III: the Archon ---------------------------------------------------------

  archonMode() { return !!this.fin?.ar && this.phase === PHASE.ARCHON && performance.now() >= this.mergeUntil; }
  grappleStage() { return this.archonMode() && this.fin?.stage === 'portal'; }

  setGrapple(on) {
    if (on === this.grappling) return;
    this.grappling = on;
    this.net.emit('p:grapple', { on });
  }

  /** Soul Merge: ribbons spiral out of every wizard into the altar; then you are the Archon. */
  startMerge(e) {
    const c = this.controller;
    const sources = [{ x: c.x, z: c.z }];
    for (const av of this.avatars.values()) if (av.floor === e.floor) sources.push({ x: av.x, z: av.z });
    this.finaleFx.merge(e, sources);
    this.audio.mergeSound();
    this.audio.chant(0);
    this.hud.banner('SOUL MERGE', 'Seven elements. One body. You are THE ARCHON.', e.duration * 1000 + 1500);
    this.hud.screen('white', 0.6);
    this.mergeUntil = performance.now() + e.duration * 1000;
    this.channel = null;
    this.hud.progress(null);
    this.mergeCenter = { x: e.x, z: e.z };
    c.setPosition(e.ax, e.az, e.floor, e.yaw);
    c.enabled = true;
  }

  updateArchon(dt, now) {
    const c = this.controller;
    const A = this.fin?.ar;
    const inArchon = !!A && this.phase === PHASE.ARCHON;
    document.body.classList.toggle('archon', inArchon);
    if (!inArchon) {
      c.rideOnly = false;
      c.eyeOverride = null;
      return;
    }
    const merging = now < this.mergeUntil;
    c.eyeOverride = merging ? null : FINALE.ARCHON_EYE;
    const driver = A.drv === this.selfId;
    c.rideOnly = merging || !driver;
    if (c.rideOnly) {
      // Passengers ride the Archon: follow its position, look wherever they like.
      const k = 1 - Math.exp(-dt * 12);
      c.x += (A.x - c.x) * k;
      c.z += (A.z - c.z) * k;
      c.floor = A.f;
    }
    if (merging && this.mergeCenter) {
      // The cinematic: eyes drawn up into the light over the altar.
      const want = Math.atan2(-(this.mergeCenter.x - c.x), -(this.mergeCenter.z - c.z));
      const k = 1 - Math.exp(-dt * 5);
      c.yaw += Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw)) * k;
      c.pitch += (0.32 - c.pitch) * k;
    }
    if (!merging) this.finaleFx.attachCrown(this.camera);
    this.finaleFx.updateCrown(this.time, this.fin.mr);
  }

  updateFinaleHud(dt) {
    const f = this.fin;
    // The Forbidden Spell
    if (this.phase === PHASE.CONVERGENCE && f) {
      const total = this.positions.size || 1;
      const altarId = this.map.ids.altar;
      const voices = [...this.positions.values()].filter((p) => p.ch === altarId).length;
      this.hud.ritual(f.rt, voices === total
        ? 'Every voice joins the chant\u2026'
        : `${voices} of ${total} voices. Every wizard must hold E at the altar.`);
      this.audio.chant(voices ? 0.3 + f.rt * 0.7 : 0);
      this.finaleFx.ritual(this.map.props[altarId], f.rt, voices, dt);
    } else {
      this.hud.ritual(null);
    }
    if (this.archonMode() && f?.boss) {
      const stageText = { boss: 'Break its body. Survive its fury.', portal: 'The rift is open: bind it, shove it, DRAG IT UNDER.', sealing: 'It is going under\u2026' }[f.stage] ?? '';
      this.hud.boss(f.boss.hp, f.boss.max, f.boss.ward, `${stageText}  ·  Archon ${f.ar.hp}/${f.ar.max}`);
      this.hud.masteries(MASTERIES, f.mr, this.input.archonPick === 'mastery' ? this.input.mastery : null);
      const am = this.monsters.get('amalgam');
      this.finaleFx.bossDecor(am, f.boss.ward, this.time, f.seal);
      this.finaleFx.orbs(f.orbs ?? [], f.ar.f);
      this.finaleFx.wave(f.wave, f.ar.f);
    } else {
      if (!this.sinBarActive) this.hud.boss(null);
      this.hud.masteries(null);
    }
    this.finaleFx.update(dt, this.time, this.controller.floor);
  }

  /** Phase IV. */
  startEpilogue(e) {
    this.setGrapple(false);
    this.hud.hide();
    this.hud.boss(null);
    this.hud.masteries(null);
    document.body.classList.remove('archon');
    document.exitPointerLock?.();
    this.hidePause();
    this.controller.enabled = false;
    this.epilogue = new Epilogue({
      renderer: this.renderer,
      gameScene: this.scene,
      camera: this.camera,
      map: this.map,
      mansion: this.mansion,
      coven: e.coven,
      isHost: e.hostId === this.selfId,
      audio: this.audio,
      onPlayAgain: () => this.net.emit('game:restart', { mode: 'again' }),
      onReturn: () => this.net.emit('game:restart', { mode: 'lobby' }),
      hideHorror: () => this.restoreDaylight(),
    });
  }

  /** The horror lifts: no monster, no fog, warm morning light everywhere. */
  restoreDaylight() {
    for (const m of this.monsters.values()) m.group.visible = false;
    for (const av of this.avatars.values()) av.group.visible = false;
    this.finaleFx.dispose();
    if (this.finaleFx.crown) this.finaleFx.crown.visible = false;
    this.wandRig.visible = false;
    this.wandLight.intensity = 0;
    this.fillLight.intensity = 0;
    for (const l of this.remoteLights) l.intensity = 0;
    this.mansion.setDread(0);
    this.hemi.intensity = 2.6;
    this.hemi.color.set(0xffe8c0);
    this.hemi.groundColor.set(0x8a6a40);
    this.scene.fog = new THREE.FogExp2(0xf3dcb2, 0.012);
    this.scene.background = new THREE.Color(0xf3dcb2);
    this.renderer.toneMappingExposure = 1.3;
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.epilogue?.dispose();
    document.body.classList.remove('archon');
    window.removeEventListener('keydown', this._unlockAudio);
    window.removeEventListener('pointerdown', this._unlockAudio);
    this.audio.dispose();
    this.post.dispose();
    this.hud.gameOver(false);
    for (const [ev, fn] of Object.entries(this.handlers)) this.net.off(ev, fn);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('click', this._onClick);
    document.removeEventListener('mousedown', this._onMouseDown);
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
