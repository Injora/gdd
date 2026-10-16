// Step 9: the third-person vanity camera (C). Pure logic, no imports, so the
// node tests can drive it.
//
// Over the shoulder while you move (behind, a little up and to the right,
// following your aim); stand still for ORBIT_AFTER seconds and it starts a
// slow orbit round your wizard so you can admire the coat; move again and it
// eases back over your shoulder. A wall between you and the camera pulls it in.

export const VANITY = {
  distance: 2.4, // behind you
  height: 0.32, // above your eyes
  shoulder: 0.5, // to the right
  orbitAfter: 2.5, // seconds standing still before it starts to circle
  orbitSpeed: 0.45, // radians per second
  minDistance: 0.6,
};

export class VanityCam {
  constructor() {
    this.on = false;
    this.idle = 0;
    this.orbit = 0;
  }

  toggle(on = !this.on) {
    this.on = on;
    this.idle = 0;
    this.orbit = 0;
    return this.on;
  }

  /**
   * @param pose { x, y (eye height, world), z, yaw, pitch, moving }
   * @param clear optional (x0, z0, x1, z1) => boolean: is the line of sight open?
   * @returns { x, y, z, lookX, lookY, lookZ, distance }
   */
  update(dt, pose, clear = null) {
    this.idle = pose.moving ? 0 : this.idle + dt;
    if (this.idle > VANITY.orbitAfter) this.orbit += dt * VANITY.orbitSpeed;
    else {
      // Ease back behind the shoulder (the short way round).
      const wrapped = Math.atan2(Math.sin(this.orbit), Math.cos(this.orbit));
      this.orbit = wrapped * Math.max(0, 1 - dt * 3);
    }
    const a = pose.yaw + this.orbit;
    const shoulder = VANITY.shoulder * Math.cos(this.orbit); // fades out as it circles round
    // Behind = minus forward; forward is (-sin a, -cos a). Right is (cos a, -sin a).
    const bx = Math.sin(a), bz = Math.cos(a);
    const rx = Math.cos(a), rz = -Math.sin(a);
    let d = VANITY.distance;
    const at = (dist) => ({ x: pose.x + bx * dist + rx * shoulder * (dist / VANITY.distance), z: pose.z + bz * dist + rz * shoulder * (dist / VANITY.distance) });
    if (clear) {
      while (d > VANITY.minDistance && !clear(pose.x, pose.z, at(d).x, at(d).z)) d -= 0.2;
    }
    const p = at(d);
    const y = pose.y + VANITY.height - (pose.pitch ?? 0) * 0.9 * (this.idle > VANITY.orbitAfter ? 0.3 : 1);
    return {
      x: p.x, y, z: p.z,
      lookX: pose.x + -Math.sin(pose.yaw) * 2 * (this.idle > VANITY.orbitAfter ? 0 : 1),
      lookY: pose.y - 0.1 + Math.sin(pose.pitch ?? 0) * 1.5 * (this.idle > VANITY.orbitAfter ? 0 : 1),
      lookZ: pose.z + -Math.cos(pose.yaw) * 2 * (this.idle > VANITY.orbitAfter ? 0 : 1),
      distance: d,
    };
  }
}
