# Architecture — SIX HEARTS: THE FORBIDDEN CONVERGENCE

## Quick start

```bash
npm install
npm start            # http://localhost:3666  (PORT=4000 npm start to change)
npm run dev          # same, restarts on server file changes
npm test             # map generator (60 seeds) + end-to-end socket test
```

Open `http://localhost:3666/?debug=1` and click **Solo test** to play with two bots. For real co-op, one player clicks **Summon a Coven** and the others **Join** with the 4-letter code. Use the LAN URL the server prints so other machines can connect.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Server | Node.js ≥ 20, Express 5, Socket.io 4 | Simple rooms, acks, WebSocket with fallback |
| Client | Vanilla ES modules + Three.js 0.186 via an import map | **No build step**: edit, refresh, play |
| Shared | Plain ES modules in `shared/` imported by both sides | One implementation of map generation, collision, pathfinding and balance numbers |
| Tests | `node:test` + `socket.io-client` | Zero extra frameworks |

Express serves `client/` at `/`, `shared/` at `/shared`, and `node_modules/three` at `/vendor/three`. `index.html` maps `three` → `/vendor/three/build/three.module.js`.

---

## Directory layout

```
server.js                 HTTP + Socket.io bootstrap (exports createGameServer for tests)
server/
  LobbyManager.js         covens: create/join codes, wizard picks, bots, ready, start
  Game.js                 one running match: authoritative state, 20 Hz tick, interactions
  Bot.js                  bot teammate brain (follow leader, A*, stairs, idle scan)
shared/                   ← imported by BOTH server and browser; no Node/DOM APIs
  constants.js            tile size, speeds, ranges, phases, yaw convention
  wizards.js              the seven wizards + ability numbers (balance source of truth)
  lore.js                 room types/hints, heart disguises + riddles, Tome text
  propdefs.js             prop footprints/colliders/mounting/interaction kinds
  mapgen.js               seeded mansion generator + publicMap() + roomAt()
  collision.js            circle-vs-grid/AABB movement, overlap test, line of sight
  pathfinding.js          A* (8-way, no corner cutting)
  rng.js                  mulberry32 PRNG
client/
  index.html, css/style.css
  js/main.js              boot: lobby UI ↔ GameClient
  js/net.js               socket wrapper (+ promise acks)
  js/game.js              GameClient: renderer, scene, loop, net glue, interactions
  js/ui/lobby.js          title + coven screens
  js/ui/hud.js            objective, hearts, prompts, banners, team list, journal
  js/world/textures.js    procedural canvas textures
  js/world/props.js       procedural prop models + heart "tell" animators
  js/world/MansionBuilder.js  instanced walls/floors/ceilings, props, lights, VFX
  js/player/FirstPersonController.js  pointer-lock FPS movement
  js/entities/WizardAvatar.js         remote teammate model + wand spotlight
  js/debug/DebugMap.js    top-down map (M), click-to-teleport in solo debug
test/
  mapgen.test.js          determinism + 60-seed validity/reachability
  server.test.js          full lobby → tome → 6 hearts → convergence → stairs over sockets
```

---

## Networking model

**The server decides the game; clients predict their own movement.**

- The server owns phase, Tome state, destroyed Hearts, prop state (gate), channels (timed interactions), bots, and later the Monster and abilities.
- Each client simulates its own wizard with the **same** `shared/collision.js` the server uses, and sends its state at 20 Hz.
- The server checks every state update:
  - **Speed:** `dist ≤ sprint × 1.5 × dt + 0.75`.
  - **Not inside a wall.**
  - **`tseq` matches.** On failure the server sends `game:teleport` with its last good position and bumps `tseq`. Updates with a stale `tseq` (sent before a teleport arrived) are ignored, which removes the usual rubber-band race.
- Remote wizards are smoothed on the client with exponential interpolation toward the latest snapshot.
- **Why client prediction:** this is co-op, so cheating has little payoff, and instant local movement matters a lot for horror feel. Positions that matter for gameplay (interaction range, and later Monster catches) are always judged on the server.

### Messages

