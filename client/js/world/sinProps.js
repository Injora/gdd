// Step 7: models for the Seven Hearts and their thematic room tasks, plus the
// items a wizard carries (a gold ingot, a rotting platter). Plugged into the
// prop kit by props.js; same conventions: face +Z, origin on the floor.
//
// Task props expose userData.setState(st) for the server's prop state
// ({done}, {taken}, {count}); Hearts pulse in their Sin's colour once known.

import * as THREE from 'three';

export const SIN_COLORS = {
  pride: 0xdfe8ff, greed: 0xffc23a, lust: 0xff5fb4, envy: 0x6dff9a, gluttony: 0xa6e22e, wrath: 0xff2a1a, sloth: 0x8f9bb8,
};

/**
 * @param h { G, box, cyl, sph, glow, std, M, heartbeat, getPortrait }
 * @returns { builders (keyed by prop kind), carry: { ingot(), platter() } }
 */
export function sinBuilders(h) {
  const { G, box, cyl, sph, glow, std, M, heartbeat, getPortrait } = h;
  const gold = std(0xc8a040, 0.25, 0.9);
  const silver = std(0xb8bcc4, 0.3, 0.9);
  const bronze = std(0x7a5224, 0.35, 0.85);
  const marble = std(0xe6e0d6, 0.35);
  const brick = std(0x3a1e16, 0.95);

  /** A glowing heart-shaped gem: the Heart itself, in its Sin's colour. */
  const heartGem = (g, x, y, z, color, scale = 1) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.1);
    shape.bezierCurveTo(-0.02, -0.06, -0.11, -0.02, -0.1, 0.04);
    shape.bezierCurveTo(-0.09, 0.1, -0.02, 0.1, 0, 0.05);
    shape.bezierCurveTo(0.02, 0.1, 0.09, 0.1, 0.1, 0.04);
    shape.bezierCurveTo(0.11, -0.02, 0.02, -0.06, 0, -0.1);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }).translate(0, 0, -0.025);
    const mat = std(0x300406, 0.25, 0.2, { emissive: color, emissiveIntensity: 0.15 });
    const gem = new THREE.Mesh(geo, mat);
    gem.position.set(x, y, z);
    gem.scale.setScalar(scale);
    g.add(gem);
    const halo = glow(g, x, y, z + 0.05, color, 0.5 * scale, true);
    halo.material.opacity = 0;
    return { gem, mat, halo };
  };
  /** Heart animator: dim until the Tome names it, then a steady heartbeat. */
  const heartFx = (g, parts, extra) => {
    g.userData.fx = (t, ctx) => {
      const beat = ctx.isHeart ? heartbeat(t) : 0;
      parts.mat.emissiveIntensity = ctx.isHeart ? 0.5 + beat * 1.8 : 0.15;
      parts.halo.material.opacity = ctx.isHeart ? 0.25 + beat * 0.6 : 0;
      parts.gem.rotation.y = Math.sin(t * 0.7) * 0.4;
      extra?.(t, ctx, beat);
    };
  };

  const builders = {
    // ===================================================================== Hearts
    crowned_vanity() {
      // Pride: a white-and-gold vanity, an oval mirror, a crown above it.
      const g = G();
      box(g, 1.3, 0.8, 0.6, marble, 0, 0.4, -0.02);
      for (const sx of [-1, 1]) box(g, 0.36, 0.3, 0.02, gold, sx * 0.4, 0.5, 0.29);
      box(g, 1.36, 0.05, 0.64, gold, 0, 0.82, -0.02);
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 40), gold);
      frame.scale.y = 1.35;
      frame.position.set(0, 1.55, -0.2);
      g.add(frame);
      const glassMat = M.glass.clone();
      glassMat.emissive = new THREE.Color(SIN_COLORS.pride);
      glassMat.emissiveIntensity = 0.02;
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.41, 40), glassMat);
      glass.scale.y = 1.35;
      glass.position.set(0, 1.55, -0.19);
      g.add(glass);
      const crown = G();
      crown.position.set(0, 2.18, -0.2);
      cyl(crown, 0.16, 0.14, 0.1, gold, 0, 0, 0, 16);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 4), gold);
        spike.position.set(Math.cos(a) * 0.15, 0.1, Math.sin(a) * 0.15);
        crown.add(spike);
        sph(crown, 0.016, std(0x8090ff, 0.1, 0.3, { emissive: 0x3040a0 }), Math.cos(a) * 0.155, 0.0, Math.sin(a) * 0.155, 6);
      }
      g.add(crown);
      const heart = heartGem(g, 0, 1.55, -0.15, SIN_COLORS.pride, 1.4);
      heartFx(g, heart, (t, ctx, beat) => {
        glassMat.emissiveIntensity = ctx.isHeart ? 0.05 + beat * 0.25 : 0.02;
        crown.rotation.y = t * 0.3;
      });
      return g;
    },
    vault_coffer() {
      // Greed: an iron-banded coffer spilling gold, its lid ajar on a golden glow.
      const g = G();
      box(g, 0.85, 0.5, 0.6, M.woodRed, 0, 0.25, 0);
      for (const x of [-0.3, 0, 0.3]) box(g, 0.05, 0.52, 0.62, M.iron, x, 0.26, 0);
      const lid = G();
      lid.position.set(0, 0.5, -0.3);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.85, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), M.woodRed);
      top.position.set(0, 0, 0.3);
      lid.add(top);
      lid.rotation.x = -0.6;
      g.add(lid);
      box(g, 0.12, 0.14, 0.03, M.brass, 0, 0.4, 0.31);
      const pile = G();
      for (let i = 0; i < 26; i++) {
        const c = cyl(pile, 0.04, 0.04, 0.012, gold, (Math.random() - 0.5) * 0.7, 0.5 + Math.random() * 0.06, (Math.random() - 0.5) * 0.4, 10);
        c.rotation.set(Math.random() * 0.6, 0, Math.random() * 0.6);
      }
      for (let i = 0; i < 9; i++) {
        const c = cyl(pile, 0.04, 0.04, 0.012, gold, (Math.random() - 0.5) * 1.1, 0.008, 0.35 + Math.random() * 0.3, 10);
        c.rotation.y = Math.random() * 3;
      }
      g.add(pile);
      const inner = glow(g, 0, 0.62, 0, SIN_COLORS.greed, 0.9, true);
      const heart = heartGem(g, 0, 0.72, 0.02, SIN_COLORS.greed, 1.1);
      heartFx(g, heart, (t, ctx, beat) => { inner.material.opacity = 0.25 + (ctx.isHeart ? beat * 0.5 : 0); });
      return g;
    },
    velvet_portrait() {
      // Lust: a seductive portrait between drawn velvet curtains (on a wall).
      const g = G();
      const y = 1.9;
      box(g, 1.3, 1.6, 0.08, M.goldFrame, 0, y, 0);
      const mat = new THREE.MeshStandardMaterial({ map: getPortrait(5, false), roughness: 0.7, emissive: new THREE.Color(SIN_COLORS.lust), emissiveIntensity: 0.02 });
      const canvas = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.38), mat);
      canvas.position.set(0, y, 0.045);
      g.add(canvas);
      const velvet = std(0x5a0a2a, 0.95);
      for (const sx of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 2.2, 10, 1, true, 0, Math.PI), velvet);
        c.position.set(sx * 0.78, y - 0.1, 0.1);
        c.rotation.y = sx > 0 ? Math.PI : 0;
        g.add(c);
      }
      box(g, 1.9, 0.08, 0.1, gold, 0, y + 1.05, 0.12);
      const heart = heartGem(g, 0, y + 0.95, 0.12, SIN_COLORS.lust, 1.1);
      heartFx(g, heart, (t, ctx, beat) => { mat.emissiveIntensity = ctx.isHeart ? 0.05 + beat * 0.2 : 0.02; });
      return g;
    },
    astrolabe_clock() {
      // Envy: a brass astrolabe of nested rings around a green, watching eye.
      const g = G();
      cyl(g, 0.3, 0.38, 0.12, M.stoneDark, 0, 0.06, 0, 12);
      cyl(g, 0.08, 0.12, 0.9, bronze, 0, 0.55, 0, 10);
      const rings = [];
      for (const [r, tilt] of [[0.42, 0.3], [0.34, -0.9], [0.27, 1.4]]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 6, 36), M.brass);
        ring.position.y = 1.4;
        ring.rotation.set(tilt, 0, 0);
        g.add(ring);
        rings.push(ring);
      }
      const eyeMat = std(0x0a1a0e, 0.2, 0.2, { emissive: SIN_COLORS.envy, emissiveIntensity: 0.1 });
      const eye = sph(g, 0.1, eyeMat, 0, 1.4, 0, 16);
      const pupil = sph(g, 0.04, M.black, 0, 1.4, 0.08, 8);
      const heart = heartGem(g, 0, 1.0, 0.13, SIN_COLORS.envy, 0.9);
      const tmp = new THREE.Vector3();
      heartFx(g, heart, (t, ctx, beat) => {
        rings.forEach((r, i) => { r.rotation.y = t * (0.2 + i * 0.15) * (i % 2 ? -1 : 1); });
        eyeMat.emissiveIntensity = ctx.isHeart ? 0.4 + beat * 1.2 : 0.1;
        // The eye follows you.
        const local = g.worldToLocal(ctx.camera.getWorldPosition(tmp)).sub(eye.position).normalize();
        pupil.position.set(local.x * 0.08, 1.4 + local.y * 0.08, local.z * 0.08);
      });
      return g;
    },
    feast_chalice() {
      // Gluttony: an enormous golden chalice overflowing with green ichor.
      const g = G();
      cyl(g, 0.3, 0.36, 0.5, M.stoneDark, 0, 0.25, 0, 12);
      const cup = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.2, 0.02], [0.05, 0.08], [0.04, 0.3], [0.09, 0.36], [0.26, 0.5], [0.28, 0.66]].map(([r, y2]) => new THREE.Vector2(r, y2)), 20), gold);
      cup.position.y = 0.5;
      g.add(cup);
      const ichor = std(0x1a3008, 0.2, 0, { emissive: SIN_COLORS.gluttony, emissiveIntensity: 0.15 });
      cyl(g, 0.27, 0.27, 0.02, ichor, 0, 1.15, 0, 20);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const drip = box(g, 0.04, 0.35 + (i % 3) * 0.1, 0.02, ichor, Math.cos(a) * 0.28, 0.95, Math.sin(a) * 0.28);
        drip.rotation.y = -a;
      }
      const heart = heartGem(g, 0, 1.3, 0, SIN_COLORS.gluttony, 1.1);
      heartFx(g, heart, (t, ctx, beat) => { ichor.emissiveIntensity = ctx.isHeart ? 0.3 + beat * 0.8 : 0.15; heart.gem.position.y = 1.3 + Math.sin(t * 1.4) * 0.03; });
      return g;
    },
    war_bell() {
      // Wrath: a great bronze bell hung in a scorched timber frame.
      const g = G();
      for (const sx of [-1, 1]) box(g, 0.12, 2.3, 0.12, M.woodDark, sx * 0.55, 1.15, 0);
      box(g, 1.3, 0.14, 0.16, M.woodDark, 0, 2.3, 0);
      const bell = G();
      bell.position.set(0, 2.22, 0);
      const shell = new THREE.Mesh(new THREE.LatheGeometry([[0.06, 0], [0.16, -0.05], [0.22, -0.3], [0.28, -0.6], [0.4, -0.8], [0.42, -0.86]].map(([r, y2]) => new THREE.Vector2(r, y2)), 24), bronze);
      shell.material.side = THREE.DoubleSide;
      bell.add(shell);
      const runeMat = std(0x200404, 0.5, 0.3, { emissive: SIN_COLORS.wrath, emissiveIntensity: 0.1 });
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.015, 6, 32), runeMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = -0.62;
      bell.add(band);
      sph(bell, 0.07, M.iron, 0, -0.78, 0, 10);
      g.add(bell);
      const heart = heartGem(g, 0, 1.2, 0, SIN_COLORS.wrath, 1.2);
      heartFx(g, heart, (t, ctx, beat) => {
        bell.rotation.z = ctx.isHeart ? Math.sin(t * 2.2) * 0.06 + beat * 0.04 : 0;
        runeMat.emissiveIntensity = ctx.isHeart ? 0.4 + beat * 1.2 : 0.1;
      });
      return g;
    },
    cradle_box() {
      // Sloth: a rocking cradle wrapped in grey sleep-mist.
      const g = G();
      for (const sz of [-1, 1]) {
        const rocker = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.03, 6, 20, Math.PI * 0.5), M.woodDark);
        rocker.rotation.z = Math.PI * 1.25;
        rocker.position.set(0, 0.62, sz * 0.3);
        g.add(rocker);
      }
      const body = G();
      body.position.y = 0.2;
      box(body, 1.0, 0.5, 0.6, M.woodMid, 0, 0.3, 0);
      box(body, 0.9, 0.06, 0.5, M.linen, 0, 0.52, 0);
      box(body, 0.06, 0.7, 0.6, M.woodMid, -0.5, 0.45, 0);
      g.add(body);
      const mist = glow(g, 0, 0.9, 0, SIN_COLORS.sloth, 1.6, true);
      const heart = heartGem(body, 0.05, 0.66, 0, SIN_COLORS.sloth, 1.0);
      heartFx(g, heart, (t, ctx, beat) => {
        body.rotation.x = Math.sin(t * 0.6) * 0.08;
        mist.material.opacity = 0.2 + Math.sin(t * 0.5) * 0.1 + (ctx.isHeart ? beat * 0.2 : 0);
      });
      return g;
    },

    // ===================================================================== room tasks
    ego_mirror() {
      // Pride's task: a tall gilded standing mirror. Shatter it.
      const g = G();
      for (const sx of [-1, 1]) box(g, 0.06, 0.12, 0.34, gold, sx * 0.36, 0.06, 0);
      const frame = G();
      frame.position.y = 1.15;
      box(frame, 0.82, 2.0, 0.07, gold);
      const glassMat = M.glass.clone();
      glassMat.emissive = new THREE.Color(SIN_COLORS.pride);
      glassMat.emissiveIntensity = 0.06;
      const glassM = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 1.84), glassMat);
      glassM.position.z = 0.04;
      frame.add(glassM);
      g.add(frame);
      const shards = G();
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.06 + Math.random() * 0.06), glassMat);
        s.position.set((Math.random() - 0.5) * 0.9, 0.03, 0.15 + Math.random() * 0.5);
        s.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        s.scale.y = 0.2;
        shards.add(s);
      }
      shards.visible = false;
      g.add(shards);
      g.userData.setState = (st) => {
        g.userData.done = !!st?.done;
        glassM.visible = !g.userData.done;
        shards.visible = g.userData.done;
        frame.rotation.z = g.userData.done ? 0.05 : 0;
      };
      g.userData.fx = (t) => { if (!g.userData.done) glassMat.emissiveIntensity = 0.06 + Math.sin(t * 1.3) * 0.04; };
      return g;
    },
    display_case() {
      // Greed's source: a glass-topped display case holding one gold ingot.
      const g = G();
      legs(g, 0.95, 0.55, 0.75, 0.05, M.woodRed);
      box(g, 0.95, 0.08, 0.55, M.woodRed, 0, 0.78, 0);
      const glassBox = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.5), M.clearGlass);
      glassBox.position.y = 0.97;
      g.add(glassBox);
      box(g, 0.8, 0.02, 0.42, M.velvet, 0, 0.83, 0);
      const ingot = makeIngot();
      ingot.position.set(0, 0.84, 0);
      g.add(ingot);
      const shine = glow(g, 0, 0.95, 0, SIN_COLORS.greed, 0.5, true);
      g.userData.setState = (st) => {
        g.userData.empty = !!(st?.taken || st?.done);
        ingot.visible = shine.visible = !g.userData.empty;
      };
      g.userData.fx = (t) => { shine.material.opacity = 0.3 + Math.sin(t * 2.5) * 0.15; };
      return g;
    },
    weighing_scale() {
      // Greed's sink: Mammon's scale. Ingots pile on the left pan; the beam tips.
      const g = G();
      cyl(g, 0.3, 0.36, 0.1, M.stoneDark, 0, 0.05, 0, 12);
      cyl(g, 0.04, 0.06, 1.3, bronze, 0, 0.7, 0, 8);
      const beam = G();
      beam.position.set(0, 1.38, 0);
      box(beam, 0.9, 0.04, 0.04, bronze);
      const pans = [];
      for (const sx of [-1, 1]) {
        const hang = G();
        hang.position.set(sx * 0.42, 0, 0);
        for (const [dx, dz] of [[0.1, 0], [-0.05, 0.09], [-0.05, -0.09]]) {
          const ch = cyl(hang, 0.004, 0.004, 0.42, M.brass, dx * 0.9, -0.21, dz * 0.9, 4);
          ch.rotation.z = -dx * 0.5;
        }
        const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.1, 0.04, 16), M.brass);
        pan.position.y = -0.44;
        hang.add(pan);
        beam.add(hang);
        pans.push(hang);
      }
      g.add(beam);
      const eye = glow(g, 0, 1.46, 0.03, SIN_COLORS.greed, 0.3, true);
      const ingots = [0, 1, 2].map((i) => {
        const ig = makeIngot(0.7);
        ig.position.set(i === 1 ? 0.03 : -0.03, -0.42 + i * 0.045, i === 2 ? 0.03 : 0);
        ig.rotation.y = i * 0.6;
        ig.visible = false;
        pans[0].add(ig);
        return ig;
      });
      g.userData.count = 0;
      g.userData.setState = (st) => {
        g.userData.count = Math.min(3, st?.count ?? 0);
        ingots.forEach((ig, i) => { ig.visible = i < g.userData.count; });
      };
      g.userData.fx = (t) => {
        const want = -0.12 * g.userData.count + (g.userData.count ? 0 : Math.sin(t * 0.8) * 0.03);
        beam.rotation.z += (-want - beam.rotation.z) * 0.05;
        for (const p of pans) p.rotation.z = -beam.rotation.z;
        eye.material.opacity = 0.3 + g.userData.count * 0.2;
      };
      return g;
    },
    silk_cocoon() {
      // Lust's task: a crimson silk cocoon strung from a frame. Burn it.
      const g = G();
      for (const sx of [-1, 1]) box(g, 0.05, 2.0, 0.05, M.woodDark, sx * 0.4, 1.0, 0);
      box(g, 0.9, 0.05, 0.05, M.woodDark, 0, 2.0, 0);
      const silk = std(0x7a0a2a, 0.5, 0, { emissive: SIN_COLORS.lust, emissiveIntensity: 0.12, transparent: true, opacity: 0.92 });
      const cocoon = G();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), silk);
      body.scale.set(1, 2.1, 1);
      body.position.y = 1.1;
      cocoon.add(body);
      for (let i = 0; i < 4; i++) {
        const th = cyl(cocoon, 0.004, 0.004, 0.5, silk, (i - 1.5) * 0.12, 1.78, 0, 4);
        th.rotation.z = (i - 1.5) * 0.25;
      }
      g.add(cocoon);
      const ash = G();
      for (let i = 0; i < 6; i++) sph(ash, 0.06 + Math.random() * 0.05, M.black, (Math.random() - 0.5) * 0.4, 0.03, (Math.random() - 0.5) * 0.3, 6).scale.y = 0.3;
      const ember = glow(ash, 0, 0.08, 0, 0xff5020, 0.4, true);
      ash.visible = false;
      g.add(ash);
      g.userData.setState = (st) => {
        g.userData.done = !!st?.done;
        cocoon.visible = !g.userData.done;
        ash.visible = g.userData.done;
      };
      g.userData.fx = (t) => {
        if (g.userData.done) ember.material.opacity = 0.3 + Math.random() * 0.25;
        else { cocoon.rotation.y = Math.sin(t * 0.7) * 0.2; silk.emissiveIntensity = 0.12 + Math.sin(t * 2) * 0.06; }
      };
      return g;
    },
    envy_portrait(prop) {
      // Envy's task: a noble portrait whose green eyes follow you. Deface it.
      const g = G();
      const y = 1.9;
      box(g, 0.95, 1.2, 0.08, M.goldFrame, 0, y, 0);
      const mat = new THREE.MeshStandardMaterial({ map: getPortrait(((prop?.variant ?? 0) + 3) % 8, false), roughness: 0.7 });
      const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.02), mat);
      canvas.position.set(0, y, 0.045);
      g.add(canvas);
      const eyeMat = new THREE.MeshBasicMaterial({ color: SIN_COLORS.envy });
      const eyes = [-1, 1].map((sx) => {
        const e = new THREE.Mesh(new THREE.CircleGeometry(0.025, 10), eyeMat);
        e.position.set(sx * 0.08, y + 0.18, 0.05);
        g.add(e);
        return e;
      });
      const glowEyes = glow(g, 0, y + 0.18, 0.08, SIN_COLORS.envy, 0.35, true);
      const slashes = G();
      for (let i = 0; i < 3; i++) {
        const s = box(slashes, 0.7, 0.025, 0.01, M.black, 0, y + 0.18 + (i - 1) * 0.07, 0.055);
        s.rotation.z = -0.35 + i * 0.12;
      }
      slashes.visible = false;
      g.add(slashes);
      g.userData.setState = (st) => {
        g.userData.done = !!st?.done;
        for (const e of eyes) e.visible = !g.userData.done;
        glowEyes.visible = !g.userData.done;
        slashes.visible = g.userData.done;
      };
      g.userData.fx = (t) => { if (!g.userData.done) glowEyes.material.opacity = 0.35 + Math.sin(t * 3) * 0.2; };
      return g;
    },
    feast_platter() {
      // Gluttony's source: a rotting feast on a silver platter.
      const g = G();
      cyl(g, 0.3, 0.3, 0.04, M.woodDark, 0, 0.72, 0, 16);
      cyl(g, 0.04, 0.05, 0.7, M.woodDark, 0, 0.36, 0, 8);
      cyl(g, 0.2, 0.22, 0.04, M.woodDark, 0, 0.02, 0, 12);
      const platter = makePlatter();
      platter.position.y = 0.75;
      g.add(platter);
      g.userData.setState = (st) => { platter.visible = !(st?.taken || st?.done); };
      return g;
    },
    feast_furnace() {
      // Gluttony's sink: a roaring iron furnace. Every platter fed makes it hungrier.
      const g = G();
      box(g, 1.5, 1.4, 0.75, brick, 0, 0.7, 0);
      box(g, 1.6, 0.12, 0.85, M.iron, 0, 1.46, 0);
      cyl(g, 0.18, 0.22, 1.4, M.iron, 0.45, 2.2, -0.15, 10);
      box(g, 0.8, 0.55, 0.05, M.black, 0, 0.6, 0.36); // the mouth
      const fireMat = new THREE.MeshBasicMaterial({ color: 0xff7020 });
      const flames = [];
      for (let i = 0; i < 6; i++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 6), fireMat);
        f.position.set(-0.3 + i * 0.12, 0.5, 0.3);
        g.add(f);
        flames.push(f);
      }
      const halo = glow(g, 0, 0.65, 0.5, 0xff6a20, 1.2, true);
      g.userData.count = 0;
      g.userData.setState = (st) => { g.userData.count = Math.min(3, st?.count ?? 0); };
      g.userData.fx = (t) => {
        const k = 1 + g.userData.count * 0.4;
        flames.forEach((f, i) => { f.scale.y = k * (0.8 + Math.sin(t * 11 + i * 1.7) * 0.3); f.position.y = 0.42 + f.scale.y * 0.12; });
        halo.material.opacity = 0.4 + g.userData.count * 0.15 + Math.sin(t * 8) * 0.1;
        halo.scale.setScalar(1.2 * k);
      };
      return g;
    },
    crucible_sword() {
      // Wrath's task: a red-hot greatsword over a trough of blood. Quench it.
      const g = G();
      box(g, 1.1, 0.4, 0.5, M.stoneDark, 0, 0.2, 0);
      box(g, 1.0, 0.02, 0.4, M.bloodWater, 0, 0.39, 0);
      for (const sx of [-1, 1]) box(g, 0.08, 0.5, 0.08, M.iron, sx * 0.42, 0.65, 0);
      const sword = G();
      const hot = std(0x301008, 0.4, 0.8, { emissive: 0xff4010, emissiveIntensity: 1.2 });
      box(sword, 1.05, 0.02, 0.09, hot, 0, 0, 0);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 4).rotateZ(-Math.PI / 2), hot);
      tip.position.x = 0.59;
      sword.add(tip);
      box(sword, 0.04, 0.05, 0.28, M.iron, -0.53, 0, 0);
      box(sword, 0.24, 0.04, 0.04, M.woodDark, -0.67, 0, 0);
      sword.position.set(0, 0.92, 0);
      g.add(sword);
      const heat = glow(g, 0, 0.95, 0, 0xff5018, 1.0, true);
      g.userData.setState = (st) => {
        g.userData.done = !!st?.done;
        sword.position.y = g.userData.done ? 0.42 : 0.92;
        sword.rotation.z = g.userData.done ? 0.08 : 0;
        hot.emissiveIntensity = g.userData.done ? 0 : 1.2;
        hot.color.set(g.userData.done ? 0x3a3a40 : 0x301008);
        heat.visible = !g.userData.done;
      };
      g.userData.fx = (t) => {
        if (g.userData.done) return;
        hot.emissiveIntensity = 1 + Math.sin(t * 5) * 0.25;
        heat.material.opacity = 0.45 + Math.sin(t * 5) * 0.15;
      };
      return g;
    },
    metronome() {
      // Sloth's task: a heavy pendulum metronome, run down. Wind it.
      const g = G();
      box(g, 0.5, 0.1, 0.4, M.woodDark, 0, 0.05, 0);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.26, 1.1, 4).rotateY(Math.PI / 4), M.woodMid);
      body.scale.z = 0.7;
      body.position.y = 0.65;
      g.add(body);
      box(g, 0.24, 0.6, 0.01, std(0x1a120c, 0.6), 0, 0.6, 0.13);
      const arm = G();
      arm.position.set(0, 0.32, 0.15);
      cyl(arm, 0.008, 0.008, 0.85, M.brass, 0, 0.42, 0, 4);
      box(arm, 0.08, 0.1, 0.03, M.brass, 0, 0.6, 0); // the sliding weight
      g.add(arm);
      const keyM = G();
      keyM.position.set(0.27, 0.45, 0);
      box(keyM, 0.1, 0.02, 0.02, M.brass, 0.05, 0, 0);
      box(keyM, 0.02, 0.1, 0.06, M.brass, 0.1, 0, 0);
      g.add(keyM);
      const mist = glow(g, 0, 0.8, 0.2, SIN_COLORS.sloth, 0.8, true);
      g.userData.setState = (st) => { g.userData.done = !!st?.done; mist.visible = !g.userData.done; };
      g.userData.fx = (t) => {
        if (g.userData.done) {
          arm.rotation.z = Math.sin(t * Math.PI * 1.4) * 0.45;
          keyM.rotation.x = t * 1.5;
        } else {
          arm.rotation.z = 0.08 + Math.sin(t * 0.3) * 0.01; // stuck, barely trembling
          mist.material.opacity = 0.25 + Math.sin(t * 0.6) * 0.1;
        }
      };
      return g;
    },
  };

  function legs(g, w, d, hgt, t, mat) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, t, hgt, t, mat, sx * (w / 2 - t), hgt / 2, sz * (d / 2 - t));
  }
  function makeIngot(s = 1) {
    const ig = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * Math.SQRT2, 0.1 * Math.SQRT2, 0.06, 4, 1).rotateY(Math.PI / 4), gold);
    ig.scale.set(s * 1.6, s, s);
    ig.position.y = 0.03 * s;
    const grp = G();
    grp.add(ig);
    return grp;
  }
  function makePlatter() {
    const p = G();
    cyl(p, 0.24, 0.2, 0.03, silver, 0, 0.015, 0, 20);
    const rot = [std(0x3a2a10, 0.9), std(0x2a3010, 0.9, 0, { emissive: 0x1a2a00, emissiveIntensity: 0.4 }), std(0x4a1a10, 0.9)];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      sph(p, 0.05 + (i % 3) * 0.015, rot[i % 3], Math.cos(a) * 0.1, 0.06, Math.sin(a) * 0.1, 8).scale.y = 0.7;
    }
    const bone = cyl(p, 0.012, 0.012, 0.22, M.bone, 0, 0.09, 0, 5);
    bone.rotation.z = 1.2;
    return p;
  }
  return { builders, carry: { ingot: () => makeIngot(), platter: makePlatter } };
}

/** A carried item (held in first person, or by a teammate's avatar). */
export function makeCarry(kit, kind) {
  const make = kind === 'ingot' ? kit.carry.ingot : kind === 'platter' ? kit.carry.platter : null;
  return make ? make() : null;
}
