# Architecture — SIX HEARTS: THE FORBIDDEN CONVERGENCE

## Quick start

```bash
npm install
npm start            # http://localhost:3666  (PORT=4000 npm start to change)
npm run dev          # same, restarts on server file changes
npm test             # map generator (60 seeds), spells/status effects, end-to-end socket test
npm run verify:browser   # headless Chrome: casts all 7 spells at the Husk, checks errors + FPS
```

Open `http://localhost:3666/?debug=1` and click **Solo test** to play with two bots. In debug, **P** cycles the monster (Husk → Haunt → Stalk → Hunt → Capture test → Auto), **K** captures/frees you, and **1–7** hot-swap your wizard. For real co-op, one player clicks **Summon a Coven** and the others **Join** with the 4-letter code. Use the LAN URL the server prints so other machines can connect.

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
  SpellSystem.js          35-spell grimoire: casts, cooldowns, ult charge, projectiles, zones, entities, buffs
  MonsterBody.js          shared body + status effects for every hostile
  Monster.js              the Malphas Amalgam: dormant/haunt/stalk/hunt/search/retreat/guard AI
  TrainingHusk.js         debug dummy: patrol, shamble, telegraphed swipe, crumble/re-form
  Bot.js                  bot teammate brain (rescue, defend, engage, follow; A*, stairs)
  names.js                bot display names
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
  js/entities/WizardAvatar.js         remote teammate model + wand spotlight + cast recoil
  js/entities/MonsterAvatar.js        husk model, status panel, damage numbers, reveal overlay
  js/entities/AmalgamAvatar.js        the Amalgam: procedural model, 13 Hz stop-motion, door neck-snap
  js/fx/SpellFX.js        original 7 spells' VFX, particles, pooled spell lights, hex shield shader
  js/fx/GrimoireFX.js     21 new spells + 7 Ultimates, dragons, Tree of Life, flood, auras, monster attack/CC VFX
  js/fx/PostFX.js         composer: grain, vignette, chromatic aberration, warp, desat, red, fade
  js/audio/AudioEngine.js procedural Web Audio: drone, sub-bass, heartbeat, HRTF cues, shriek, SFX
  js/debug/DebugMap.js    top-down map (M), click-to-teleport in solo debug
test/
  mapgen.test.js          determinism + 60-seed validity/reachability
  spells.test.js          cooldowns ×7, every status, barricade collision/pathing, knockback clamp, shields, gate
  monster.test.js         AI states, haunting, noise, stare, capture → Cell, rescue, game over, bot rescue, debug
  grimoire.test.js        35 spells, each mechanic, all Ultimates, ult charge, HP pipeline, Lumos, tougher Amalgam
  server.test.js          full lobby → tome → 6 hearts → convergence → stairs over sockets
