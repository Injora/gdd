// The seven playable wizards: 4 normal spells (hotbar 1–4) + 1 Ultimate (R)
// each. These numbers are the single source of truth for the server
// simulation (server/SpellSystem.js), bots, and the client HUD.
//
// Distances are world units (1 tile = 2 units). Durations/cooldowns in seconds.
// `cone` is the half-angle (radians) of an aim cone. `source` is the element
// used for combined-element banishes. `bot` tells bots when to use a spell:
//   target  needs the monster in range + sight      self/ally  defensive buff
//   escape  when hunted up close                     zone       placed effect

const W = (w) => {
  w.ability = w.spells[0]; // legacy alias: slot 1
  for (const s of [...w.spells, w.ultimate]) s.source = w.source;
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
        id: 'psychic_torment', name: 'Psychic Torment', bot: 'target',
        description: 'A wave of black-violet dread. No damage, but the Monster shrieks, abandons its chase for 2s, and is visible through walls to everyone for 6s.',
        cooldown: 16, range: 22, cone: 0.5, damage: 0, interrupt: 2.0, reveal: 6.0,
      },
      {
        id: 'dimension_slash', name: 'Dimension Slash', bot: 'target',
        description: 'A vertical crescent of void-black space. Heavy stagger, and the Monster’s reach shrinks for 6s.',
        cooldown: 7, range: 25, speed: 24, radius: 0.45, damage: 5, knock: 1.5, stagger: 0.8, shortReach: 6, reachScale: 0.6,
      },
      {
        id: 'black_hole', name: 'Black Hole Singularity', bot: 'target',
        description: 'A spinning sphere of collapsed dark that drags the Monster into its centre for 3s.',
        cooldown: 14, range: 10, cone: 0.6, radius: 7, duration: 3, pull: 5, dps: 1.5,
      },
      {
        id: 'shadow_step', name: 'Shadow Step', bot: 'escape',
        description: 'Dissolve into black smoke for 2.5s: +40% speed, invisible to the Monster, pass through furniture.',
        cooldown: 16, duration: 2.5, speed: 0.4,
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
        description: 'A roaring fireball that lights the corridors it flies through. Chips health, sets the Monster burning, leaves a glowing scorch for 4s.',
        cooldown: 5, range: 30, damage: 4, projectileSpeed: 18, projectileRadius: 0.25,
        burnDps: 1, burnDuration: 3, burnSlow: 0.15, scorchDuration: 4,
      },
      {
        id: 'calidus_brachium', name: 'Calidus Brachium', bot: 'target',
        description: 'Three explosive flame fists hammer the cone in front of you, staggering the Monster back.',
        cooldown: 8, range: 6, cone: 0.6, hits: 3, interval: 0.2, damage: 2, knock: 1.2,
      },
      {
        id: 'sol_linea', name: 'Sol Linea', bot: 'target',
        description: 'A piercing white-hot beam down the corridor that leaves a burning line on the floor for 5s.',
        cooldown: 11, range: 30, width: 0.9, damage: 6, lineDuration: 5, burnDps: 1, burnDuration: 2,
      },
      {
        id: 'phoenix_aura', name: 'Phoenix Cinder Aura', bot: 'self',
        description: 'A cloak of swirling embers for 6s: +30% sprint speed, bright light, and burns the Monster on contact.',
        cooldown: 18, duration: 6, speed: 0.3, contactRadius: 1.8, burnDps: 2,
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
        description: 'A surging wave across the floor. Chips health, slows by 40% for 4s, leaves a slick puddle that slows turning.',
        cooldown: 9, range: 10, cone: 0.55, damage: 3, slow: 0.4, slowDuration: 4,
        turnSlow: 0.5, puddleRadius: 3, puddleDuration: 4,
      },
      {
        id: 'water_spear', name: 'Valkyrie Water Spear', bot: 'target',
        description: 'A spiralling high-pressure lance that pierces and pins the Monster in place for 1.5s.',
        cooldown: 9, range: 30, speed: 32, radius: 0.35, damage: 5, pin: 1.5,
      },
      {
        id: 'sea_cradle', name: 'Sea Dragon’s Cradle', bot: 'ally',
        description: 'Swirling spheres of water around you and allies within 4u, each absorbing 40 damage for 10s.',
        cooldown: 20, radius: 4, absorb: 40, duration: 10,
      },
      {
        id: 'riptide_vortex', name: 'Riptide Vortex', bot: 'zone',
        description: 'A water rune on the floor. When the Monster steps on it, a spinning geyser erupts and holds it for 2.5s.',
        cooldown: 15, range: 8, trigger: 1.6, geyser: 2.5, damage: 3, life: 30,
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
        description: 'Jagged stone erupts: chip damage ahead and a 3-tile barricade that seals corridors and doorways for 5s.',
        cooldown: 12, range: 6, cone: 0.4, damage: 3, wallDuration: 5, wallTiles: 3, wallDistance: 2, wallHits: 2,
      },
      {
        id: 'devils_snare', name: 'Devil’s Snare Briars', bot: 'target',
        description: 'Thorned vines tear up through the floorboards and root the Monster for 2.5s.',
        cooldown: 12, range: 10, cone: 0.55, radius: 3, root: 2.5, zoneDuration: 4,
      },
      {
        id: 'golem_boulder', name: 'Golem Boulder Toss', bot: 'target',
        description: 'Hurl a boulder that shatters into a field of debris, slowing the Monster by 35% for 5s.',
        cooldown: 10, range: 24, speed: 14, radius: 0.6, damage: 6, debrisRadius: 3, debrisDuration: 5, debrisSlow: 0.35,
      },
      {
        id: 'granite_skin', name: 'Granite Skin', bot: 'ally',
        description: 'Stone plates armour you and allies within 4u for 6s, cutting damage taken by 60%.',
        cooldown: 18, radius: 4, duration: 6, reduction: 0.6,
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
        id: 'gale_force', name: 'Gale Force', bot: 'target',
        description: 'A howling tunnel of wind that hurls the Monster 5 units away from you. Walls still stop it.',
        cooldown: 8, range: 9, cone: 0.6, damage: 0, knockback: 5, knockbackTime: 0.3,
      },
      {
        id: 'kamaitachi', name: 'Crescent Kamaitachi', bot: 'target',
        description: 'Three curving wind blades that hunt the Monster, even around corners.',
        cooldown: 7, blades: 3, interval: 0.15, speed: 20, range: 28, radius: 0.4, damage: 2, knock: 0.8,
      },
      {
        id: 'zephyr_tailwind', name: 'Zephyr Tailwind', bot: 'ally',
        description: 'A slipstream for 6s: you and allies within 5u move 45% faster and sprint without tiring.',
        cooldown: 16, radius: 5, duration: 6, speed: 0.45,
      },
      {
        id: 'vacuum_tempest', name: 'Vacuum Tempest', bot: 'target',
        description: 'An imploding vortex that lifts the Monster off its feet for 1.5s.',
        cooldown: 12, range: 12, cone: 0.5, radius: 3, lift: 1.5,
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
        id: 'sacred_bind', name: 'Sacred Bind', bot: 'target',
        description: 'A blinding golden burst that stuns and blinds the Monster in place for 3.5s. Passive: breaks the Cell lock twice as fast.',
        cooldown: 20, range: 12, cone: 0.5, damage: 0, stun: 3.5,
      },
      {
        id: 'arrows_of_judgment', name: 'Arrows of Judgment', bot: 'target',
        description: 'Five swords of light rise above you and fire one after another at the Monster.',
        cooldown: 9, count: 5, interval: 0.15, speed: 22, range: 26, radius: 0.4, damage: 1.5, knock: 0.4,
      },
      {
        id: 'patronus_beacon', name: 'Patronus Beacon', bot: 'heal',
        description: 'A radiant silver-gold guardian for 10s: lights the room and heals allies within 6u for 4 HP/s.',
        cooldown: 22, duration: 10, radius: 6, heal: 4,
      },
      {
        id: 'flash_step', name: 'Flash Step', bot: 'escape',
        description: 'Blink 6 units forward in a burst of gold, leaving a blinding afterimage (1.2s blind nearby).',
        cooldown: 10, distance: 6, blind: 1.2, blindRadius: 7,
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
        id: 'aegis_void', name: 'Aegis of the Void', bot: 'ally',
        description: 'A hexagonal dome of unmade space. For 3s every Monster attack against you and allies within 3u simply fails.',
        cooldown: 18, range: 0, damage: 0, shieldDuration: 3, shieldRadius: 3,
      },
      {
        id: 'black_slash', name: 'Black Slash', bot: 'target',
        description: 'A crimson-black wave of anti-magic that cancels the Monster’s attack and strips its enrage for 8s.',
        cooldown: 9, range: 9, cone: 0.5, damage: 3, calm: 8,
      },
      {
        id: 'null_zone', name: 'Null Zone', bot: 'ally',
        description: 'An anti-magic field for 6s: inside it, lights stop flickering and terror cannot touch you.',
        cooldown: 18, radius: 6, duration: 6,
      },
      {
        id: 'bull_thrust', name: 'Bull Thrust', bot: 'target',
        description: 'A cloaked shoulder-charge 5u forward that knocks the Monster back 3u and draws its rage to you.',
        cooldown: 12, distance: 5, knock: 3, hitRadius: 2.5, taunt: 5, range: 6,
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

/** Ultimate charge (0–100) sources. */
export const ULT = {
  MAX: 100,
  HIT: 8, // landing a normal spell on a monster
  CHASED: 2, // per second while the Amalgam hunts you
  HEART: 25, // team-wide, per destroyed Heart
  RESCUE: 20, // breaking the lock with someone inside
  PASSIVE: 0.4, // per second, once the Tome is read
};

/** In the Archon phase every ability is available at this fraction of its cooldown. */
export const ARCHON_COOLDOWN_SCALE = 0.25;
