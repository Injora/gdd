// Physical definition of every prop kind: footprint size (world units) used
// for collision, whether it blocks movement, and how it is mounted.
//
//   w     width along the wall it backs onto (or local X for free-standing props)
//   d     depth away from the wall (local Z)
//   mount 'wall'  = hangs on the wall, never blocks
//         'floor' = stands on the floor (against a wall or free-standing)
//         'none'  = decal / ceiling decoration, occupies nothing
//   len   number of tiles the prop spans along its facing axis (beds, long tables)

export const PROP_DEFS = {
  // Interactables
  tome: { w: 0.8, d: 0.7, blocks: true, mount: 'floor', interact: 'tome' },
  altar: { w: 2.2, d: 1.3, blocks: true, mount: 'floor', interact: 'altar' },
  stairs_down: { w: 1.9, d: 1.9, blocks: true, mount: 'floor', interact: 'stairs' },
  stairs_up: { w: 1.9, d: 1.9, blocks: true, mount: 'floor', interact: 'stairs' },
  // The family's spiral stairs between Floor 1 and Floor 2 (the pair share one tile column).
  grand_stair: { w: 1.9, d: 1.9, blocks: true, mount: 'floor', interact: 'stairs' },
  stairs_landing: { w: 1.9, d: 1.9, blocks: true, mount: 'floor', interact: 'stairs' },
  gate: { w: 2.0, d: 0.3, blocks: true, mount: 'floor', interact: 'gate', dynamic: true },
  mirror: { w: 1.0, d: 0.12, blocks: false, mount: 'wall', interact: 'curio' },
  painting: { w: 1.2, d: 0.1, blocks: false, mount: 'wall', interact: 'curio' },
  clock: { w: 0.75, d: 0.5, blocks: true, mount: 'floor', interact: 'curio' },
  doll: { w: 0.7, d: 0.7, blocks: true, mount: 'floor', interact: 'curio' },
  musicbox: { w: 0.7, d: 0.7, blocks: true, mount: 'floor', interact: 'curio' },
  candelabra: { w: 0.7, d: 0.7, blocks: true, mount: 'floor', interact: 'curio' },
  skull: { w: 0.7, d: 0.7, blocks: true, mount: 'floor', interact: 'curio' },

  // Step 7: the seven Sin Hearts (thematic centrepieces)
  crowned_vanity: { w: 1.4, d: 0.7, blocks: true, mount: 'floor', interact: 'curio' },
  vault_coffer: { w: 0.9, d: 0.9, blocks: true, mount: 'floor', interact: 'curio' },
  velvet_portrait: { w: 1.4, d: 0.12, blocks: false, mount: 'wall', interact: 'curio' },
  astrolabe_clock: { w: 0.9, d: 0.9, blocks: true, mount: 'floor', interact: 'curio' },
  feast_chalice: { w: 0.8, d: 0.8, blocks: true, mount: 'floor', interact: 'curio' },
  war_bell: { w: 1.2, d: 1.2, blocks: true, mount: 'floor', interact: 'curio' },
  cradle_box: { w: 1.1, d: 0.8, blocks: true, mount: 'floor', interact: 'curio' },

  // Step 7: the seven Sins' thematic room tasks (three sources each; two have a sink)
  ego_mirror: { w: 0.9, d: 0.35, blocks: true, mount: 'floor', interact: 'task' },
  display_case: { w: 1.0, d: 0.6, blocks: true, mount: 'floor', interact: 'task' },
  weighing_scale: { w: 0.9, d: 0.7, blocks: true, mount: 'floor', interact: 'task' },
  silk_cocoon: { w: 0.9, d: 0.8, blocks: true, mount: 'floor', interact: 'task' },
  envy_portrait: { w: 1.1, d: 0.1, blocks: false, mount: 'wall', interact: 'task' },
  feast_platter: { w: 0.8, d: 0.8, blocks: true, mount: 'floor', interact: 'task' },
  feast_furnace: { w: 1.6, d: 0.8, blocks: true, mount: 'floor', interact: 'task' },
  crucible_sword: { w: 1.2, d: 0.6, blocks: true, mount: 'floor', interact: 'task' },
  metronome: { w: 0.7, d: 0.7, blocks: true, mount: 'floor', interact: 'task' },

  // Step 6 room tasks (superseded by the Sin tasks; kept for old maps)
  brazier: { w: 0.8, d: 0.8, blocks: true, mount: 'floor', interact: 'task' },
  rune_mirror: { w: 0.9, d: 0.12, blocks: false, mount: 'wall', interact: 'task' },
  pedestal: { w: 0.7, d: 0.7, blocks: true, mount: 'floor', interact: 'task' },
  chalice: { w: 0.6, d: 0.6, blocks: true, mount: 'floor', interact: 'task' },

  // Furniture
  bookshelf: { w: 1.9, d: 0.5, blocks: true, mount: 'floor' },
  table: { w: 1.5, d: 1.0, blocks: true, mount: 'floor' },
  longtable: { w: 1.3, d: 5.6, blocks: true, mount: 'floor', len: 3 },
  chair: { w: 0.6, d: 0.6, blocks: true, mount: 'floor' },
  armchair: { w: 1.0, d: 0.9, blocks: true, mount: 'floor' },
  bed: { w: 1.7, d: 3.5, blocks: true, mount: 'floor', len: 2 },
  wardrobe: { w: 1.6, d: 0.7, blocks: true, mount: 'floor' },
  cabinet: { w: 1.4, d: 0.55, blocks: true, mount: 'floor' },
  desk: { w: 1.6, d: 0.8, blocks: true, mount: 'floor' },
  piano: { w: 1.7, d: 0.7, blocks: true, mount: 'floor' },
  pillar: { w: 0.8, d: 0.8, blocks: true, mount: 'floor' },
  statue: { w: 0.9, d: 0.9, blocks: true, mount: 'floor' },
  fireplace: { w: 1.9, d: 0.6, blocks: true, mount: 'floor' },
  crib: { w: 1.3, d: 0.8, blocks: true, mount: 'floor' },
  rockinghorse: { w: 0.5, d: 1.1, blocks: true, mount: 'floor' },
  coffin: { w: 0.8, d: 1.9, blocks: true, mount: 'floor' },
  sarcophagus: { w: 1.1, d: 1.9, blocks: true, mount: 'floor' },
  barrel: { w: 0.85, d: 0.85, blocks: true, mount: 'floor' },
  crate: { w: 0.95, d: 0.95, blocks: true, mount: 'floor' },
  pew: { w: 1.8, d: 0.6, blocks: true, mount: 'floor' },
  plant: { w: 0.7, d: 0.7, blocks: true, mount: 'floor' },
  billiard: { w: 1.5, d: 1.9, blocks: true, mount: 'floor' },
  bathtub: { w: 0.9, d: 1.8, blocks: true, mount: 'floor' },
  stove: { w: 1.4, d: 0.8, blocks: true, mount: 'floor' },
  antlers: { w: 1.0, d: 0.2, blocks: false, mount: 'wall' },
  sconce: { w: 0.3, d: 0.2, blocks: false, mount: 'wall' },
  shackles: { w: 0.8, d: 0.15, blocks: false, mount: 'wall' },
  armor: { w: 0.8, d: 0.7, blocks: true, mount: 'floor' },
  weaponrack: { w: 1.6, d: 0.4, blocks: true, mount: 'floor' },
  telescope: { w: 1.0, d: 1.0, blocks: true, mount: 'floor' },
  globe: { w: 0.8, d: 0.8, blocks: true, mount: 'floor' },
  cauldron: { w: 1.0, d: 1.0, blocks: true, mount: 'floor' },
  alembic: { w: 1.5, d: 0.8, blocks: true, mount: 'floor' },
  window: { w: 1.2, d: 0.1, blocks: false, mount: 'wall' },

  // Decals / ceiling
  rug: { w: 3.0, d: 2.0, blocks: false, mount: 'none' },
  ritualcircle: { w: 3.6, d: 3.6, blocks: false, mount: 'none' },
  chandelier: { w: 1.2, d: 1.2, blocks: false, mount: 'none' },
  candles: { w: 0.6, d: 0.6, blocks: false, mount: 'none' },
};

/** Labels shown in the interaction prompt for non-heart props. */
export const PROP_LABELS = {
  mirror: 'old mirror',
  painting: 'portrait',
  clock: 'grandfather clock',
  doll: 'porcelain doll',
  musicbox: 'music box',
  candelabra: 'candelabra',
  skull: 'skull',
};