scripts/
  verify-browser.mjs      headless Chrome: 7 spells, haunting, capture, Cell, bot rescue, hunt, audio, FPS
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
| C→S | `p:interact` | `{ propId }` or `{ entityId }` (eat from the Tree of Life) |
| C→S | `p:cancel` | — (released E) |
| C→S | `p:cast` | `{ yaw, pitch, slot: 0–3 \| 'ult' }` (origin is always the server's copy of the caster) |
| C→S | `p:ping` | call for help (3s cooldown) |
| C→S | `game:restart` (host) | `{ mode: 'phase' \| 'lobby' }` after a game over |
| S→C | `game:end` | the game closed; back to the coven screen |
| S→C | `game:cooldown` | `{ ok, slot, ability, readyIn, duration?, reason? }`, reply to the caster (`reason`: cooldown / charge / no-target) |
| C→S | `debug:teleport` | `{ x, z, floor, yaw }` |
| C→S | `debug:husk` | spawn/remove the Training Husk ~4u ahead |
| C→S | `debug:mode` | P: cycle Husk → Haunt → Stalk → Hunt → Capture test → Auto |
| C→S | `debug:capture` | K: capture yourself; if held, break the lock |
| C→S | `debug:ult` | U: fill your Ultimate charge |
| C→S | `debug:wizard` | `{ wizardId }` hot-swap (the previous holder takes yours) |
| S→C | `game:snap` | `{ t, phase, players: [{ id, x, z, f, yaw, pitch, cr, sp, li (Lumos), mv, ch, sh, cap, cg, hp, u (ult %), bf[] (buffs) }], monsters: [{ id, kind, x, z, f, yaw, hp, maxHp, st[], mv, act, dead, state?, hid?, tg? }], prj: [{ id, k, f, x, z, vx, vz }], ents: [{ id, k, f, x, z, yaw, n?/m? }], fl (flood s left), dw (dawn s left) }` @ 20 Hz |
| S→C | `game:channel` | `{ propId \| null, duration, done? }` |
| S→C | `game:teleport` | `{ x, z, floor, yaw, tseq }` |
| S→C | `game:event` | `whisper`, `journal`, `tome`, `heart`, `phase`, `left`, `roster`, `gate`, `cast`, `impact`, `barrier:end`, `monster:damage`, `monster:scream`, `husk:spawn/despawn/crumble/revive/hit/blocked/miss`, `monster:awaken/haunt/vanish/hunt/banished/blocked`, `capture`, `captured`, `freed`, `gameover`, `restart`, `ping`, `debug:mode`, `spell:hit`, `zone:trigger`, `entity:end`, `tree:eat`, `player:hit`, `player:immune`, `monster:attack`, `monster:phantoms`, `barrier:hit`, `flood:end`, `dawn:end` |

`debug:*` commands are honoured only in covens created with **Solo test** or from a `?debug=1` page (`lobby.debug`).

### Spells (Step 3)

```
client: LMB/Q → p:cast {yaw,pitch} ──► Game.onCast → SpellSystem.cast(p, yaw)
                                         ├─ cooldown check (p.cooldowns[ability], × game.cooldownScale)
                                         ├─ handler[ability.id]: coneTarget() = range + aim cone + lineOfSight
                                         │    → MonsterBody effects: damage / torment / burn / slow / wet /
                                         │      knockback / stun / block
                                         ├─ emitAll({type:'cast', …result})  → every client renders VFX
                                         └─ reply game:cooldown to the caster  → HUD dial
SpellSystem.update(dt): projectiles (substepped, impact on monster/solid) → `impact`,
                        puddle zones (slow + turn slow), barricade expiry → `barrier:end`
```

- **Statuses live on `MonsterBody`**, the single body class shared by the Training Husk and the Step 4 Keeper: `stun`, `torment` (chase interrupt), `reveal` (through walls), `slow`/`wet` (speed and turn rate), `burn` (DOT plus slow), `knock` (slide through `moveCircle`, so walls clamp it, plus a stagger), and `block` (rebound off a Void shield).
- **Barricades** go through `addBarrier`/`removeBarrier` in `shared/collision.js`. They add full-tile colliders *and* bump `floor.dyn[]`, which `isPassable` treats as blocked, so players, bots and monsters collide with them and A* routes around them. Clients apply the same barrier from the `cast` event, so their local collision matches the server's.
- **Shields:** `p.shieldUntil` on each player, mirrored to clients as `sh` in snapshots, which drive the dome visuals.
- **Bots** call the same `SpellSystem.cast()`. They engage a monster within 16u when their spell is nearly ready.

### The grimoire (Step 4.5)

- **Data:** each wizard in `shared/wizards.js` has `spells[4]` + `ultimate`, with a `bot` usage hint and an element `source`. `ability` aliases slot 1.
- **Cast pipeline:** `SpellSystem.cast(p, yaw, pitch, slot)`.
  - Handlers return `false` to refuse a targeted Ultimate with no target; nothing is spent.
  - On success the cooldown is committed (or the charge spent), then `cast` is broadcast plus a 14u noise.
  - `credit()` gives +8% ult charge once per cast that lands.
- **Live state:**
  - `projectiles`: optionally `homing`, which steers toward the monster or along its A* path around corners, and/or `pierce`.
  - `zones`: puddle, burnline, debris, gravity, briars, riptide trap, patronus heal, null.
  - `entities`: fire/wind dragons that path through corridors, the Tree with `fruits`.
  - `scheduled`: multi-hit casts such as fists, blades and swords.
  - `p.buffs`: shadow, phoenix, cradle (absorb hp), granite, tailwind, union.
  - Game-wide `flood` / `dawn`.
- **New `MonsterBody` statuses:** root, pin, lift, frozen, confuse (self-damage), pull, reach scale, calm, and `sweep()` for the wind dragon's carry. `canAct()` / `canMove()` gate the AI. Its stagger "death" is deferred while frozen or confused.
- **Player HP:** `Game.damagePlayer(p, amount, attacker, kind)` resolves in this order:
  1. Devil Union: no effect, and the attacker recoils.
  2. Void shield: blocked.
  3. Heavy lunge: captured.
  4. ≤ 40 HP (unless it's a splash): captured.
  5. Granite −60%.
  6. Cradle absorbs.
  7. HP; at 0, captured.

  `updateVitals()` handles regeneration (to 60 after 8s), ult charge (passive and while chased), and flood/dawn expiry.
- **Client:**
  - **Visuals:** `GrimoireFX` renders casts from events, interpolates `prj` and `ents` from snapshots, and draws buff auras (wings, spheres, plates, embers), monster CC (chains, golden coil, briars, spear), attack VFX and phantoms.
  - **Controller buffs:** the controller takes `speedMul`, `noStamina` and `ignoreProps`.
  - **Server speed check:** validation widens with active speed buffs.
  - **Lumos:** retunes the single shadowed wand spotlight (angle 0.44→0.85, range 28, intensity ×2.4), so no lights are added.

### The Amalgam (Step 4)

- `server/Monster.js` extends `MonsterBody`, so every spell status works on it unchanged.
- **State diagram:** see the header comment in `Monster.js`.
- **Each tick:**
  - `updateStatus` handles burn and knockback.
  - Stare detection runs, then the update for the current state.
  - `travelTo()` follows A* paths and takes the stairs when its goal is on the other floor.
  - `Game.noise(p, radius, kind)` → `hear()` reacts to sprinting players (`p:state.sp`), every successful cast, decoys and Heart destruction (radius ∞).
- **Combined elements:** every effect calls `noteHit(source)`. Three distinct sources within 5s → `banish('combo')`. Its 40 HP is a *stagger* pool: at 0 it banishes instead of dying.
- **Capture pipeline:**
  - `Game.capture(p, monster)` sets `p.capturing` and emits `capture`; the victim's client plays the jumpscare.
  - After 0.9s `updateCaptures()` teleports the victim into `map.cell.points`, sets `p.captured` and closes the gate. Then `checkGameOver()`: all held → `GAMEOVER`.
  - `openGate()` frees every prisoner.
  - `restartPhase()` (host "Retry") resets everyone to the Foyer, restores the previous phase, and hides the Amalgam for 10s.
- **Targeting:**
  - `Game.bodies()` is every hostile.
  - `Game.monsters()` filters to `targetable` ones, i.e. not hidden, dormant or haunting. Spells and bots only see those.
- **Client:**
  - **Horror layer:** `GameClient.updateHorror()` derives `dread` (distance ≤ 15u), `terror` (staring), light cuts and hunt state. These drive `PostFX.set()`, `MansionBuilder.setDread()`, the wand light and `AudioEngine.update()`.
  - **Audio:** the `AudioContext` is created/resumed on the first key or pointer press.

### Channels (hold-to-interact)
`p:interact` starts a channel on the server (`CHANNEL.tome = 2s`, `heart = 2.5s`, `gate = 3s`, divided by the wizard's `passive.gateUnlockSpeed`, so Soham takes 1.5s). Each tick the server cancels the channel if the player leaves range (+1 unit of slack) and completes it once the time is up. Clients only draw the progress bar.

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
- **Post-processing:** RenderPass → OutputPass (tone mapping + sRGB) → one horror ShaderPass. With vsync off in headless Chrome the hunt stays above ~330 fps on the dev machine.
- **Light budget is fixed:** 1 hemisphere, 1 local wand spot (shadowed) + 1 fill point, 3 pooled teammate spots, up to 3 static candle points, 1 burst flash, 5 pooled spell lights (dragons, the Tree, auras, beacons and more) (fireball, scorch, Sacred flash). `SpellFX.prewarm()` compiles every spell material at load, so a spell's first cast doesn't hitch. Lights are never added or removed during play (avoiding shader recompiles), and inactive ones sit at intensity 0. Floors not in view are hidden.
- Tone mapping is ACES Filmic, fog is black `FogExp2(0.075)`. Measured at about 120 fps in Chrome on the dev machine (DPR capped at 1.75). With vsync off in headless Chrome (Apple M4, 1280×720), the frame rate stays between about 250 and 670 fps while spell effects play (`npm run verify:browser`).

---

## Extension points for upcoming steps

| Step | Where it plugs in |
|---|---|
| **3 · Abilities** | ✅ Done. See *Spells* above. |
| **4 · Monster** | ✅ Done. See *The Amalgam* above. |
| **5 · Archon** | The altar's `CONVERGENCE` branch in `Game.onInteract` starts the group channel. Then a `PHASE.ARCHON` branch in `Game.step`: merge players into one entity driven by host input, apply `ARCHON_COOLDOWN_SCALE`, and add a portal entity in `map.ids.altarRoom`. The epilogue is a client-side scene and does not need the mansion's horror lighting rig. |
