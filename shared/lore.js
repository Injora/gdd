// Narrative data: room types, heart disguises, and the text of the Ritual Book.

/**
 * Room types. `size` drives which generated rooms they are assigned to.
 * `hint` completes a Tome clue: "Seek it <hint>."
 */
export const ROOM_TYPES = {
  foyer: { name: 'Grand Foyer', size: 'special', hint: 'where every guest first wiped their feet' },
  library: { name: 'Library', size: 'special', hint: 'among the shelves of names no one reads' },
  altar: { name: 'Chapel of the Altar', size: 'special', hint: 'before the altar that began all of this' },
  stairwell: { name: 'Servants’ Stairwell', size: 'special', hint: 'where the servants’ stair goes down into the cold' },

  ballroom: { name: 'Ballroom', size: 'large', hint: 'where the last dance never ended' },
  dining: { name: 'Grand Dining Hall', size: 'large', hint: 'where the dead were dressed for dinner' },
  gallery: { name: 'Portrait Gallery', size: 'large', hint: 'where the ancestors watch from their frames' },
  conservatory: { name: 'Conservatory', size: 'large', hint: 'where nothing green has grown for a century' },
  music: { name: 'Music Room', size: 'large', hint: 'where the piano plays itself at three in the morning' },

  master_bedroom: { name: 'Master Bedroom', size: 'medium', hint: 'where the lord of the house lay down and did not rise' },
  parlor: { name: 'Parlor', size: 'medium', hint: 'where polite company once whispered about the family' },
  billiard: { name: 'Billiard Room', size: 'medium', hint: 'where the gentlemen wagered on things that were not games' },
  trophy: { name: 'Trophy Room', size: 'medium', hint: 'where the hunted are mounted on the walls' },
  kitchen: { name: 'Kitchen', size: 'medium', hint: 'where the meat was prepared for the ritual feast' },
  guest_bedroom: { name: 'Guest Bedroom', size: 'medium', hint: 'where visitors slept and some never woke' },

  nursery: { name: 'Nursery', size: 'small', hint: 'where a cradle rocks with no one in it' },
  study: { name: 'Study', size: 'small', hint: 'where the master wrote the letters he never sent' },
  servants: { name: 'Servants’ Quarters', size: 'small', hint: 'where the help was told not to listen at night' },
  washroom: { name: 'Washroom', size: 'small', hint: 'where the water still runs warm and red' },
  sewing: { name: 'Sewing Room', size: 'small', hint: 'where the dolls were stitched together' },
  smoking: { name: 'Smoking Room', size: 'small', hint: 'where the smoke never quite clears' },

  // Basement
  antechamber: { name: 'Cellar Antechamber', size: 'basement', hint: 'at the foot of the servants’ stair' },
  crypt: { name: 'Family Crypt', size: 'basement', hint: 'among the family who were buried twice' },
  wine_cellar: { name: 'Wine Cellar', size: 'basement', hint: 'where the casks hold something thicker than wine' },
  ossuary: { name: 'Ossuary', size: 'basement', hint: 'where the bones are stacked like firewood' },
  cell: { name: 'Basement Ritual Cell', size: 'basement', hint: 'inside the cell' },
};

/** The six Hearts and the ordinary props they hide among. */
export const HEART_TYPES = {
  mirror: {
    name: 'The Cursed Mirror',
    prop: 'mirror',
    decoyName: 'an old mirror',
    riddle: 'A glass that shows you as you will look afterwards.',
  },
  painting: {
    name: 'The Bleeding Painting',
    prop: 'painting',
    decoyName: 'a portrait',
    riddle: 'A face in oils that weeps what oils cannot.',
  },
  clock: {
    name: 'The Beating Clock',
    prop: 'clock',
    decoyName: 'a grandfather clock',
    riddle: 'A pendulum that keeps a pulse instead of the hour.',
  },
  doll: {
    name: 'The Weeping Doll',
    prop: 'doll',
    decoyName: 'a porcelain doll',
    riddle: 'A porcelain child whose eyes follow you, and grieve.',
  },
  musicbox: {
    name: 'The Whispering Music Box',
    prop: 'musicbox',
    decoyName: 'a music box',
    riddle: 'A lullaby that whispers your name between the notes.',
  },
  candelabra: {
    name: 'The Black Candelabra',
    prop: 'candelabra',
    decoyName: 'a candelabra',
    riddle: 'Five candles burning with a flame that gives no light.',
  },
};

export const HEART_TYPE_IDS = Object.keys(HEART_TYPES);

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
  'I cut my heart into six and hid each piece in a thing my family loved. While one heart beats, the Keeper of this house cannot be unmade.',
  'You who read this have woken it. It will not kill you. It will keep you, below, in the cell, until all of you are kept.',
  'Silence the six. Then go to the altar, and give it what it has always wanted: more than one soul in a single body.',
];
