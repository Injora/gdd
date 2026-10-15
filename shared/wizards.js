// The seven playable wizards (Step 7 kits): slots 1–3 are ATTACKS, slot 4 is
// MOBILITY / UTILITY, and R is the Ultimate (charges over 5 minutes, usable
// ONCE per game). These numbers are the single source of truth for the server
// simulation (server/SpellSystem.js), bots, and the client HUD.
//
// Distances are world units (1 tile = 2 units). Durations/cooldowns in seconds.
// `cone` is the half-angle (radians) of an aim cone. `source` is the element
// used for combined-element banishes. `bot` tells bots when to use a spell:
//   target  needs the monster in range + sight      self/ally  defensive buff
//   escape  when hunted up close                     zone       placed effect
// `kind` is 'attack' (slots 1–3) or 'utility' (slot 4).

const W = (w) => {
  w.ability = w.spells[0]; // legacy alias: slot 1
  for (const s of [...w.spells, w.ultimate]) s.source = w.source;
  w.spells.forEach((s, i) => { s.kind = i < 3 ? 'attack' : 'utility'; });
  w.ultimate.ultimate = true;
  return w;
};

export const WIZARDS = [
  W({
    id: 'injorath',
    name: 'Injorath Blackthorn',
    title: 'Heir of the Forbidden Arts',
    element: 'Black',
    source: 'black',
    color: '#7a3cff',
    lightTint: '#c9b8ff',
    spells: [
      {
        id: 'psychic_torment', name: 'Dark Torment Bolt', bot: 'target',
        description: 'A bolt of black-violet dread: 11 damage. The Keeper shrieks and falters for a moment (Sins for 2s) and shows through walls to everyone for 6s.',
        cooldown: 6, range: 22, cone: 0.45, damage: 11, interrupt: 2.0, reveal: 6.0,
      },
      {
        id: 'dimension_slash', name: 'Dimension Slash', bot: 'target',
        description: 'A crescent of void-black space: 18 damage, heavy stagger, and its reach shrinks for 6s.',
        cooldown: 8, range: 25, speed: 24, radius: 0.45, damage: 18, knock: 1.5, stagger: 0.8, shortReach: 6, reachScale: 0.6,
      },
      {
        id: 'black_hole', name: 'Black Hole Singularity', bot: 'target',
        description: 'A spinning orb of collapsed dark that drags its target into the centre for 3s, crushing it (7 damage/s).',
        cooldown: 13, range: 10, cone: 0.6, radius: 7, duration: 3, pull: 5, dps: 7,
      },
      {
        id: 'shadow_step', name: 'Shadow Step', bot: 'escape',
        description: 'Utility: dissolve into black smoke for 2.5s: +40% speed, unseen, pass through furniture.',
        cooldown: 14, duration: 2.5, speed: 0.4,
      },
    ],
    ultimate: {
      id: 'abyssal_mind_fracture', name: 'Abyssal Mind Fracture', bot: 'target',
      description: 'Dark chains and crimson sigils lock the Monster’s mind for 10s. It cannot move, and tears at itself, shrieking.',
      range: 30, duration: 10, selfDps: 4,
    },
    bio: 'Last of a bloodline that wrote the Forbidden Arts and then tried to forget them.',
    epilogue: 'The Blackthorn hearth burns a clean, ordinary gold now. Their children have never heard a whisper in the walls.',
  }),
  W({
    id: 'parthius',
    name: 'Parthius Pyreborne',
    title: 'Infernal Prodigy',
    element: 'Fire',
    source: 'fire',
    color: '#ff5a1f',
    lightTint: '#ffd2a8',
    spells: [
      {
        id: 'ignis_blast', name: 'Ignis Blast', bot: 'target',
        description: 'A roaring fireball: 12 damage, sets its target burning (3/s), leaves a glowing scorch.',
        cooldown: 5, range: 30, damage: 12, projectileSpeed: 18, projectileRadius: 0.25,
        burnDps: 3, burnDuration: 3, burnSlow: 0.15, scorchDuration: 4,
      },
      {
        id: 'calidus_brachium', name: 'Calidus Brachium', bot: 'target',
        description: 'Three explosive flame fists hammer the cone in front of you: 7 damage each, staggering it back.',
        cooldown: 8, range: 6, cone: 0.6, hits: 3, interval: 0.2, damage: 7, knock: 1.2,
      },
      {
        id: 'sol_linea', name: 'Sol Linea', bot: 'target',
        description: 'A piercing white-hot laser down the corridor: 20 damage, and a burning line on the floor for 5s.',
        cooldown: 11, range: 30, width: 0.9, damage: 20, lineDuration: 5, burnDps: 3, burnDuration: 2,
      },
      {
        id: 'phoenix_dash', name: 'Phoenix Cinder Dash', bot: 'escape',
        description: 'Utility: burst 6u forward in a plume of fire, then a cloak of embers for 5s (+30% sprint speed; burns anything that touches you).',
        cooldown: 12, distance: 6, duration: 5, speed: 0.3, contactRadius: 1.8, burnDps: 4,
      },
    ],
    ultimate: {
      id: 'fiendfyre_dragon', name: 'Fiendfyre Great Dragon', bot: 'target',
      description: 'Summons a colossal serpent of fire that roars through the corridors, hunts the Monster down and detonates on it.',
      speed: 15, damage: 35, burnDps: 3, burnDuration: 5, life: 14, blast: 4,
    },
    bio: 'Set the academy observatory alight at nine years old. Has been apologising with skill ever since.',
    epilogue: 'Pyreborne lanterns line the village road. The family keeps the fire for festivals, never for fear.',
  }),
  W({
    id: 'himandriel',
    name: 'Himandriel Tidecrest',
    title: 'Lord of the Tidal Arts',
    element: 'Water',
    source: 'water',
    color: '#2fa8ff',
    lightTint: '#bfe6ff',
    spells: [
      {
        id: 'tidal_surge', name: 'Tidal Surge', bot: 'target',
        description: 'A crashing wave: 11 damage, slows by 40% for 4s, leaves a slick puddle that slows turning.',
        cooldown: 7, range: 10, cone: 0.55, damage: 11, slow: 0.4, slowDuration: 4,
        turnSlow: 0.5, puddleRadius: 3, puddleDuration: 4,
      },
      {
        id: 'water_spear', name: 'Valkyrie Water Spear', bot: 'target',
        description: 'A spiralling high-pressure lance: 19 damage, pierces, and pins its target for 1.5s.',
        cooldown: 9, range: 30, speed: 32, radius: 0.35, damage: 19, pin: 1.5,
      },
      {
        id: 'riptide_geyser', name: 'Riptide Geyser', bot: 'target',
        description: 'A pillar of water erupts under your target: 16 damage to everything within 2.5u, lifting it for 1.5s.',
        cooldown: 12, range: 14, cone: 0.5, radius: 2.5, damage: 16, lift: 1.5,
      },
      {
        id: 'slipstream', name: 'Sea Dragon’s Slipstream', bot: 'escape',
        description: 'Utility: ride a hydro-jet 6u forward inside a bubble that absorbs 35 damage for 6s.',
        cooldown: 14, distance: 6, absorb: 35, duration: 6,
      },
    ],
    ultimate: {
      id: 'abyssal_deluge', name: 'Abyssal Deluge', bot: 'target',
      description: 'Black water floods the whole mansion for 25s. The Monster wades at 35% speed everywhere.',
      duration: 25, slow: 0.65,
    },
    bio: 'Raised on a storm coast where the tide was the only teacher that never lied.',
    epilogue: 'The Tidecrest children race paper boats down a clear river that once ran red.',
  }),
  W({
    id: 'sushantus',
    name: 'Sushantus Thornwick',
    title: 'Warden of the Ancient Grounds',
    element: 'Earth',
    source: 'earth',
    color: '#8bb33a',
    lightTint: '#e2f0c4',
    spells: [
      {
        id: 'terra_spike', name: 'Terra Spike', bot: 'target',
        description: 'Jagged stone spikes erupt ahead: 13 damage.',
        cooldown: 6, range: 7, cone: 0.45, damage: 13,
      },
      {
        id: 'devils_snare', name: 'Devil’s Snare Briars', bot: 'target',
        description: 'Thorned vines tear up through the floor: rooted for 2.5s and crushed for 6 damage/s while inside.',
        cooldown: 11, range: 10, cone: 0.55, radius: 3, root: 2.5, zoneDuration: 4, dps: 6,
      },
      {
        id: 'golem_boulder', name: 'Golem Boulder Toss', bot: 'target',
        description: 'Hurl an explosive boulder: 22 damage, shattering into debris that slows by 35% for 5s.',
        cooldown: 10, range: 24, speed: 14, radius: 0.6, damage: 22, debrisRadius: 3, debrisDuration: 5, debrisSlow: 0.35,
      },
      {
        id: 'earthen_rampart', name: 'Earthen Rampart', bot: 'ally',
        description: 'Utility: raise a 3-tile stone barricade ahead (5s) and armour you and allies within 4u in granite (−60% damage, 6s).',
        cooldown: 16, radius: 4, duration: 6, reduction: 0.6, wallDuration: 5, wallTiles: 3, wallDistance: 2, wallHits: 2,
      },
    ],
    ultimate: {
      id: 'yggdrasil', name: 'Yggdrasil, Tree of Life', bot: 'heal',
      description: 'A glowing Tree of Life bursts from the floor, bearing one golden fruit per wizard. Eat one (E) to restore 60 HP and clear all terror.',
      life: 90, heal: 60,
    },
    bio: 'Speaks to old stones. Most of them have nothing kind to say about this mansion.',
    epilogue: 'Thornwick orchards climb the hill behind the manor. The roots hold the earth, and the earth holds still.',
  }),
  W({
    id: 'kartavian',
    name: 'Kartavian Windermere',
    title: 'Tempest Sovereign',
    element: 'Wind',
    source: 'wind',
    color: '#9ef0e0',
    lightTint: '#e8fffa',
    spells: [
      {
        id: 'gale_force', name: 'Gale Force Cannon', bot: 'target',
        description: 'A high-velocity blast of wind: 11 damage and a 5u knockback. Walls still stop it.',
        cooldown: 7, range: 9, cone: 0.6, damage: 11, knockback: 5, knockbackTime: 0.3,
      },
      {
        id: 'kamaitachi', name: 'Crescent Kamaitachi', bot: 'target',
        description: 'Three curving wind blades that hunt their target even around corners: 6 damage each.',
        cooldown: 7, blades: 3, interval: 0.15, speed: 20, range: 28, radius: 0.4, damage: 6, knock: 0.8,
      },
      {
        id: 'vacuum_tempest', name: 'Vacuum Tempest', bot: 'target',
        description: 'An imploding vortex bomb: 15 damage, lifting everything within 3u off its feet for 1.5s.',
        cooldown: 11, range: 12, cone: 0.5, radius: 3, lift: 1.5, damage: 15,
      },
      {
        id: 'zephyr_glide', name: 'Zephyr Flash Glide', bot: 'escape',
        description: 'Utility: a wind-tunnel dash 7u forward, then 4s of +45% speed with no stamina drain.',
        cooldown: 10, distance: 7, duration: 4, speed: 0.45,
      },
    ],
    ultimate: {
      id: 'sylph_dragon', name: 'Sylph’s Great Wind Dragon', bot: 'target',
      description: 'A colossal tornado serpent that seizes the Monster and sweeps it to the furthest room of the floor.',
      speed: 16, carrySpeed: 16, stagger: 2, life: 14,
    },
    bio: 'Was born during a hurricane and has never once been late.',
    epilogue: 'Windermere kites dance over green fields. The wind only carries laughter now.',
  }),
  W({
    id: 'soham',
    name: 'Soham Everlight',
    title: 'Luminary of the Sacred Order',
    element: 'White',
    source: 'white',
    color: '#fff6d8',
    lightTint: '#fffaf0',
    spells: [
      {
        id: 'sacred_bind', name: 'Sacred Judgment Ray', bot: 'target',
        description: 'A blinding ray of judgment: 12 damage, and its target is stunned for 2.5s. Passive: breaks the cage lock twice as fast.',
        cooldown: 9, range: 14, cone: 0.45, damage: 12, stun: 2.5,
      },
      {
        id: 'arrows_of_judgment', name: 'Arrows of Judgment', bot: 'target',
        description: 'Five homing swords of light, fired one after another: 4 damage each.',
        cooldown: 8, count: 5, interval: 0.15, speed: 22, range: 26, radius: 0.4, damage: 4, knock: 0.4,
      },
      {
        id: 'solar_nova', name: 'Solar Purging Nova', bot: 'target',
        description: 'An expanding golden blast around you: 18 damage to everything within 6u, pushing it back.',
        cooldown: 12, radius: 6, damage: 18, knock: 1.5, range: 6,
      },
      {
        id: 'flash_step', name: 'Flash Step', bot: 'escape',
        description: 'Utility: blink 6 units forward in a burst of gold, leaving a blinding afterimage (1.2s blind nearby).',
        cooldown: 9, distance: 6, blind: 1.2, blindRadius: 7,
      },
    ],
    ultimate: {
      id: 'dawn_sacred_order', name: 'Dawn of the Sacred Order', bot: 'target',
      description: 'Cathedral light floods every room and corridor. The Monster is frozen solid in golden chains for 30s.',
      duration: 30,
    },
    passive: { gateUnlockSpeed: 2 },
    bio: 'The Order’s youngest Luminary. Carries the light the way others carry a blade.',
    epilogue: 'Morning comes to the Everlight home every day, and every day it is welcomed.',
  }),
  W({
    id: 'himanshu',
    name: 'Himanshu Nullgrave',
    title: 'The Unspellable',
    element: 'Anti-magic',
    source: 'void',
    color: '#9aa3ad',
    lightTint: '#e6ebf0',
    spells: [
      {
        id: 'black_divider', name: 'Black Divider Cleave', bot: 'target',
        description: 'A heavy two-handed anti-magic cleave at mid range: 20 damage, and its windup is cut apart.',
        cooldown: 7, range: 4.5, cone: 0.7, damage: 20,
      },
      {
        id: 'black_slash', name: 'Black Slash Wave', bot: 'target',
        description: 'A ranged crimson-black crescent: 13 damage, and it strips its target’s buffs (a Sin loses its enrage for 6s; the Keeper its own for 8s).',
        cooldown: 9, range: 24, speed: 22, radius: 0.5, damage: 13, calm: 8, strip: 6,
      },
      {
        id: 'bull_thrust', name: 'Nullifying Meteor Thrust', bot: 'target',
        description: 'A piercing anti-magic lunge 5u forward: 17 damage to everything in its path, knocking it back 3u and drawing its rage to you.',
        cooldown: 11, distance: 5, knock: 3, hitRadius: 2.5, taunt: 5, range: 6, damage: 17,
      },
      {
        id: 'aegis_void', name: 'Aegis of the Void', bot: 'ally',
        description: 'Utility: a hexagonal dome of unmade space. For 3s every attack against you and allies within 3u simply fails.',
        cooldown: 16, range: 0, damage: 0, shieldDuration: 3, shieldRadius: 3,
      },
    ],
    ultimate: {
      id: 'devil_union', name: 'Devil Union: Absolute Nullification', bot: 'self',
      description: 'Black-and-crimson anti-magic wings envelop every wizard for 30s. The Monster’s attacks, lunges and captures have no effect.',
      duration: 30,
    },
    bio: 'No spell has ever landed on them. Nobody, including Himanshu, knows why.',
    epilogue: 'The Nullgrave house is quiet in the best way: no curses, no omens, just supper and stories.',
  }),
];

export const WIZARD_BY_ID = Object.fromEntries(WIZARDS.map((w) => [w.id, w]));
/** Every spell and ultimate by id. */
export const ABILITY_BY_ID = Object.fromEntries(WIZARDS.flatMap((w) => [...w.spells, w.ultimate]).map((a) => [a.id, a]));

/**
 * Ultimates (Step 7): every wizard's charges strictly over 5 minutes of match
 * time (+0.333%/s) and can be cast ONCE per game; after that the slot reads
 * EXPENDED. (Greed's molten gold can still knock charge back.)
 */
export const ULT = {
  MAX: 100,
  CHARGE_TIME: 300, // seconds from 0% to READY
};

/** In the Archon phase every ability is available at this fraction of its cooldown. */
export const ARCHON_COOLDOWN_SCALE = 0.25;
