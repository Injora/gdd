// Phase III (the Forbidden Spell, Soul Merge, the Unbound Amalgam, the Hell
// Portal) tuning, shared by server and client.

export const FINALE = {
  RITUAL_TIME: 6, // seconds of unbroken chanting by every wizard
  RITUAL_DECAY: 0.15, // progress lost per second while anyone stops
  MERGE_TIME: 3, // the Soul Merge cinematic
  ARCHON_HP: 500,
  ARCHON_SPEED: 1.25, // × normal movement
  ARCHON_EYE: 3.0, // a towering vantage
  BOSS_HP: 300,
  BOSS_SPELL_SCALE: 2.5, // normal spells hit the boss this much harder (the Archon is supercharged)
  BOSS_CC_CAP: 2.5, // no crowd control holds the Unbound one longer than this
  WARDS: [0.66, 0.4], // HP fractions where it raises an invulnerable ward
  WARD_TIME: 4,
  PORTAL_AT: 0.2, // HP fraction where the Hell Portal tears open
  PORTAL_RADIUS: 2.6, // within this of the rift, it's dragged under
  CRAWL_SPEED: 1.3, // it claws away from the portal unless bound
  GRAPPLE_RANGE: 14,
  GRAPPLE_PULL: 1.5, // per grappling wizard (max 3)
  SEAL_TIME: 3,
  ORB_SPEED: 7,
  ORB_DAMAGE: 15,
  ORB_LIFE: 4,
  VOLLEY_EVERY: 4.5,
  WAVE_EVERY: 7,
  WAVE_WINDUP: 1,
  WAVE_SPEED: 9,
  WAVE_RANGE: 13,
  WAVE_DAMAGE: 25,
  CHARGE_EVERY: 9,
  CHARGE_WINDUP: 0.8,
  CHARGE_SPEED: 12,
  CHARGE_TIME: 0.6,
  CHARGE_DAMAGE: 40,
};

/** Keys 1–7 in Archon form: the seven combined Elemental Masteries (cooldowns shared by the one body). */
export const MASTERIES = [
  { id: 'm_fire_dragon', key: 1, name: 'Fire Dragon', element: 'fire', color: '#ff5a1f', cooldown: 8, damage: 25, glyph: '✹' },
  { id: 'm_wind_dragon', key: 2, name: 'Wind Dragon', element: 'wind', color: '#9ef0e0', cooldown: 9, damage: 10, push: 6, glyph: '≈' },
  { id: 'm_water_deluge', key: 3, name: 'Water Deluge', element: 'water', color: '#2fa8ff', cooldown: 6, damage: 15, slow: 0.5, glyph: '♒' },
  { id: 'm_earth_pillars', key: 4, name: 'Earth Pillars', element: 'earth', color: '#8bb33a', cooldown: 8, damage: 18, root: 2.5, glyph: '▲' },
  { id: 'm_white_chains', key: 5, name: 'White Chains', element: 'white', color: '#fff6d8', cooldown: 10, damage: 8, freeze: 2.5, glyph: '☉' },
  { id: 'm_black_torment', key: 6, name: 'Black Torment', element: 'black', color: '#7a3cff', cooldown: 7, damage: 12, interrupt: 2.5, glyph: '☾' },
  { id: 'm_antimagic_slash', key: 7, name: 'Anti-Magic Slash', element: 'void', color: '#c0102a', cooldown: 6, damage: 20, cone: 0.6, range: 15, glyph: '⚔' },
];
