// Narrative data: room types, heart disguises, room tasks, and the text of the
// Ritual Book.

/**
 * Room types. `floor` says where they may appear ('ground', 'upper',
 * 'basement'); `size` drives which generated rooms they are assigned to
 * ('special' rooms are placed by the generator itself). `hint` completes a
 * Tome clue: "Seek it <hint>."
 */
export const ROOM_TYPES = {
  // ---- Floor 1 (ground)
  foyer: { name: 'Grand Foyer', floor: 'ground', size: 'special', hint: 'where every guest first wiped their feet' },
  library: { name: 'Library', floor: 'ground', size: 'special', hint: 'among the shelves of names no one reads' },
  altar: { name: 'Chapel of the Altar', floor: 'ground', size: 'special', hint: 'before the altar that began all of this' },
  stairwell: { name: 'Servants’ Stairwell', floor: 'ground', size: 'special', hint: 'where the servants’ stair goes down into the cold' },
  stairhall: { name: 'West Stair Hall', floor: 'ground', size: 'special', hint: 'at the foot of the other stair, the one the family used' },
  banquet: { name: 'Banquet Hall', floor: 'ground', size: 'special', hint: 'where the dead were dressed for dinner' },
  armory: { name: 'Armory Hall', floor: 'ground', size: 'special', hint: 'where the empty suits of armour stand guard' },
  nursery: { name: 'Nursery', floor: 'ground', size: 'special', hint: 'where a cradle rocks with no one in it' },

  conservatory: { name: 'Conservatory', floor: 'ground', size: 'large', hint: 'where nothing green has grown for a century' },
  music: { name: 'Music Room', floor: 'ground', size: 'large', hint: 'where the piano plays itself at three in the morning' },
  parlor: { name: 'Parlor', floor: 'ground', size: 'medium', hint: 'where polite company once whispered about the family' },
  billiard: { name: 'Billiard Room', floor: 'ground', size: 'medium', hint: 'where the gentlemen wagered on things that were not games' },
  trophy: { name: 'Trophy Room', floor: 'ground', size: 'medium', hint: 'where the hunted are mounted on the walls' },
  kitchen: { name: 'Kitchen', floor: 'ground', size: 'medium', hint: 'where the meat was prepared for the ritual feast' },
  servants: { name: 'Servants’ Quarters', floor: 'ground', size: 'small', hint: 'where the help was told not to listen at night' },
  washroom: { name: 'Washroom', floor: 'ground', size: 'small', hint: 'where the water still runs warm and red' },
  smoking: { name: 'Smoking Room', floor: 'ground', size: 'small', hint: 'where the smoke never quite clears' },
  drawing_room: { name: 'Drawing Room', floor: 'ground', size: 'large', hint: 'where the ladies withdrew and did not come back' },
  gun_room: { name: 'Gun Room', floor: 'ground', size: 'medium', hint: 'where the guns are oiled for a hunt that never ends' },
  pantry: { name: 'Pantry', floor: 'ground', size: 'small', hint: 'where the jars hold things that were never food' },
  cloakroom: { name: 'Cloakroom', floor: 'ground', size: 'small', hint: 'where the guests’ coats still hang, a century unclaimed' },

  // ---- Floor 2 (upper story)
  gallery: { name: 'Balcony Gallery', floor: 'upper', size: 'special', hint: 'on the balcony that looks down upon the Foyer' },
  landing: { name: 'Upper Stair Landing', floor: 'upper', size: 'special', hint: 'at the head of the family stair' },
  ballroom: { name: 'Grand Ballroom', floor: 'upper', size: 'special', hint: 'where the last dance never ended' },
  master_study: { name: 'Master Study', floor: 'upper', size: 'special', hint: 'where the master wrote the letters he never sent' },
  rose_bedroom: { name: 'Rose Bedroom', floor: 'upper', size: 'special', hint: 'where the roses on the wallpaper never wilt' },
  observatory: { name: 'Observatory', floor: 'upper', size: 'special', hint: 'beneath the dome where he counted the stars he was owed' },
  alchemy: { name: 'Alchemy Wing', floor: 'upper', size: 'special', hint: 'among the alembics where he boiled his own blood' },

  master_bedroom: { name: 'Master Bedroom', floor: 'upper', size: 'large', hint: 'where the lord of the house lay down and did not rise' },
  portrait_hall: { name: 'Portrait Hall', floor: 'upper', size: 'large', hint: 'where the ancestors watch from their frames' },
  guest_bedroom: { name: 'Guest Bedroom', floor: 'upper', size: 'medium', hint: 'where visitors slept and some never woke' },
  sewing: { name: 'Sewing Room', floor: 'upper', size: 'medium', hint: 'where the dolls were stitched together' },
  marble_bath: { name: 'Marble Bath', floor: 'upper', size: 'medium', hint: 'where the bathwater never drains' },
  linen: { name: 'Linen Room', floor: 'upper', size: 'small', hint: 'where the sheets are folded over shapes' },
  clock_room: { name: 'Clock Room', floor: 'upper', size: 'small', hint: 'where every clock stopped at the same minute' },
  reading_room: { name: 'Reading Room', floor: 'upper', size: 'large', hint: 'where the same page has been open for a hundred years' },
  map_room: { name: 'Map Room', floor: 'upper', size: 'medium', hint: 'where the maps show rooms this house does not have' },
  dressing_room: { name: 'Dressing Room', floor: 'upper', size: 'small', hint: 'where the gowns still hold the shape of their owners' },
  card_room: { name: 'Card Room', floor: 'upper', size: 'small', hint: 'where the last hand was dealt to a dead man' },

  // ---- Basement
  antechamber: { name: 'Cellar Antechamber', floor: 'basement', size: 'basement', hint: 'at the foot of the servants’ stair' },
  crypt: { name: 'Family Crypt', floor: 'basement', size: 'basement', hint: 'among the family who were buried twice' },
  wine_cellar: { name: 'Wine Cellar', floor: 'basement', size: 'basement', hint: 'where the casks hold something thicker than wine' },
  ossuary: { name: 'Ossuary', floor: 'basement', size: 'basement', hint: 'where the bones are stacked like firewood' },
  cell: { name: 'Underground Cage Prison', floor: 'basement', size: 'basement', hint: 'inside the iron cage' },
};

