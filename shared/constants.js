// Constants shared by server and client. Keep this file free of Node/DOM APIs.

/** World units per map tile. */
export const TILE = 2;
export const WALL_HEIGHT = 4;
/** World-space Y of each floor (0 = ground floor, 1 = basement). */
export const FLOOR_Y = [0, -14];

export const TILE_WALL = 0;
export const TILE_FLOOR = 1;
export const TILE_DOOR = 2;

export const PLAYER_RADIUS = 0.35;
export const EYE_HEIGHT = 1.62;
export const CROUCH_EYE_HEIGHT = 1.05;
export const SPEED = { walk: 3.2, sprint: 5.6, crouch: 1.6 };
export const STAMINA = { max: 100, drain: 24, regen: 14, minToSprint: 20 };

export const INTERACT_RANGE = 2.6;
/** Seconds a player must hold Interact to finish each action. */
export const CHANNEL = { tome: 2.0, heart: 2.5, gate: 3.0 };

export const TICK_RATE = 20;
export const NET_SEND_RATE = 20;

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 4;
export const HEART_COUNT = 6;

export const PHASE = Object.freeze({
  LOBBY: 'lobby',
  TOME: 'tome', // Phase 1: find and read the Ritual Book
  HEARTS: 'hearts', // Phase 2: destroy the six Hearts
  CONVERGENCE: 'convergence', // Phase 2 complete: return to the altar
  ARCHON: 'archon', // Phase 3: Soul Merge boss fight
  EPILOGUE: 'epilogue', // Phase 4: ending
  GAMEOVER: 'gameover',
});

export const DIRS = [
  [0, -1], // 0 north (-z)
  [1, 0], // 1 east (+x)
  [0, 1], // 2 south (+z)
  [-1, 0], // 3 west (-x)
];

export const tileCenter = (t) => (t + 0.5) * TILE;
export const worldToTile = (w) => Math.floor(w / TILE);

/**
 * Yaw convention (matches a Three.js camera with rotation order 'YXZ'):
 * forward = (-sin(yaw), 0, -cos(yaw)). yaw 0 looks north (-z).
 */
export const yawFromDir = (dx, dz) => Math.atan2(-dx, -dz);
/** Rotation for a prop whose model faces +z, so that it faces (dx, dz). */
export const propRotFromDir = (dx, dz) => Math.atan2(dx, dz);
