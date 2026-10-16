// Step 9: the compact snapshot protocol (server encodes, client decodes).
//
// A game snapshot (Game.snapshot()) is split in two:
//   - FAST: positions, rotations, velocities and boolean flags of every
//     player, monster, projectile and entity, quantized into a small binary
//     packet (Int16 positions at 1 cm, Uint8 yaw, Int8 pitch, bit flags),
//     sent every tick as a VOLATILE message (dropping one is harmless);
//   - SLOW: everything else (buffs, statuses, HP, hazards, the finale's
//     state, the phase…), sent as a reliable JSON DELTA only when something
//     changed, per entity and per field.
// The decoder rebuilds the very same snapshot object shape, so the game
// client is unchanged. Entity ids map to small indices announced in the delta.

export const NET_VERSION = 1;

const TAU = Math.PI * 2;
/** Fast fields per collection: [field, type]. Booleans go into the flag bits. */
export const SCHEMA = {
  players: { fast: [['x', 'pos'], ['z', 'pos'], ['f', 'u8'], ['yaw', 'ang'], ['pitch', 'pitch'], ['hp', 'u8r'], ['u', 'u100']], flags: ['cr', 'sp', 'li', 'mv', 'sh', 'cap', 'cg', 'ux'] },
  monsters: { fast: [['x', 'pos'], ['z', 'pos'], ['f', 'u8'], ['yaw', 'ang']], flags: ['mv', 'dead', 'hid'] },
  prj: { fast: [['x', 'pos'], ['z', 'pos'], ['f', 'u8'], ['vx', 'vel'], ['vz', 'vel']], flags: [] },
  ents: { fast: [['x', 'pos'], ['z', 'pos'], ['f', 'u8'], ['yaw', 'ang']], flags: [] },
};
const COLLECTIONS = Object.keys(SCHEMA);
/** Top-level fields that travel in the binary header; every other top-level field is slow. */
const TOP_FAST = ['t', 'fl', 'dw'];
const SIZE = { pos: 2, u8: 1, ang: 1, pitch: 1, u8r: 1, u100: 2, vel: 2 };
const PRUNE_AFTER = 10; // seconds an entity may be absent before the encoder forgets it (it re-sends in full)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** A growable byte writer over one reused buffer. */
class Writer {
  constructor(size = 1024) {
    this.buf = new ArrayBuffer(size);
    this.view = new DataView(this.buf);
    this.o = 0;
  }
  need(n) {
    if (this.o + n <= this.buf.byteLength) return;
    const next = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.o + n));
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.o));
    this.buf = next;
    this.view = new DataView(next);
  }
  u8(v) { this.need(1); this.view.setUint8(this.o, v); this.o += 1; }
  i8(v) { this.need(1); this.view.setInt8(this.o, v); this.o += 1; }
  u16(v) { this.need(2); this.view.setUint16(this.o, v, true); this.o += 2; }
  i16(v) { this.need(2); this.view.setInt16(this.o, v, true); this.o += 2; }
  f32(v) { this.need(4); this.view.setFloat32(this.o, v, true); this.o += 4; }
}

function writeField(w, type, v) {
  v = Number(v) || 0;
  switch (type) {
    case 'pos': case 'vel': return w.i16(clamp(Math.round(v * 100), -32768, 32767));
    case 'u8': return w.u8(clamp(Math.round(v), 0, 255));
    case 'u8r': return w.u8(clamp(Math.round(v), 0, 255));
    case 'u100': return w.u16(clamp(Math.round(v * 100), 0, 65535));
    case 'ang': return w.u8(Math.round((((v % TAU) + TAU) % TAU) / TAU * 256) & 255);
    case 'pitch': return w.i8(clamp(Math.round(v * 80), -127, 127));
  }
}

function readField(view, o, type) {
  switch (type) {
    case 'pos': case 'vel': return view.getInt16(o, true) / 100;
    case 'u8': case 'u8r': return view.getUint8(o);
    case 'u100': return view.getUint16(o, true) / 100;
    case 'ang': { const a = (view.getUint8(o) / 256) * TAU; return a > Math.PI ? a - TAU : a; }
    case 'pitch': return view.getInt8(o) / 80;
  }
  return 0;
}

const serial = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

