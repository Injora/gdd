// First-person movement for the local wizard: pointer-lock mouse look, WASD,
// sprint with stamina, crouch, head bob, and collision via shared/collision.js.
// The client predicts its own movement; the server only bounds-checks it.

import { moveCircle } from '/shared/collision.js';
import { SPEED, STAMINA, PLAYER_RADIUS, EYE_HEIGHT, CROUCH_EYE_HEIGHT, FLOOR_Y } from '/shared/constants.js';

const MOVE_KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
};

export class FirstPersonController {
  constructor(camera, dom, world, start) {
    this.camera = camera;
    camera.rotation.order = 'YXZ';
    this.dom = dom;
    this.world = world;
    this.x = start.x;
    this.z = start.z;
    this.floor = start.floor;
    this.yaw = start.yaw;
    this.pitch = 0;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    this.stamina = STAMINA.max;
    this.crouchToggle = false;
    this.crouch = false;
    this.sprinting = false;
    this.moving = false;
    this.eye = EYE_HEIGHT;
    this.bobPhase = 0;
    this.enabled = true;
    this.sensitivity = 0.0022;
    // Spell buffs (set by the game each frame)
    this.speedMul = 1; // Shadow Step / Tailwind / Phoenix
    this.noStamina = false; // Tailwind: sprint without tiring
    this.ignoreProps = false; // Shadow Step: through furniture
    this.rideOnly = false; // inside the Archon as a passenger: look, don't walk
    this.eyeOverride = null; // the Archon's towering eye height
    this.keys = new Set();
    this.onStep = null; // (info) => void, fired at each footfall

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC' && this.enabled) this.crouchToggle = !this.crouchToggle;
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();
    this._onMouse = (e) => {
      if (!this.locked || !this.enabled) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('mousemove', this._onMouse);
  }

  get locked() { return document.pointerLockElement === this.dom; }

  lock() {
    try {
      const p = this.dom.requestPointerLock?.();
      p?.catch?.(() => {});
    } catch { /* pointer lock unavailable */ }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('mousemove', this._onMouse);
  }

  setPosition(x, z, floor, yaw) {
    this.x = x;
    this.z = z;
    this.floor = floor;
    if (yaw !== undefined) this.yaw = yaw;
    this.vx = this.vz = 0;
  }

  held(name) { return MOVE_KEYS[name].some((k) => this.keys.has(k)); }

  update(dt) {
    const on = this.enabled && !this.rideOnly;
    const f = on ? (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0) : 0;
    const s = on ? (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0) : 0;

    this.crouch = on && (this.crouchToggle || this.keys.has('ControlLeft') || this.keys.has('ControlRight'));
    const wantSprint = on && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && f > 0 && !this.crouch;
    if (wantSprint && this.stamina > 0 && (this.sprinting || this.stamina > STAMINA.minToSprint)) {
      this.sprinting = true;
      this.crouchToggle = false;
    } else {
      this.sprinting = false;
    }
    if (this.sprinting && this.moving && !this.noStamina) this.stamina = Math.max(0, this.stamina - STAMINA.drain * dt);
    else this.stamina = Math.min(STAMINA.max, this.stamina + STAMINA.regen * dt * (this.moving ? 0.6 : 1));

    const maxSpeed = (this.crouch ? SPEED.crouch : this.sprinting ? SPEED.sprint : SPEED.walk) * this.speedMul;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * f + cos * s;
    let wz = -cos * f - sin * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const accel = wl > 0 ? 10 : 12;
    this.vx += (wx * maxSpeed - this.vx) * Math.min(1, dt * accel);
    this.vz += (wz * maxSpeed - this.vz) * Math.min(1, dt * accel);

    const before = { x: this.x, z: this.z };
    const r = moveCircle(this.world, this.floor, this.x, this.z, this.vx * dt, this.vz * dt, PLAYER_RADIUS, { ignoreProps: this.ignoreProps });
    this.x = r.x;
    this.z = r.z;
    const actual = dt > 0 ? Math.hypot(r.x - before.x, r.z - before.z) / dt : 0;
    this.speed = actual;
    this.moving = actual > 0.3;

    // Eye height + head bob
    const targetEye = this.eyeOverride ?? (this.crouch ? CROUCH_EYE_HEIGHT : EYE_HEIGHT);
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);
    const prevPhase = this.bobPhase;
    this.bobPhase += actual * dt * (this.sprinting ? 2.3 : 2.0);
    if (Math.floor(prevPhase / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) {
      this.onStep?.({ sprinting: this.sprinting, crouch: this.crouch, speed: actual });
    }
    const amp = Math.min(1, actual / SPEED.walk) * (this.sprinting ? 1.6 : this.crouch ? 0.5 : 1);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.06 * amp;
    const bobX = Math.sin(this.bobPhase) * 0.025 * amp;

    this.camera.position.set(
      this.x + cos * bobX,
      FLOOR_Y[this.floor] + this.eye + bobY - 0.03 * amp,
      this.z - sin * bobX,
    );
    this.camera.rotation.set(this.pitch, this.yaw, -bobX * 0.4);
  }
}