| Direction | Event | Payload |
|---|---|---|
| C→S | `lobby:create` (ack) | `{ name, solo }` → `{ ok, code, selfId }` |
| C→S | `lobby:join` (ack) | `{ code, name }` |
| C→S | `lobby:pick` (ack) | `{ wizardId }` (humans can take a bot's wizard) |
| C→S | `lobby:ready` | `{ ready }` |
| C→S | `lobby:bot:add` / `lobby:bot:remove` (host, ack) | `{ botId }` |
| C→S | `lobby:solo` (host) | `{ allowSolo }` |
| C→S | `lobby:start` (host, ack) | — |
| S→C | `lobby:state` | members, host, `startBlocker` reason |
| S→C | `game:start` | `{ selfId, seed, map (public), players, phase, destroyed, propState, tome }` |
| C→S | `p:state` | `{ tseq, x, z, yaw, pitch, cr, sp, li, mv }` @ 20 Hz |
| C→S | `p:interact` | `{ propId }` |
| C→S | `p:cancel` | — (released E) |
| C→S | `debug:teleport` | `{ x, z, floor, yaw }`, honoured only in solo-debug lobbies |
| S→C | `game:snap` | `{ t, phase, players: [{ id, x, z, f, yaw, pitch, cr, sp, li, mv, ch }] }` @ 20 Hz |
| S→C | `game:channel` | `{ propId \| null, duration, done? }` |
| S→C | `game:teleport` | `{ x, z, floor, yaw, tseq }` |
| S→C | `game:event` | `whisper`, `journal`, `tome`, `heart`, `phase`, `left` |

### Channels (hold-to-interact)
`p:interact` starts a channel on the server (`CHANNEL.tome = 2s`, `heart = 2.5s`, `gate = 3s`). Each tick the server cancels the channel if the player leaves range (+1 unit of slack) and completes it once the time is up. Clients only draw the progress bar.

---

## Coordinates & conventions

- 1 tile = **2 world units**. Tile `(tx, ty)` has its centre at `((tx+.5)·2, (ty+.5)·2)` in world `(x, z)`.
- Floors: `FLOOR_Y = [0, -14]` (ground, basement). A player's `floor` index selects the collision grid. Stairs teleport between floors.
- **Yaw:** forward = `(-sin yaw, -cos yaw)` (Three.js camera with rotation order `YXZ`). `yaw = 0` looks north (−z).
- **Prop rotation:** models are built facing **+z**, and `rot = atan2(dx, dz)` turns them to face `(dx, dz)` (into the room).

## Map format (`generateMansion(seed)`)

```js
{
  version, seed, tile: 2,
  floors: [{ id, name, w, h, y, tiles[], roomIds[], blocked[] }],   // row-major
  rooms:  [{ id, floor, x, y, w, h, cx, cy, area, type, name }],      // rooms[id]
  props:  [{ id, kind, floor, room, tx, ty, dir, x, z, rot, blocks, interact,
             variant, collider?{x,z,hx,hz,dynamic?}, front?{tx,ty,x,z},
             target?{floor,x,z,yaw}, light?, heart?/decoy? (server only) }],
  hearts: [{ id, type, name, propId, roomId, roomName, floor, clue }], // server only
  spawn:  { floor, yaw, points[4] },  cell: { floor, roomId, yaw, points[4] },
  ids:    { foyer, altarRoom, tome, altar, stairsDown, stairsUp, gate },
}
```

- `tiles`: `0` wall, `1` floor, `2` doorway.
- `blocked`: tiles taken by blocking furniture (used for pathing and connectivity).
- Precise collision uses each prop's own AABB `collider`. **Dynamic** colliders (the cell gate) are switched by `propState[id].open`.
- `publicMap(map)` removes `hearts` and the per-prop `heart`/`decoy` flags before the map is sent to clients.

### Generation pipeline
1. BSP-split 60×60, carve one room per leaf, connect siblings with L-shaped corridors (closest room pair), add 3 loop corridors, then mark doorways.
2. Assign roles by walking distance from the Foyer: Altar (far + large), Library (~50%), Stairwell (~70%). Then assign themed rooms by size.
3. Build the basement from a template. The Cell connects only through a 1-tile passage ending in the gate.
4. The placer reserves tiles next to doorways and spawn areas. Every blocking placement runs a flood-fill **connectivity check** and is reverted if it would split the floor. Floor-standing interactables reserve the tile in front of them.
5. Place key props, then the 6 Hearts (distinct rooms), then 2–3 decoys per disguise, then furniture recipes per room type.
6. If any placement fails, retry with a new derived seed (up to 30 attempts).

---

## Rendering

- Per floor: one `InstancedMesh` each for walls (only wall tiles next to floor), room floors, corridor carpet, ceilings, door headers and posts. Roughly 20 draw calls for the level before props.
- Props are small primitive groups (built in `props.js`) with shared materials. Curio props get a `userData.fx(t, ctx)` animator. The tell is only shown once `revealHearts()` has been called with that prop's id.
- **Light budget is fixed:** 1 hemisphere, 1 local wand spot (shadowed) + 1 fill point, 3 pooled teammate spots, up to 3 static candle points, 1 burst flash. Lights are never added or removed during play (avoiding shader recompiles), and inactive ones sit at intensity 0. Floors not in view are hidden.
- Tone mapping is ACES Filmic, fog is black `FogExp2(0.075)`. Measured at about 120 fps in Chrome on the dev machine (DPR capped at 1.75).

---

## Extension points for upcoming steps

| Step | Where it plugs in |
|---|---|
| **3 · Abilities** | New `p:cast { abilityId, dir }` message, then `Game.onCast` checks cooldowns (from `shared/wizards.js`) and applies effects. Add `client/js/fx/` for spell VFX and a cooldown widget in `hud.js`. The Earth wall becomes a dynamic collider (same mechanism as the gate). |
| **4 · Monster** | Add `server/Monster.js` (state machine) using `findPath`, `lineOfSight`, `moveCircle`. Add `monster` to `game:snap`, and noise events from `p:state` (`sp`), decoys and Heart destruction. Capture calls `teleport()` to `map.cell.points`, and the gate channel sets `propState[gate].open` (clients already animate it with `mansion.setGateOpen`). Add `client/js/audio/` (Web Audio graph) and `client/js/fx/PostFX.js` (grain, vignette, flicker). |
| **5 · Archon** | A `PHASE.ARCHON` branch in `Game.tick`: merge players into one entity driven by host input, apply `ARCHON_COOLDOWN_SCALE`, and add a portal entity in `map.ids.altarRoom`. The epilogue is a client-side scene and does not need the mansion's horror lighting rig. |
