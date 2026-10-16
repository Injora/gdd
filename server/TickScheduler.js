// Step 9: one loop per process drives every running game (instead of a timer
// per game). Games are spread over SLOTS staggered slots inside each 50 ms
// tick: every game still steps at exactly 20 Hz, but the event loop is never
// blocked by more than one slot's worth of games, so player input keeps
// flowing between slots. A game that throws is isolated (counted, logged).
//
// Stats (/metrics), all over the last minute:
//   p50 / p95 / p99 / max   one slot's duration: the longest the loop is busy at a time
//   cycle                   all slots of one 50 ms tick added up (total sim + send time)
//   perRoom                 cycle / rooms

import { performance } from 'node:perf_hooks';
import { TICK_RATE } from '../shared/constants.js';

const RING = 2400;
export const SLOTS = 4;

export class TickScheduler {
  constructor(rate = TICK_RATE, slots = SLOTS) {
    this.period = 1000 / rate;
    this.slots = slots;
    this.lanes = Array.from({ length: slots }, () => new Set());
    this.games = new Map(); // game -> lane
    this.samples = new Float64Array(RING);
    this.cycles = new Float64Array(RING / slots);
    this.count = 0;
    this.cycleCount = 0;
    this.cycleSum = 0;
    this.errors = 0;
    this.timer = null;
    this.slot = 0;
    this.sorted = new Float64Array(RING); // scratch for percentiles
  }

  add(game) {
    // The emptiest lane.
    let lane = 0;
    for (let i = 1; i < this.slots; i++) if (this.lanes[i].size < this.lanes[lane].size) lane = i;
    this.lanes[lane].add(game);
    this.games.set(game, lane);
    if (!this.timer) this.timer = setInterval(() => this.loop(), this.period / this.slots);
  }

  remove(game) {
    const lane = this.games.get(game);
    if (lane === undefined) return;
    this.lanes[lane].delete(game);
    this.games.delete(game);
    if (!this.games.size && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  loop() {
    const t0 = performance.now();
    for (const g of this.lanes[this.slot]) {
      try {
        g.tick(t0);
      } catch (err) {
        this.errors++;
        console.error(`[tick] game ${g.room} threw:`, err);
      }
    }
    const took = performance.now() - t0;
    this.samples[this.count++ % RING] = took;
    this.cycleSum += took;
    this.slot = (this.slot + 1) % this.slots;
    if (this.slot === 0) {
      this.cycles[this.cycleCount++ % this.cycles.length] = this.cycleSum;
      this.cycleSum = 0;
    }
  }

  percentiles(src, count) {
    const n = Math.min(count, src.length);
    const s = this.sorted.subarray(0, n);
    s.set(src.subarray(0, n));
    s.sort();
    return { at: (q) => (n ? s[Math.min(n - 1, Math.floor(q * n))] : 0), max: n ? s[n - 1] : 0 };
  }

  stats() {
    const slot = this.percentiles(this.samples, this.count);
    const cycle = this.percentiles(this.cycles, this.cycleCount);
    let players = 0;
    for (const g of this.games.keys()) players += g.players.size;
    const rooms = this.games.size;
    return {
      rooms, players, ticks: this.count, errors: this.errors, slots: this.slots,
      p50: slot.at(0.5), p95: slot.at(0.95), p99: slot.at(0.99), max: slot.max,
      cycleP95: cycle.at(0.95), perRoom: rooms ? cycle.at(0.5) / rooms : 0,
    };
  }
}

/** The process-wide scheduler. */
export const scheduler = new TickScheduler();