/** The seven Hearts, the ordinary props they hide among, and the Sin each one holds. */
export const HEART_TYPES = {
  mirror: {
    name: 'The Cursed Mirror',
    prop: 'mirror',
    decoyName: 'an old mirror',
    sin: 'pride',
    riddle: 'A glass that shows you as you will look afterwards.',
  },
  painting: {
    name: 'The Bleeding Painting',
    prop: 'painting',
    decoyName: 'a portrait',
    sin: 'wrath',
    riddle: 'A face in oils that weeps what oils cannot.',
  },
  clock: {
    name: 'The Beating Clock',
    prop: 'clock',
    decoyName: 'a grandfather clock',
    sin: 'sloth',
    riddle: 'A pendulum that keeps a pulse instead of the hour.',
  },
  doll: {
    name: 'The Weeping Doll',
    prop: 'doll',
    decoyName: 'a porcelain doll',
    sin: 'envy',
    riddle: 'A porcelain child whose eyes follow you, and grieve.',
  },
  musicbox: {
    name: 'The Whispering Music Box',
    prop: 'musicbox',
    decoyName: 'a music box',
    sin: 'lust',
    riddle: 'A lullaby that whispers your name between the notes.',
  },
  candelabra: {
    name: 'The Black Candelabra',
    prop: 'candelabra',
    decoyName: 'a candelabra',
    sin: 'greed',
    riddle: 'Five candles burning with a flame that gives no light.',
  },
  skull: {
    name: 'The Grinning Skull',
    prop: 'skull',
    decoyName: 'a skull on a stand',
    sin: 'gluttony',
    riddle: 'A jaw that still chews, though nothing has fed it in a hundred years.',
  },
};

export const HEART_TYPE_IDS = Object.keys(HEART_TYPES);

/**
 * The 3-part room task that seals each Heart. Three task props stand in the
 * Heart's room; completing all three unseals the Cursed Heart Artifact.
 * `time` = seconds of holding E per step.
 */
export const TASKS = {
  brazier: {
    prop: 'brazier',
    label: 'Light the runic brazier',
    done: 'The rune-fire burns',
    time: 1.4,
    intro: 'Three cold runic braziers ring this room.',
  },
  mirror: {
    prop: 'rune_mirror',
    label: 'Turn the rune mirror',
    done: 'The mirror catches the light',
    time: 0.6,
    turns: true, // each needs 1–3 turns before it faces the Heart
    intro: 'Three rune mirrors hang crooked on the walls.',
  },
  pedestal: {
    prop: 'pedestal',
    label: 'Wind the clockwork pedestal',
    done: 'The clockwork ticks',
    time: 2.2,
    intro: 'Three clockwork pedestals have wound down.',
  },
  chalice: {
    prop: 'chalice',
    label: 'Place a cursed coin in the chalice',
    done: 'A coin rests in the chalice',
    time: 1.0,
    intro: 'Three empty chalices wait for their payment.',
  },
};
export const TASK_KINDS = Object.keys(TASKS);
export const TASK_STEPS = 3;

export function makeClue(heartType, roomType) {
  return `${HEART_TYPES[heartType].riddle} Seek it ${ROOM_TYPES[roomType].hint}.`;
}

export const DECOY_LINES = [
  'Just an ordinary {name}. For now.',
  'You touch {name}. Cold. Silent. Nothing beats inside.',
  'Dust on {name}. Whatever you are looking for, it is not this.',
  '{name}. You could swear it moved a moment ago.',
];

export const TOME_TEXT = [
  'Here is written the Forbidden Convergence, set down by the last lord of this house, who wished to never die.',
  'I cut my heart into seven and sealed each piece in a thing my family loved, and set one of the Seven Sins to keep it. While one heart beats, the Keeper of this house cannot be unmade. Do not try. Hide.',
  'Each heart is warded by its room: light what is cold, turn what is crooked, wind what has stopped, pay what is owed. Break the wards, and the heart will open, and its Sin will come out to meet you. The doors will not let you leave until one of you is dead.',
  'You who read this have woken it. It will not kill you. It will keep you, below, in the iron cage, until all of you are kept.',
  'Silence the seven. Then go to the altar, and give it what it has always wanted: more than one soul in a single body.',
];
