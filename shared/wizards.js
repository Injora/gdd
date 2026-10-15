// The seven playable wizards. Ability numbers here are the single source of
// truth for the server simulation (server/SpellSystem.js) and the client HUD.
//
// Distances are world units (1 tile = 2 units). Durations/cooldowns in seconds.
// `cone` is the half-angle (radians) of the aim cone a target must be inside.

export const WIZARDS = [
  {
    id: 'injorath',
    name: 'Injorath Blackthorn',
    title: 'Heir of the Forbidden Arts',
    element: 'Black',
    color: '#7a3cff',
    lightTint: '#c9b8ff',
    ability: {
      id: 'psychic_torment',
      name: 'Psychic Torment',
      description:
        'A wave of black-violet dread floods the Monster’s mind with its own victims. No damage, but it shrieks in agony, abandons its chase for 2s, and its silhouette burns through the walls for the whole coven for 6s.',
      cooldown: 16,
      range: 22,
      cone: 0.5,
      damage: 0,
      interrupt: 2.0,
      reveal: 6.0,
    },
    bio: 'Last of a bloodline that wrote the Forbidden Arts and then tried to forget them.',
    epilogue: 'The Blackthorn hearth burns a clean, ordinary gold now. Their children have never heard a whisper in the walls.',
  },
  {
    id: 'parthius',
    name: 'Parthius Pyreborne',
    title: 'Infernal Prodigy',
    element: 'Fire',
    color: '#ff5a1f',
    lightTint: '#ffd2a8',
    ability: {
      id: 'ignis_blast',
      name: 'Ignis Blast',
      description:
        'A roaring fireball that lights the corridors it flies through. Chips the Monster’s health, sets it burning (damage over time, slight slow), and leaves a glowing scorch for 4s.',
      cooldown: 5,
      range: 30,
      damage: 4,
      projectileSpeed: 18,
      projectileRadius: 0.25,
      burnDps: 1,
      burnDuration: 3,
      burnSlow: 0.15,
      scorchDuration: 4,
    },
    bio: 'Set the academy observatory alight at nine years old. Has been apologising with skill ever since.',
    epilogue: 'Pyreborne lanterns line the village road. The family keeps the fire for festivals, never for fear.',
  },
  {
    id: 'himandriel',
    name: 'Himandriel Tidecrest',
    title: 'Lord of the Tidal Arts',
    element: 'Water',
    color: '#2fa8ff',
    lightTint: '#bfe6ff',
    ability: {
      id: 'tidal_surge',
      name: 'Tidal Surge',
      description:
        'A surging wave across the floor. Chips the Monster’s health, slows it by 40% for 4s, and leaves a slick puddle for 4s that slows and staggers the turns of anything inside.',
      cooldown: 9,
      range: 10,
      cone: 0.55,
      damage: 3,
      slow: 0.4,
      slowDuration: 4,
      turnSlow: 0.5,
      puddleRadius: 3,
      puddleDuration: 4,
    },
    bio: 'Raised on a storm coast where the tide was the only teacher that never lied.',
    epilogue: 'The Tidecrest children race paper boats down a clear river that once ran red.',
  },
  {
    id: 'sushantus',
    name: 'Sushantus Thornwick',
    title: 'Warden of the Ancient Grounds',
    element: 'Earth',
    color: '#8bb33a',
    lightTint: '#e2f0c4',
    ability: {
      id: 'terra_spike',
      name: 'Terra Spike',
      description:
        'Jagged stone erupts from the floor. Chips the Monster’s health in front of you and raises a 3-tile barricade that seals corridors and doorways for 5s.',
      cooldown: 12,
      range: 6,
      cone: 0.4,
      damage: 3,
      wallDuration: 5,
      wallTiles: 3, // width, perpendicular to the cast direction
      wallDistance: 2, // tiles ahead of the caster
    },
    bio: 'Speaks to old stones. Most of them have nothing kind to say about this mansion.',
    epilogue: 'Thornwick orchards climb the hill behind the manor. The roots hold the earth, and the earth holds still.',
  },
  {
    id: 'kartavian',
    name: 'Kartavian Windermere',
    title: 'Tempest Sovereign',
    element: 'Wind',
    color: '#9ef0e0',
    lightTint: '#e8fffa',
    ability: {
      id: 'gale_force',
      name: 'Gale Force',
      description:
        'A howling tunnel of wind. No damage, but it hurls the Monster 5 units directly away from you. Walls still stop it.',
      cooldown: 8,
      range: 9,
      cone: 0.6,
      damage: 0,
      knockback: 5,
      knockbackTime: 0.3,
    },
    bio: 'Was born during a hurricane and has never once been late.',
    epilogue: 'Windermere kites dance over green fields. The wind only carries laughter now.',
  },
  {
    id: 'soham',
    name: 'Soham Everlight',
    title: 'Luminary of the Sacred Order',
    element: 'White',
    color: '#fff6d8',
    lightTint: '#fffaf0',
    ability: {
      id: 'sacred_bind',
      name: 'Sacred Bind',
      description:
        'A blinding golden burst binds the Monster in sigils. Stuns and blinds it in place for 3.5s. Passive: breaks the Ritual Cell lock twice as fast.',
      cooldown: 20,
      range: 12,
      cone: 0.5,
      damage: 0,
      stun: 3.5,
    },
    passive: { gateUnlockSpeed: 2 },
    bio: 'The Order’s youngest Luminary. Carries the light the way others carry a blade.',
    epilogue: 'Morning comes to the Everlight home every day, and every day it is welcomed.',
  },
  {
    id: 'himanshu',
    name: 'Himanshu Nullgrave',
    title: 'The Unspellable',
    element: 'Anti-magic',
    color: '#9aa3ad',
    lightTint: '#e6ebf0',
    ability: {
      id: 'aegis_void',
      name: 'Aegis of the Void',
      description:
        'An iridescent hexagonal dome of unmade space. For 3s every Monster attack or lunge against you and allies within 3 units simply fails.',
      cooldown: 18,
      range: 0,
      damage: 0,
      shieldDuration: 3,
      shieldRadius: 3,
    },
    bio: 'No spell has ever landed on them. Nobody, including Himanshu, knows why.',
    epilogue: 'The Nullgrave house is quiet in the best way: no curses, no omens, just supper and stories.',
  },
];

export const WIZARD_BY_ID = Object.fromEntries(WIZARDS.map((w) => [w.id, w]));
export const ABILITY_BY_ID = Object.fromEntries(WIZARDS.map((w) => [w.ability.id, w.ability]));

/** In the Archon phase every ability is available at this fraction of its cooldown. */
export const ARCHON_COOLDOWN_SCALE = 0.25;