/** Server side: one per game (it remembers what the clients already know). */
export class SnapshotEncoder {
  constructor() {
    this.w = new Writer(2048);
    this.ids = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])); // id -> index
    this.next = Object.fromEntries(COLLECTIONS.map((c) => [c, 0]));
    this.slow = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])); // index -> { fields: Map, seen }
    this.top = new Map();
    this.fast = Object.fromEntries(COLLECTIONS.map((c) => [c, new Set([...SCHEMA[c].fast.map(([f]) => f), ...SCHEMA[c].flags, 'id'])]));
  }

  /** Forget what the clients know: the next encode carries everything (e.g. a client joined). */
  reset() {
    for (const c of COLLECTIONS) this.slow[c].clear();
    this.top.clear();
    this.idsAnnounced = false;
  }

  /**
   * @returns { bin: Uint8Array (a copy, safe to hand to the socket), delta: object | null }
   */
  encode(snap, now = snap.t ?? 0) {
    const w = this.w;
    w.o = 0;
    let delta = null;
    const d = () => (delta ??= {});
    // Header
    w.u8(NET_VERSION);
    w.f32(snap.t ?? 0);
    w.u16(clamp(Math.round((snap.fl ?? 0) * 10), 0, 65535));
    w.u16(clamp(Math.round((snap.dw ?? 0) * 10), 0, 65535));
    // Slow top-level fields
    for (const [k, v] of Object.entries(snap)) {
      if (TOP_FAST.includes(k) || COLLECTIONS.includes(k)) continue;
      const s = serial(v);
      if (this.top.get(k) !== s) {
        this.top.set(k, s);
        (d().top ??= {})[k] = v ?? null;
      }
    }
    for (const c of COLLECTIONS) {
      const list = snap[c] ?? [];
      const { fast, flags } = SCHEMA[c];
      const fastSet = this.fast[c];
      w.u16(list.length);
      for (const e of list) {
        let idx = this.ids[c].get(e.id);
        if (idx === undefined) {
          idx = this.next[c]++;
          this.ids[c].set(e.id, idx);
        }
        let known = this.slow[c].get(idx);
        if (!known) {
          known = { fields: new Map(), seen: now };
          this.slow[c].set(idx, known);
          ((d().ids ??= {})[c] ??= []).push([idx, e.id]);
        }
        known.seen = now;
        w.u16(idx);
        for (const [f, type] of fast) writeField(w, type, e[f]);
        let bits = 0;
        for (let i = 0; i < flags.length; i++) if (e[flags[i]]) bits |= 1 << i;
        if (flags.length > 8) w.u16(bits);
        else if (flags.length) w.u8(bits);
        // Slow fields: only what changed.
        for (const k in e) {
          if (fastSet.has(k)) continue;
          const v = e[k];
          const s = serial(v);
          if (known.fields.get(k) === s) continue;
          known.fields.set(k, s);
          (((d()[c] ??= {})[idx]) ??= {})[k] = v === undefined ? null : v;
        }
        // Fields that went away.
        if (known.fields.size) {
          for (const k of known.fields.keys()) {
            if (k in e) continue;
            known.fields.delete(k);
            (((d().rm ??= {})[c] ??= {})[idx] ??= []).push(k);
          }
        }
      }
      // The encoder forgets entities gone for a while (they come back in full).
      for (const [idx, known] of this.slow[c]) if (now - known.seen > PRUNE_AFTER) this.slow[c].delete(idx);
    }
    return { bin: new Uint8Array(w.buf.slice(0, w.o)), delta };
  }
}

/** Client side: rebuilds full snapshots from the binary frames and the deltas. */
export class SnapshotDecoder {
  constructor() {
    this.ids = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])); // index -> id
    this.slow = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])); // index -> object
    this.top = {};
  }

  applyDelta(delta) {
    if (!delta) return;
    if (delta.ids) for (const c in delta.ids) for (const [idx, id] of delta.ids[c]) this.ids[c].set(idx, id);
    if (delta.top) Object.assign(this.top, delta.top);
    for (const c of COLLECTIONS) {
      const changes = delta[c];
      if (changes) {
        for (const idx in changes) {
          const i = Number(idx);
          const o = this.slow[c].get(i) ?? {};
          Object.assign(o, changes[idx]);
          this.slow[c].set(i, o);
        }
      }
      const rm = delta.rm?.[c];
      if (rm) for (const idx in rm) { const o = this.slow[c].get(Number(idx)); if (o) for (const k of rm[idx]) delete o[k]; }
    }
  }

  /** @param bin ArrayBuffer | Uint8Array */
  decode(bin) {
    const u8 = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let o = 0;
    const version = view.getUint8(o); o += 1;
    if (version !== NET_VERSION) throw new Error(`snapshot version ${version}, expected ${NET_VERSION}`);
    const snap = { ...this.top };
    snap.t = view.getFloat32(o, true); o += 4;
    snap.fl = view.getUint16(o, true) / 10; o += 2;
    snap.dw = view.getUint16(o, true) / 10; o += 2;
    for (const c of COLLECTIONS) {
      const { fast, flags } = SCHEMA[c];
      const n = view.getUint16(o, true); o += 2;
      const list = new Array(n);
      for (let k = 0; k < n; k++) {
        const idx = view.getUint16(o, true); o += 2;
        const e = { id: this.ids[c].get(idx), ...this.slow[c].get(idx) };
        for (const [f, type] of fast) { e[f] = readField(view, o, type); o += SIZE[type]; }
        if (flags.length) {
          const bits = flags.length > 8 ? view.getUint16(o, true) : view.getUint8(o);
          o += flags.length > 8 ? 2 : 1;
          for (let i = 0; i < flags.length; i++) e[flags[i]] = !!(bits & (1 << i));
        }
        list[k] = e;
      }
      snap[c] = list;
    }
    return snap;
  }
}
