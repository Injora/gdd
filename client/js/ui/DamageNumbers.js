// Step 7: damage numbers in the caster's element colour, floating up and away
// from the centre of the screen (so a hit on your left drifts left). A pooled
// DOM layer over the canvas, projected from world space every frame.

import * as THREE from 'three';

export const ELEMENT_HEX = {
  black: '#b07aff', fire: '#ff8a3a', water: '#6ad0ff', earth: '#b8d070', wind: '#9ef0e0',
  white: '#fff1b0', void: '#ff4a5a', sin: '#ff4040',
};
const LIFE = 1.15;
const MAX = 40;

export class DamageNumbers {
  constructor(parent) {
    this.root = document.createElement('div');
    this.root.className = 'dmg-layer';
    parent.appendChild(this.root);
    this.items = [];
    this.v = new THREE.Vector3();
  }

  /** A hit of `amount` from `source` (an element) at world (x, y, z). */
  spawn(x, y, z, amount, source, camera) {
    if (this.items.length >= MAX) this.remove(0);
    const el = document.createElement('span');
    const big = amount >= 18;
    el.className = `dmg${big ? ' big' : ''}`;
    el.textContent = Math.round(amount);
    el.style.color = ELEMENT_HEX[source] ?? '#ff6a6a';
    this.root.appendChild(el);
    // Drift away from the screen centre, and up.
    const p = this.v.set(x, y, z).project(camera);
    const side = Math.abs(p.x) < 0.05 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(p.x);
    this.items.push({ el, x, y, z, age: 0, vx: side * (40 + Math.random() * 50), vy: -(70 + Math.random() * 30), big });
  }

  remove(i) {
    this.items[i].el.remove();
    this.items.splice(i, 1);
  }

  update(dt, camera, w, h) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      d.age += dt;
      const p = this.v.set(d.x, d.y, d.z).project(camera);
      if (d.age > LIFE || p.z > 1) { this.remove(i); continue; }
      const k = d.age / LIFE;
      const sx = (p.x * 0.5 + 0.5) * w + d.vx * d.age;
      const sy = (-p.y * 0.5 + 0.5) * h + d.vy * d.age + 60 * d.age * d.age; // up, then falling away
      const pop = d.age < 0.12 ? 0.6 + (d.age / 0.12) * (d.big ? 0.9 : 0.6) : (d.big ? 1.5 : 1.2) - Math.min(0.3, (d.age - 0.12) * 0.6);
      d.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      d.el.style.opacity = String(Math.min(1, (1 - k) * 2));
    }
  }

  clear() {
    while (this.items.length) this.remove(0);
  }
}
