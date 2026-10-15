// Step 7: what the client shows about the Seven Hearts: per-Heart status for
// the full map, the room-task tracker banner, and the "[Hold E] <Action>
// (Progress X/3)" prompt over a task prop. Pure (no DOM) so the server's
// rules and these labels can be tested side by side.

import { TASKS, TASK_STEPS } from './lore.js';
import { SINS } from './sins.js';

const CARRY_NOUN = { ingot: 'a Gold Ingot', platter: 'a Rotting Feast Platter' };

/** How many of a Heart's three steps are done. */
export function tasksDone(heart, propState) {
  return heart.tasks.filter((id) => propState[id]?.done).length;
}

/**
 * One Heart (an entry of the Tome's `hearts`): its Sin, room, progress and state.
 * state: 'sealed' (tasks left) | 'unsealed' (open it!) | 'lockdown' (its Sin is loose) | 'slain'
 */
export function heartStatus(heart, propState, destroyed, lockdowns = new Set()) {
  const S = SINS[heart.sin];
  const T = TASKS[heart.sin];
  const done = tasksDone(heart, propState);
  const state = destroyed.has(heart.propId) ? 'slain'
    : lockdowns.has(heart.propId) ? 'lockdown'
      : propState[heart.propId]?.unsealed ? 'unsealed' : 'sealed';
  return {
    propId: heart.propId, sin: heart.sin, sinName: S.name, color: S.color, name: heart.name,
    roomId: heart.roomId, roomName: heart.roomName, floor: heart.floor,
    tasks: heart.tasks, sink: heart.sink ?? null,
    objective: T.objective, done, of: TASK_STEPS, state,
  };
}

/** The top-right tracker: "MASTER STUDY (GREED) — Weigh Stolen Gold Ingots on Mammon’s Scale: 1 / 3". */
export function trackerText(st) {
  const head = `${st.roomName.toUpperCase()} (${st.sinName.toUpperCase()})`;
  switch (st.state) {
    case 'slain': return `${head} — ${st.sinName} is slain. The Heart is silent.`;
    case 'lockdown': return `${head} — LOCKDOWN: slay ${st.sinName} to open the doors.`;
    case 'unsealed': return `${head} — The wards are broken: open the Heart (${st.of} / ${st.of})`;
    default: return `${head} — ${st.objective}: ${st.done} / ${st.of}`;
  }
}

/**
 * What a task prop offers you right now, mirroring Game.onInteract's rules.
 * @returns { action, hold, progress, of } — hold=false means E does nothing useful here.
 */
export function taskPrompt(prop, heart, propState, destroyed, { tomeRead = true, carry = null } = {}) {
  const T = TASKS[heart.sin];
  const progress = tasksDone(heart, propState);
  const base = { progress, of: TASK_STEPS };
  const st = propState[prop.id];
  if (!tomeRead) return { ...base, action: 'It means nothing to you yet', hold: false };
  if (destroyed.has(heart.propId) || propState[heart.propId]?.unsealed) return { ...base, action: `${T.done}. The Heart is unsealed`, hold: false };
  if (prop.role === 'sink') {
    if (carry === T.carry) return { ...base, action: T.label, hold: true };
    return { ...base, action: `Bring ${CARRY_NOUN[T.carry]} here`, hold: false };
  }
  if (st?.done) return { ...base, action: T.done, hold: false };
  if (T.carry) {
    if (st?.taken) return { ...base, action: 'Empty. Someone is carrying it', hold: false };
    if (carry) return { ...base, action: 'Your hands are full', hold: false };
    return { ...base, action: T.take, hold: true };
  }
  return { ...base, action: T.label, hold: true };
}

/** The billboard line: "[Hold E] Shatter Vanity Mirror (Progress 1/3)". */
export function promptLine(p) {
  return `${p.hold ? '[Hold E] ' : ''}${p.action} (Progress ${p.progress}/${p.of})`;
}
