// The seven playable wizards. Ability numbers here are the single source of
// truth for both the server simulation (Step 3) and the client cooldown UI.
//
// Distances are world units (1 tile = 2 units). Durations/cooldowns in seconds.

export const WIZARDS = [
  {
    id: 'injorath',
    name: 'Injorath Blackthorn',
    title: 'Heir of the Forbidden Arts',
    element: 'Black',
    color: '#7a3cff',
    lightTint: '#c9b8ff',
    ability: {
      id: 'mental_torture',
      name: 'Mental Torture',
      description:
        'Floods the Monster’s mind with its own victims. No damage, but it shrieks in agony, abandons its chase for 2s, and its silhouette burns through walls for the whole coven.',
      cooldown: 16,
      range: 22,
      damage: 0,
      interrupt: 2.0,
      reveal: 5.0,
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
      id: 'fireball',
      name: 'Fireball',
      description:
        'Hurls a roaring fireball. Chips the Monster’s health and leaves burning embers that light the dark for 8s.',
      cooldown: 5,
      range: 30,
      damage: 4,
      projectileSpeed: 18,
      lightDuration: 8,
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
      id: 'tidal_wave',
      name: 'Tidal Wave',
      description:
        'A crashing wall of black water. Chips the Monster’s health and drags at its limbs, slowing it by 40% for 4s.',
      cooldown: 9,
      range: 14,
      damage: 3,
      slow: 0.4,
      slowDuration: 4,
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
      id: 'earth_wall',
      name: 'Earth Wall',
      description:
        'A tremor tears up the floor. Chips the Monster’s health and raises a stone barricade that blocks the way for 5s.',
      cooldown: 12,
      range: 6,
      damage: 3,
      wallDuration: 5,
      wallWidth: 4,
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
      id: 'gale_push',
      name: 'Gale Push',
      description:
        'A focused gale. No damage, but it hurls the Monster 5 units directly away from the caster.',
      cooldown: 8,
      range: 9,
      damage: 0,
      knockback: 5,
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
      id: 'sacred_flash',
      name: 'Sacred Flash',
      description:
        'A blinding burst of consecrated light. Stuns and blinds the Monster in place for 3.5s.',
      cooldown: 20,
      range: 12,
      damage: 0,
      stun: 3.5,
    },
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
      id: 'void_shield',
      name: 'Void Shield',
      description:
        'Unmakes the space around you. For 3s the Monster’s attacks and lunges fail against the caster and every ally within 6 units.',
      cooldown: 18,
      range: 0,
      damage: 0,
      shieldDuration: 3,
      shieldRadius: 6,
    },
    bio: 'No spell has ever landed on them. Nobody, including Himanshu, knows why.',
    epilogue: 'The Nullgrave house is quiet in the best way: no curses, no omens, just supper and stories.',
  },
];

export const WIZARD_BY_ID = Object.fromEntries(WIZARDS.map((w) => [w.id, w]));

/** In the Archon phase every ability is available at this fraction of its cooldown. */
export const ARCHON_COOLDOWN_SCALE = 0.25;
