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

/**
 * The seven Hearts (Step 7): one thematic centrepiece per Sin, each in its own
 * room, keyed by Sin. `prop` is the centrepiece's model; `room` the room type.
 */
export const HEARTS = {
  pride: {
    name: 'Lucifer’s Crowned Vanity', prop: 'crowned_vanity', room: 'ballroom',
    riddle: 'A crown upon a looking-glass that has only ever adored itself.',
  },
  greed: {
    name: 'Mammon’s Locked Vault Coffer', prop: 'vault_coffer', room: 'master_study',
    riddle: 'A coffer that will open only when its master’s gold is weighed.',
  },
  lust: {
    name: 'Asmodeus’s Crimson Velvet Portrait', prop: 'velvet_portrait', room: 'rose_bedroom',
    riddle: 'A face in crimson velvet that wants you to come closer.',
  },
  envy: {
    name: 'Leviathan’s Green-Glass Astrolabe Clock', prop: 'astrolabe_clock', room: 'observatory',
    riddle: 'A clock of green glass that keeps the hours of everyone else’s happiness.',
  },
  gluttony: {
    name: 'Beelzebub’s Overflowing Feast Chalice', prop: 'feast_chalice', room: 'banquet',
    riddle: 'A cup that has never once been empty, at the head of a feast that never ends.',
  },
  wrath: {
    name: 'Satan’s Brazen War-Bell', prop: 'war_bell', room: 'armory',
    riddle: 'A bell that rings for every battle, and has never rung for peace.',
  },
  sloth: {
    name: 'Belphegor’s Slumbering Cradle Box', prop: 'cradle_box', room: 'nursery',
    riddle: 'A cradle-box that rocks itself to sleep, and wants you to sleep too.',
  },
};
export const HEART_SINS = Object.keys(HEARTS);
// (Kept names for older call sites.)
export const HEART_TYPES = HEARTS;
export const HEART_TYPE_IDS = HEART_SINS;

/**
 * The 3-part task in each Heart's room, by Sin. Three `prop`s (sources);
 * carry tasks also have a `sink`: take one item from a source, bring it to
 * the sink. `time` / `takeTime` = seconds of holding E.
 */
export const TASKS = {
  pride: {
    prop: 'ego_mirror', label: 'Shatter Vanity Mirror', done: 'The mirror lies in shards', time: 1.2,
    objective: 'Shatter the 3 Tall Gilded Ego Mirrors',
  },
  greed: {
    prop: 'display_case', sink: 'weighing_scale', carry: 'ingot', time: 0.9, takeTime: 0.6,
    take: 'Take Gold Ingot from Display Case', label: 'Weigh Ingot on Scale', done: 'The case is empty',
    objective: 'Weigh Stolen Gold Ingots on Mammon’s Scale',
  },
  lust: {
    prop: 'silk_cocoon', label: 'Burn Silk Veil with Wand', done: 'Only ash remains of the veil', time: 1.5,
    objective: 'Burn away the 3 Enchanted Crimson Silk Cocoons',
  },
  envy: {
    prop: 'envy_portrait', label: 'Deface Watching Portrait', done: 'Its jealous eyes are slashed out', time: 1.2,
    objective: 'Deface the 3 Jealous Noble Portraits',
  },
  gluttony: {
    prop: 'feast_platter', sink: 'feast_furnace', carry: 'platter', time: 0.9, takeTime: 0.6,
    take: 'Take Rotting Feast Platter', label: 'Dump Cursed Feast Platter', done: 'The platter is gone',
    objective: 'Dump the 3 Rotting Feast Platters into the Furnace',
  },
  wrath: {
    prop: 'crucible_sword', label: 'Quench Molten Blade in Blood Trough', done: 'The blade hisses and cools', time: 1.6,
    objective: 'Quench the 3 Red-Hot Crucible Greatswords',
  },
  sloth: {
    prop: 'metronome', label: 'Wind Slumbering Mechanism', done: 'The pendulum swings awake', time: 2.0,
    objective: 'Wind the 3 Heavy Pendulum Metronomes',
  },
};
export const TASK_KINDS = Object.keys(TASKS);
export const TASK_STEPS = 3;
/** Ordinary heirlooms scattered as curios (examining one makes noise). */
export const CURIO_KINDS = ['mirror', 'painting', 'clock', 'doll', 'musicbox', 'candelabra', 'skull'];

export function makeClue(sin, roomType) {
  return `${HEARTS[sin].riddle} Seek it ${ROOM_TYPES[roomType].hint}. ${TASKS[sin].objective} to unseal it.`;
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
  'Each heart is warded by its room and by its Sin: shatter the vain glass, weigh the stolen gold, burn the silk, blind the jealous eyes, feed the furnace, quench the angry steel, wake what sleeps. Break the three wards, and the heart will open, and its Sin will come out to meet you. The doors will not let you leave until one of you is dead.',
  'You who read this have woken it. It will not kill you. It will keep you, below, in the iron cage, until all of you are kept.',
  'Silence the seven. Then go to the altar, and give it what it has always wanted: more than one soul in a single body.',
];
