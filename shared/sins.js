// The Seven Deadly Sins: the mini-bosses that erupt from each Heart when it is
// broken open. Shared by the server (SinDemon AI) and the client (models, HUD).
//
// Every demon fights inside a locked room (the "arena"): blood-rune barriers
// seal its doorways until the demon is slain.

export const SINS = {
  pride: {
    name: 'Pride',
    title: 'The Mirror Seraph',
    color: '#dfe8ff',
    hp: 150,
    speed: 2.4,
    radius: 0.6,
    blurb: 'It reflects anything cast at its face. Flank it, or stun it.',
    reflectCone: 1.05, // radians either side of its facing
    reflectDamage: 10, // a reflected spell scorches its caster
    lance: { range: 11, windup: 0.8, damage: 20, every: 3.2 },
  },
  greed: {
    name: 'Greed',
    title: 'The Gilded Hoarder',
    color: '#ffc23a',
    hp: 140,
    speed: 2.0,
    radius: 0.7,
    blurb: 'Its molten gold burns, and every splash steals your Ultimate charge.',
    gold: { range: 13, windup: 0.7, speed: 9, radius: 1.8, damage: 14, drain: 25, every: 2.6, count: 3 },
  },
  lust: {
    name: 'Lust',
    title: 'The Siren Weaver',
    color: '#ff5fb4',
    hp: 130,
    speed: 2.8,
    radius: 0.55,
    blurb: 'Its hypnotic ribbons drag you into its arms.',
    ribbons: { range: 12, windup: 0.9, pull: 4.5, damage: 6, every: 5.5 },
    caress: { range: 2.4, windup: 0.45, damage: 16, every: 1.6 },
  },
  envy: {
    name: 'Envy',
    title: 'The Hollow Mimic',
    color: '#6dff9a',
    hp: 130,
    speed: 2.6,
    radius: 0.55,
    blurb: 'Whatever element strikes it, it throws back as a wave.',
    counter: { delay: 1.1, speed: 7, range: 9, width: 1.2, damage: 15, cooldown: 2.2 },
    claw: { range: 2.4, windup: 0.5, damage: 14, every: 1.8 },
  },
  gluttony: {
    name: 'Gluttony',
    title: 'The Maw of Famine',
    color: '#a6e22e',
    hp: 160,
    speed: 1.7,
    radius: 0.85,
    blurb: 'It spits acid that spreads, and inhales everything near it.',
    acid: { range: 10, windup: 0.8, grow: 0.6, max: 3.0, dps: 9, life: 9, every: 4.2 },
    vacuum: { radius: 9, windup: 1.0, pull: 3.5, damage: 18, bite: 2.6, every: 7 },
  },
  wrath: {
    name: 'Wrath',
    title: 'The Blood Berserker',
    color: '#ff2a1a',
    hp: 150,
    speed: 3.0,
    radius: 0.65,
    blurb: 'It charges, and it only gets faster as it bleeds.',
    enrage: 1.4, // up to +140% speed at 0 HP
    charge: { range: 14, windup: 0.65, speed: 11, time: 0.7, damage: 24, every: 3.8 },
    cleave: { range: 2.6, windup: 0.4, damage: 18, every: 1.4 },
  },
  sloth: {
    name: 'Sloth',
    title: 'The Somnolent Dread',
    color: '#8f9bb8',
    hp: 160,
    speed: 1.3,
    radius: 0.9,
    blurb: 'Its aura fills the room with a heavy, dragging sleep.',
    aura: { slow: 0.45, drain: 30 }, // everyone in the room: -45% speed, stamina drains
    yawn: { radius: 5, windup: 1.4, damage: 22, every: 5 },
  },
};

export const SIN_IDS = Object.keys(SINS);
/** Seconds after a heart is broken before its demon can act (the eruption). */
export const SIN_ERUPT = 2.2;
/** No crowd control holds a Sin demon longer than this. */
export const SIN_CC_CAP = 3;
/** Ultimate charge every wizard gains when a Sin falls (on top of the Heart's own). */
export const SIN_ULT_BONUS = 20;
