# Architecture — SEVEN HEARTS: THE FORBIDDEN CONVERGENCE (v3.0)

## Quick start

```bash
npm install
npm start            # http://localhost:3666  (PORT=4000 npm start to change)
npm run dev          # same, restarts on server file changes
npm test             # map generator (60 seeds, 3 levels), spells, the Keeper's rules, Hearts + Sin tasks + Sins, input, finale, Step 7 labels, sockets
npm run verify:browser   # headless Chrome: the whole game end to end, screenshots in verify-output/, errors + FPS
```

Open `http://localhost:3666/?debug=1` and click **Solo test** to play with two bots. In debug, **P** cycles the monster (Husk → Haunt → Stalk → Hunt → Capture test → Auto), **K** captures/frees you, **L** opens the nearest Heart's Sin arena (L again slays the Sin), **H** skips to the Convergence, **U** readies your Ultimate, a click on the full map (**M** / **Tab**, available to everyone) teleports you, and **Shift+1–7** hot-swap your wizard. For real co-op, one player clicks **Summon a Coven** and the others **Join** with the 4-letter code. Use the LAN URL the server prints so other machines can connect.

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
  Monster.js              the Malphas Amalgam: unkillable, sight-lock, invisibility sensing, the 3 lock-breaking Ultimates; dormant/haunt/stalk/hunt/search/retreat/guard AI
  SinDemon.js             a Demon of the Seven Deadly Sins: per-Sin kit (reflect, gold, ribbons, counter-waves, acid/vacuum, charge, aura), hazards
  TrainingHusk.js         debug dummy: patrol, shamble, telegraphed swipe, crumble/re-form
  Finale.js               Phase III: the Forbidden Spell, Soul Merge, the Archon, the Unbound Amalgam, Hell Portal, victory
  Bot.js                  bot teammate brain (rescue, hide with V, lock-breaking Ults, Sin arenas, follow, chant, Archon turns; A*, multi-floor stairs)
  names.js                bot display names
shared/                   ← imported by BOTH server and browser; no Node/DOM APIs
  constants.js            tile size, speeds, ranges, phases, yaw convention
  wizards.js              the seven wizards + ability numbers (balance source of truth)
  finale.js               FINALE tuning (ritual, Archon, boss, portal) + the seven MASTERIES
  lore.js                 room types per floor + hints, the 7 HEARTS (one per Sin: name, prop, room, riddle), the Sin TASKS, curios, Tome text
  heartinfo.js            Step 7: Heart status / tracker text / "[Hold E] … (Progress X/3)" prompts, mirroring the server's task rules (pure)
  sins.js                 the Seven Deadly Sins: names, HP, kits, sinScaling(N), SIN_ENRAGE (shared by the server AI and the client models/HUD)
  nav.js                  stairToward(): which staircase to take next to reach another floor
  propdefs.js             prop footprints/colliders/mounting/interaction kinds
  mapgen.js               seeded 3-level mansion generator (Floor 1, Floor 2 + gallery void, Basement) + publicMap() + roomAt()
  collision.js            circle-vs-grid/AABB movement (walls + void solid), overlap test, line of sight (walls only), barriers
  pathfinding.js          A* (8-way, no corner cutting)
  rng.js                  mulberry32 PRNG
client/
  index.html, css/style.css
  js/main.js              boot: lobby UI ↔ GameClient
  js/net.js               socket wrapper (+ promise acks)
  js/game.js              GameClient: renderer, scene, loop, net glue, interactions
  js/ui/lobby.js          title + coven screens
  js/ui/hud.js            objective, hearts, prompts, banners, team list, journal, hotbar selection, V toggle, Ult MM:SS / EXPENDED, task tracker, footstep bar, capture screen
  js/ui/FullMap.js        the full map (M / Tab, everyone): 3 floor tabs, rooms, coven, Hearts + task progress, lockdowns; click-teleport in debug only
  js/ui/DamageNumbers.js  pooled DOM damage numbers in element colours, drifting away from the screen centre
  js/ui/Minimap.js        top-left Marauder's-Map minimap: parchment, ink plan per floor, arrows, sealed arenas, footstep ripples
  js/input/SpellInput.js  1–4 / R select, the trigger (LMB / Q) fires (pure logic, unit-tested)
  js/world/textures.js    procedural canvas textures + height→normal maps, roughness maps, marble, wainscot, stained glass, crests
  js/world/props.js       procedural prop models (+ spiral stairs, armour, windows with moonbeams), curios, glow sprites
  js/world/sinProps.js    Step 7: the 7 Heart models (heart-gem tells) + 9 Sin task props with their states, carried ingot / platter
  js/world/Tethers.js     pulsing tube tethers from each Heart to its task objects (shader flow; steady when done; fade when unsealed)
  js/world/MansionBuilder.js  instanced walls/floors/ceilings per room finish, Gothic arches, balustrade, void, iron cage, props, arena runes
  js/player/FirstPersonController.js  pointer-lock FPS movement
  js/player/Interact.js   centre-screen raycast (6u, wall-checked), inverted-hull white outline, "[Hold E]" billboard sprite
  js/entities/WizardAvatar.js         robed wizard (cloak, crest, scarf, hat/hood, articulated wand arm), cloth sway, Lumos beam, invisibility shimmer
  js/entities/SinDemonAvatar.js       the seven Sin models, name/HP plate, hazards (acid, waves, gold), attack VFX, red ground telegraphs, hit-flash, enrage aura, dissolve shader
  js/entities/MonsterAvatar.js        husk model, status panel, reveal overlay
  js/entities/AmalgamAvatar.js        the Amalgam: procedural model, 13 Hz stop-motion, door neck-snap
  js/fx/SpellFX.js        original 7 spells' VFX, particles, pooled spell lights, hex shield shader
  js/fx/GrimoireFX.js     21 new spells + 7 Ultimates, dragons, Tree of Life, flood, auras, monster attack/CC VFX
  js/fx/FinaleFX.js       merge ribbons, heptagram crown, chant motes, hellfire cracks, boss ward/orbs/shockwave, 7 Masteries, portal shader, sealing
  js/epilogue/Epilogue.js Phase IV: relit foyer, the estate gardens, family vignettes, final card (own scene + timeline)
  js/fx/PostFX.js         composer: grain, vignette, chromatic aberration, warp, desat, red, fade
  js/audio/AudioEngine.js procedural Web Audio: drone, sub-bass, heartbeat, HRTF cues, shriek, SFX
test/
  mapgen.test.js          determinism, 3 levels + required rooms, the void overlook, dual staircases + stair routing, 7 sealed Hearts, 60-seed reachability
  spells.test.js          cooldowns ×7, every status, barricade collision/pathing, knockback clamp, shields, gate
  monster.test.js         AI states, haunting, noise, stare, locked chase, immunity, capped CC, capture → Cage, rescue, game over, bot rescue, debug
  keeper.test.js          Keeper rules: unkillable, V before sight + still, moving/casting within 14u, V fails in its sight, V an infinite toggle, Dawn/Mind Fracture/Union break the lock, 1.5s capture → cage, bots hide
  hearts.test.js          Sin tasks in the Sin's room, carry tasks (one at a time, returned on capture), lockdown (no exit, Keeper out), scaled HP, each Sin's kit + telegraphs, Pride reflects, enrage + strip, coven scaling, slay → Heart destroyed + doors open, withdrawal, all 7 → Convergence, debug L
  step7.test.js           the Tome's Hearts, heart status + tracker, billboard prompts agree with the server, footstep falloff
  _tasks.js, _seeds.js    helpers: do a Heart's tasks (incl. carry); a roomy seed
  input.test.js           1–4 / R only select; the trigger fires the selection; Archon Masteries
  grimoire.test.js        35 spells (3 attacks + 1 utility each, every attack damages), each mechanic, all Ultimates, 5-minute once-per-game Ult, HP pipeline, Lumos, tougher Amalgam
  finale.test.js          ritual (every voice, decay), merge, Archon driving/damage/death/retry, Masteries, wards, CC cap, portal + grapple + victory, full playthrough with a bot
  server.test.js          full lobby → tome → 7 hearts (tasks incl. carry, Sins) → convergence → stairs over sockets
scripts/
  verify-browser.mjs      headless Chrome: 2-story tour (foyer ↔ balcony via the grand stair), minimap, avatars, select/fire input,
                          V charm, haunting, the scary capture screen → cage, bot rescue, hunt, 35 spells + Ultimates, Lumos,
                          Step 7: crosshair outline + billboard, a Sin task and a carry task, tethers, tracker, full map,
                          V toggle, Ult EXPENDED, Sin telegraph / enrage / damage numbers / dissolve, footstep bar,
                          all seven Sin arenas, Keeper footstep ripples, audio,
                          then the finale: chant → merge → Archon crown → 7 Masteries → boss attacks → portal → grapple →
                          sealing → epilogue scenes → Play Again; then a normal (non-debug) coven: full map, no teleport;
                          FPS ≥ 60 and zero console errors
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
| S→C | `game:start` | `{ selfId, seed, map (public), players, phase, destroyed, propState, tome, barriers, arenas }` |
| C→S | `p:state` | `{ tseq, x, z, yaw, pitch, cr, sp, li, mv }` @ 20 Hz |
| C→S | `p:interact` | `{ propId }` or `{ entityId }` (eat from the Tree of Life) |
| C→S | `p:cancel` | — (released E) |
| C→S | `p:cast` | `{ yaw, pitch, slot: 0–3 \| 'ult' }` (origin is always the server's copy of the caster) |
| C→S | `p:ping` | call for help (3s cooldown) |
| C→S | `p:invis` | V: toggle the Disillusionment Charm → reply `game:invis { ok: true, on } \| { ok: false, reason: 'seen' \| 'unavailable' }` |
| S→C | `game:impulse` | `{ vx, vz, duration }`: a Sin's ribbons / vacuum drag you (the client applies it; the server relaxes its speed check) |
| C→S | `p:mastery` | `{ key: 1–7, yaw }`: an Elemental Mastery (Archon only) |
| C→S | `p:grapple` | `{ on }`: Soul Grapple held/released (Hell Portal stage) |
| C→S | `game:restart` (host) | `{ mode: 'phase' \| 'lobby' \| 'again' }`: after a game over or from the epilogue (`again` = fresh game, same coven) |
| S→C | `game:end` | the game closed; back to the coven screen |
| S→C | `game:mastery` | `{ key, ok, cooldown? \| reason, remaining? }`, reply to the caster |
| S→C | `game:cooldown` | `{ ok, slot, ability, readyIn, duration?, reason? }`, reply to the caster (`reason`: cooldown / charge / no-target) |
| C→S | `debug:teleport` | `{ x, z, floor, yaw }` |
| C→S | `debug:husk` | spawn/remove the Training Husk ~4u ahead |
| C→S | `debug:mode` | P: cycle Husk → Haunt → Stalk → Hunt → Capture test → Auto |
| C→S | `debug:capture` | K: capture yourself; if held, break the lock |
| C→S | `debug:ult` | U: ready your Ultimate (charge 100, un-spent) |
| C→S | `debug:wizard` | `{ wizardId }` hot-swap (the previous holder takes yours) |
| C→S | `debug:finale` | H: skip to Convergence (Tome read, all Hearts destroyed, prisoners freed to the altar) |
| C→S | `debug:portal` | N: boss to 25% with wards spent (boss fight only) |
| C→S | `debug:arena` | L: `{ sin? }` open the nearest (or that Sin's) Heart with its tasks done, pull the coven in, start the lockdown; inside a live arena, slay the Sin |
| S→C | `game:snap` | `{ t, phase, players: [{ id, x, z, f, yaw, pitch, cr, sp, li (Lumos), mv, ch, sh, cap, cg, hp, u (ult %), ux (Ult expended), cy (carried item: 'ingot' \| 'platter' \| null), bf[] (buffs) }], monsters: [{ id, kind ('amalgam' \| 'husk' \| 'sin'), x, z, f, yaw, hp, maxHp, st[], mv, act, dead, state?, hid?, tg?, sin?, er? (erupting), rage? (enraged), hz?: [{ id, k: 'acid' \| 'wave' \| 'gold', x, z, r?, el?, fx?, fz?, p? }] }], prj: [{ id, k, f, x, z, vx, vz }], ents: [{ id, k, f, x, z, yaw, n?/m? }], fl (flood s left), dw (dawn s left), fin }` @ 20 Hz. `fin` (Convergence onward): `{ stage, rt (ritual 0–1), ar: { x, z, f, yaw, hp, max, drv } \| null, boss: { hp, max, ward } \| null, portal, orbs: [[x, z]], wave: { x, z, r } \| null, mr: { masteryId: s left }, gr (grapplers), seal (0–1) }` |
| S→C | `game:channel` | `{ propId \| null, duration, done? }` |
| S→C | `game:teleport` | `{ x, z, floor, yaw, tseq }` |
| S→C | `game:event` | `whisper`, `journal`, `tome`, `heart`, `phase`, `left`, `roster`, `gate`, `cast`, `impact`, `barrier:end`, `monster:damage`, `monster:scream`, `husk:spawn/despawn/crumble/revive/hit/blocked/miss`, `monster:awaken/haunt/vanish/hunt/banished/blocked`, `capture`, `captured`, `freed`, `gameover`, `restart`, `ping`, `debug:mode`, `spell:hit`, `zone:trigger`, `entity:end`, `tree:eat`, `player:hit`, `player:immune`, `monster:attack`, `monster:phantoms`, `barrier:hit`, `flood:end`, `dawn:end`, `merge`, `boss:start`, `boss:volley`, `boss:wave`, `boss:charge`, `boss:ward`, `boss:warded`, `archon:hit`, `mastery`, `portal:open`, `sealing`, `victory`, **Step 6:** `task`, `heart:unsealed`, `arena:start`, `arena:end`, `sin:attack`, `sin:impact`, `sin:reflect`, `invis`, `monster:lockbroken`, `monster:recoil`, **Step 7:** `carry { id, kind }`, `sin:enrage { id, sin, stripped? }` (`task` carries `took` / `sink` / `returned`; `sin:attack` windups carry `aoe: [{ shape: 'circle', x, z, r } \| { shape: 'line', x, z, x2, z2, w }]`; `monster:damage` carries `immune`; `capture` carries `duration`, `by`, `sin`) |

`debug:*` commands are honoured only in covens created with **Solo test** or from a `?debug=1` page (`lobby.debug`).

### Spells (Step 3)

```
client: 1–4 / R select (SpellInput) · LMB / Q fire → p:cast {yaw,pitch,slot} ──► Game.onCast → SpellSystem.cast(p, yaw)
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
  - `credit()` marks a cast as landed (once per cast). Ult charge is time-only since Step 7 (see below).
- **Live state:**
  - `projectiles`: optionally `homing`, which steers toward the monster or along its A* path around corners, and/or `pierce`.
  - `zones`: puddle, burnline, debris, gravity, briars.
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

  `updateVitals()` handles regeneration (to 60 after 8s) and flood/dawn expiry.
- **The Ultimate (Step 7):** `Game` adds `ULT.MAX / ULT.CHARGE_TIME` (100 / 300s) per second to every wizard who hasn't spent it (not during Game Over or the Epilogue). A cast sets `p.ultUsed`; after that `cast()` refuses with `expended` and the snapshot's `ux` turns the HUD slot to EXPENDED. `debugUlt()` sets 100 and clears `ultUsed`.
- **Kits (Step 7):** slots 1–3 are `kind: 'attack'` (all deal damage), slot 4 `kind: 'utility'`. Dashes go through `SpellSystem.dash()` (wall-clamped teleport, `from` / `to` on the event).
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
- **Unkillable (Step 6):** outside the finale `Monster.damage()` does nothing but emit `monster:damage { immune: true }`; `die()` refills it. No combo banish, no stagger pool. Every crowd-control override clamps to `AI.CC_CAP` (0.8s) and knockback to 2.5u, except `freeze(d, 'dawn')` and `confuse(d, dps, 'fracture')`, which hold their full duration and call `breakLock()`. Touching a wizard with the `union` buff calls `recoilFromUnion()` (6s freeze + `breakLock('union')`).
- **Sight-lock:** `updateSenses()` (stalking/searching) accumulates `spotting` per wizard and calls `hunt(p, 'sighted')` after `SPOT_TIME`; an invisible wizard who moves (`p.moving`) or cast within 0.6s (`p.actAt`) within `INVIS.sense` → `hunt(p, 'sensed')`. `hunt()` refuses invisible wizards for any other reason, refuses a second target while hunting (the first one it saw), and refuses anyone `Game.inArena()`. `updateHunting()` never gives up: it tracks the target anywhere (charging at `CHARGE_SPEED` in sight within `CHARGE_RANGE`) until a capture, `breakLock()`, or the target entering a Sin's arena.
- **Multi-floor travel:** `travelTo()` and `Bot.moveTo()` use `shared/nav.js` `stairToward(map, floor, x, z, goalFloor)` (a BFS over the stair links) to pick the staircase.
- **Capture pipeline:**
  - `Game.capture(p, monster)` sets `p.capturing` and emits `capture`; the victim's client plays the jumpscare.
  - After 1.5s (`CAPTURE_DELAY`, the Scary Capture Screen) `updateCaptures()` teleports the victim into `map.cell.points` (the Underground Iron Cage), sets `p.captured` and closes the door. Then `checkGameOver()`: all held → `GAMEOVER`.
  - `openGate()` frees every prisoner.
  - `restartPhase()` (host "Retry") resets everyone to the Foyer, restores the previous phase, and hides the Amalgam for 10s.
- **Targeting:**
  - `Game.bodies()` is every hostile.
  - `Game.monsters()` filters to `targetable` ones, i.e. not hidden, dormant or haunting. Spells and bots only see those.
- **Client:**
  - **Horror layer:** `GameClient.updateHorror()` derives `dread` (distance ≤ 15u), `terror` (staring), light cuts and hunt state. These drive `PostFX.set()`, `MansionBuilder.setDread()`, the wand light and `AudioEngine.update()`.
  - **Audio:** the `AudioContext` is created/resumed on the first key or pointer press.

### The finale (Step 5)
- **State lives in `server/Finale.js`.** `Game` owns one `Finale` and calls `finale.update(dt)` every tick. Stages run `ritual → merge → boss → portal → sealing → victory`, and the snapshot exposes them as `fin`.
- **The ritual:** in `CONVERGENCE`, interacting with the altar starts an *infinite* channel (`startChannel(p, altar, Infinity)`). Progress `rt` advances only while `chanting(p)` is true for every player, and decays otherwise. Releasing E sends `p:cancel` as usual.
- **Merge:**
  - `startMerge()` sets `PHASE.ARCHON` and `cooldownScale = ARCHON_COOLDOWN_SCALE`, picks the driver (the host, or the first human), and hides the Amalgam. Its state becomes `'boss'`.
  - After `MERGE_TIME`, `beginBoss()` places the Unbound Amalgam and resets its HP (`bossHp`), wards and attack timers.
- **The Archon:**
  - Only the driver's `p:state` moves it (`onPlayerState`), and every player's server position follows it, so spells cast by anyone originate from the Archon.
  - `Game.damagePlayer` redirects into `finale.damageArchon`, which applies union, aegis and granite. Patronus zones and the Tree heal it. 0 HP → `GAMEOVER`, and `restart()` re-merges.
- **The boss:**
  - `Monster.update` in the `'boss'` state delegates to `finale.updateBoss`, which handles the charge, the crawl away from the portal, circling, and the volley, wave and charge timers.
  - `Monster.damage` routes to `finale.hitBoss`, which applies the ward check, the ×`BOSS_SPELL_SCALE` scaling for non-Mastery damage, the HP floor of 1 once the portal is open, and the ward and portal thresholds.
  - `Monster.cap()` limits every CC duration to `BOSS_CC_CAP`. Orbs and the shockwave are simulated in `Finale.update` and sent as plain arrays.
- **Masteries:** `finale.mastery(p, key, yaw)` checks the shared cooldown (`masteryReady`), applies the effect through `MonsterBody` statuses and `SpellSystem.spawnDragon`, and emits `mastery`. Dragons with `a.mastery` report the damage source `'mastery'`, which skips the ×2.5 scaling.
- **Portal and seal:** each `p:grapple` adds a grappler (up to 3). In the portal stage, `update` pulls the boss toward the rift at `GRAPPLE_PULL × n` while it isn't bound. Within `PORTAL_RADIUS` it enters `sealing` for `SEAL_TIME`, then `victory()` sets `PHASE.EPILOGUE` and emits `victory { coven, hostId }`.
- **Client:**
  - `GameClient.archonMode()` gates the whole presentation:
    - `controller.rideOnly` (passengers can't move), `eyeOverride = ARCHON_EYE`, and the ×1.25 speed.
    - The crown attached to the camera, the Mastery bar, the boss bar, and the Archon HP shown on the HP bar.
    - Hidden teammate avatars and auras, and no dread, terror or light cuts.
  - `FinaleFX` draws everything from `fin` and the events.
  - On `victory`, `Epilogue` takes over the frame loop: `GameClient.frame` early-returns into `epilogue.update(dt)`.
    - It relights the real mansion through `restoreDaylight()`, then renders its own garden scene with the camera's far plane pushed to 600.
    - The buttons emit `game:restart { mode: 'again' | 'lobby' }`.

### Hearts, Sin tasks and the Sins (Steps 6–7)
- **Map data:** each heart is `{ id, sin, name, propId, roomId, roomName, floor, tasks[3], sink, clue }`, placed in its Sin's fixed room (`HEARTS[sin].room`); its Heart prop is its own kind (`crowned_vanity`, `vault_coffer`, …). Task props have `interact: 'task'`, `task` (the Sin) and `role: 'source' | 'sink'`; `taskOf` is server-only. `Game.heartByTask` maps every source and sink → heart. The Tome (`tomeInfo()`) sends every Heart with its room, floor, tasks and sink.
- **Tasks:** `onInteract` on a `task` prop starts a channel (Phase II only): `TASKS[sin].time`, or `takeTime` for a carry source. `completeTask()`:
  - plain tasks set `propState[id] = { done }`;
  - a carry **source** sets `{ taken }` and `setCarry(p, { kind, from })` (the `carry` event, `cy` in the snapshot); one item at a time;
  - the **sink** marks the carried item's source `{ done }`, sets its own `{ count }` and clears the carry;
  - each step emits `task { propId, progress, of, took?, sink? }`; the third sets `propState[heart] = { unsealed }` and emits `heart:unsealed`.
  - `dropCarry(p)` (on capture) restores the source and emits `task { returned }`.
- **Lockdown:** channelling an unsealed Heart calls `startArena(heart, p)`:
  - `arenaTiles(room)`: every walkable tile outside the room 4-adjacent to it. Wizards standing on them are pulled inside; then `addBarrier(world, floor, 'arena:<heart>', tiles)` (collision + `floor.dyn` for A*), mirrored on clients from `arena:start`.
  - A `SinDemon` is created and pushed onto `Game.demons` (so it is in `bodies()`/`monsters()`, targetable by every spell). The Keeper is hidden if it was inside, and its lock on anyone inside is broken.
  - `updateArenas()` ends an arena when nobody free is inside (`endArena(a, false)`: the Sin withdraws, the Heart stays unsealed). `SinDemon.die()` → `onDemonSlain()` → `endArena(a, true)` → `destroyHeart()` (the `heart` event, Convergence at 7, the Keeper sent to search there).
- **`SinDemon` (server/SinDemon.js):** extends `MonsterBody`; `maxHp = base × sinScaling(players).hp`, every hit through `hurt()` × `dmgScale`, projectile counts through `count()`; CC capped at `SIN_CC_CAP`; a 2.2s eruption; `decide()` picks the Sin's next telegraphed attack (`sin:attack` windup with `aoe` → strike); below `SIN_ENRAGE.at` it `enrage()`s (`sin:enrage`, cadence ×0.65, windups ×0.8, per-Sin upgrades; `stripEnrage(s)` from the Black Slash Wave); hazards (acid pools, Envy's waves, Greed's gold) ride in the snapshot as `hz`. Pride's reflection uses `SpellSystem.caster` / `casterFrom`. Pulls go through `Game.impulse()`. Sloth refreshes a `sloth` buff on everyone inside.
- **Damage:** `damagePlayer(p, amount, attacker, 'sin')` skips the Keeper's capture-at-40 rule; at 0 HP the wizard is captured. The Keeper can't damage anyone `inArena()`.

### The Disillusionment Charm (Step 7: a toggle)
- `Game.onInvis(id)`: already invisible → the buff is removed (`{ ok, on: false }`). Otherwise, if the Keeper is locked on or `Monster.wouldSee(p)` (its sight test, ignoring invisibility), the charm **fails**: `hunt(p, 'sighted')`, `invis { failed }`, `{ ok: false, reason: 'seen' }`. Else the `invis` buff is added with an infinite duration. No cooldown. Bots toggle it from `Bot.hide()`.
- The client follows the `bf` buff codes: the V slot reads ON, a chameleon screen edge (`#screen-invis`), translucent hands, wand and carried item; teammates' `WizardAvatar` fades to a glassy outline.

### The client (Steps 6–7)
- **Input:** `SpellInput.key(code)` only selects (`GameClient.select()` → HUD highlight, wand aura, a click); `castSelectedSpell()` (LMB, Q) fires `input.fire()` → `p:cast` or `p:mastery`. **V** → `p:invis`. **M / Tab** → `toggleFullMap()` (frees the mouse, like the journal).
- **Floors:** `MansionBuilder.setActiveFloor(f)` draws the basement alone, or Floors 1 and 2 together (only the overlook room's props on the other story); `setOverlook(inFoyerOrGallery)` hides the other story entirely elsewhere. Avatars and Sins take the visible-floor list.
- **Interaction:** each frame `Interact.pick()` raycasts from the screen centre against nearby interactable prop groups (6u; a hit behind a wall is rejected with the 2D `lineOfSight`), falling back to the old proximity cone within reach. `Interact.hover(prop, text)` adds inverted-hull outline meshes (a back-face shader pushing vertices along their normals) as children of the prop's meshes and places the billboard sprite over the prop's top. `GameClient.promptFor()` builds the text from `heartinfo.js`.
- **Footsteps:** wizards make none. `AmalgamAvatar`'s step callback → `onKeeperStep()` → `audio.monsterStep(pos, hunting, dist)` with `keeperStepGain(dist)` (exponential from `FOOTSTEPS.range` 28u; the panner only pans), `minimap.footstep()`, the HUD bar (`footstepCloseness`) and a camera tremor. The heartbeat maps 15u → 5u.
- **Full map / tracker / tethers:** `FullMap.draw()` ~10 Hz while open (from `positions`, the Tome's hearts, `propState`, `arenas`); `updateTracker(room)` → `#hud-tracker`; `Tethers.build(tome.hearts)` once, `update()` per frame.
- **Sin polish:** `sin:attack.aoe` → `SinDemonAvatar.telegraph()`; `snap.rage` → the aura shell and red sigil; `sin:enrage` → `onEnrage()`; `showDamage()` → hit-flash (every lit material's emissive lerped to white) and `DamageNumbers.spawn()`; `snap.dead` → `uDissolve` 0→1 in a noise-discard patch (`onBeforeCompile`, applied at spawn so dying compiles nothing). Heavy own casts set `punch` (a pitch kick and an FOV squeeze).
- **Capture screen:** `startJumpscare()` shows `#capture-screen` (CSS glyph flashes and shake) for `capture.duration` (1.5s) while the camera is locked into the Amalgam's face, then black, then the cage.

### Channels (hold-to-interact)
`p:interact` starts a channel on the server (`CHANNEL.tome = 2s`, `heart = 2.5s`, `gate = 3s`, divided by the wizard's `passive.gateUnlockSpeed`, so Soham takes 1.5s). Each tick the server cancels the channel if the player leaves range (+1 unit of slack) and completes it once the time is up. Clients only draw the progress bar.

---

## Coordinates & conventions

- 1 tile = **2 world units**. Tile `(tx, ty)` has its centre at `((tx+.5)·2, (ty+.5)·2)` in world `(x, z)`.
- Floors: `FLOOR = { GROUND: 0, BASEMENT: 1, UPPER: 2 }`, `FLOOR_Y = [0, -14, 4.6]`. A player's `floor` index selects the collision grid. Stairs teleport between floors (each spiral pair shares a tile column).
- **Yaw:** forward = `(-sin yaw, -cos yaw)` (Three.js camera with rotation order `YXZ`). `yaw = 0` looks north (−z).
- **Prop rotation:** models are built facing **+z**, and `rot = atan2(dx, dz)` turns them to face `(dx, dz)` (into the room).

## Map format (`generateMansion(seed)`)

```js
{
  version, seed, tile: 2,
  floors: [{ id, name, w, h, y, tiles[], roomIds[], blocked[] }],   // row-major
  rooms:  [{ id, floor, x, y, w, h, cx, cy, area, type, name }],      // rooms[id]
  floors[0] Floor 1, floors[1] Basement, floors[2] Floor 2                // indexed by floor id
  props:  [{ id, kind, floor, room, tx, ty, dir, x, z, rot, blocks, interact,
             variant, collider?{x,z,hx,hz,dynamic?}, front?{tx,ty,x,z},
             target?{floor,x,z,yaw}, link?, label?, light?, task?, turns?,
             heart?/decoy?/taskOf? (server only) }],
  hearts: [{ id, type, name, sin, propId, roomId, roomName, floor, task, tasks[3], clue }], // server only
  spawn:  { floor, yaw, points[4] },  cell: { floor, roomId, yaw, points[4] },
  stairs: [[propId, propId] ×4],     // spiral (West Stair Hall ↔ Landing), 2 × grand (Foyer ↔ Gallery), servants' (↔ Basement)
  ids:    { foyer, gallery, altarRoom, tome, altar, stairsDown, stairsUp, gate },
}
```

- `tiles`: `0` wall, `1` floor, `2` doorway, `3` void (the open air over the Foyer: solid for movement and A*, transparent for line of sight).
- `blocked`: tiles taken by blocking furniture (used for pathing and connectivity).
- Precise collision uses each prop's own AABB `collider`. **Dynamic** colliders (the cell gate) are switched by `propState[id].open`.
- `publicMap(map)` removes `hearts` and the per-prop `heart`/`decoy`/`taskOf` flags before the map is sent to clients.

### Generation pipeline
1. **Floor 1:** BSP-split 60×60 (min leaf 10), carve one room per leaf, connect siblings with L-shaped corridors, add 3 loops, mark doorways. The Foyer is the big room nearest the south.
2. **Floor 2:** the Balcony Gallery = the Foyer's rect grown by one tile; its inner part over the Foyer becomes `TILE_VOID`. A fresh BSP (min leaf 12) fills the rest, dropping leaves within 3 tiles of the gallery; rooms are joined by a minimum spanning tree (the gallery's corridors leave from its rim) plus 4 loops. Connectivity is checked.
3. **Roles:** Floor 1 by walking distance from the Foyer: Chapel (far + large), the West Stair Hall (the farthest room with a tile whose column lands inside a Floor-2 room), Library (~50%), Stairwell (~70%), Banquet Hall (largest), Armory, Nursery, then sized pools. Floor 2: the Landing (the room the family spiral rises into), Grand Ballroom (largest), Observatory / Alchemy Wing / Master Study / Rose Bedroom, then sized pools.
4. **The basement** from a template; the cage connects only through a 1-tile passage ending in its door.
5. **The placer** (one per level) reserves tiles next to doorways and spawn areas. Every blocking placement runs a flood-fill **connectivity check** and is reverted if it would split the floor; a dry-run mode checks a stair's upper half before its lower half is placed. Floor-standing interactables reserve the tile in front of them.
6. **Stairs:** the spiral pair (West Stair Hall ↔ Landing, same tile), the dual grand staircases (two Foyer back-wall edge tiles, as far apart as possible ↔ the gallery rim tile directly above), the servants' stair (↔ basement).
7. **Hearts:** 7 rooms (3–4 on Floor 1, the rest on Floor 2, preferring ≥ 30 tiles), one disguise each, then 3 ward props of one random kind in the same room; then 2–3 decoys per disguise, stained-glass windows in grand rooms, and furniture recipes per room type.
8. If any placement fails, retry with a new derived seed (up to 60 attempts; about 14 ms per mansion).

---

## Rendering

- Per floor: one `InstancedMesh` per wall finish (wallpaper/rose/green/chapel stone/basement stone, chosen by the room a wall faces), per floor finish (marble/parquet/flagstone/velvet by room type), ceilings (coffered or stone), Gothic arches (two orientations), and the balustrade/slab edge around the void. Ceiling and floor tiles are omitted over the void and at each spiral's column.
- **Materials:** `MeshStandardMaterial` with a canvas albedo + a normal map made from a painted height map (`heightToNormal`, Sobel) + a roughness map. Paintings sway via an `onBeforeCompile` UV patch on a shared `time` uniform. Window moonbeams and Lumos beams are additive cone `ShaderMaterial`s faded by view angle and distance. Sconces and chandeliers flicker with additive glow sprites, not lights.
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
| **5 · Archon** | ✅ Done. See *The finale* above. |
| **6 · v2.0** | ✅ Done. See the Amalgam notes above. |
| **7 · v3.0** | ✅ Done. See *Hearts, Sin tasks and the Sins*, *The Disillusionment Charm*, *The client (Steps 6–7)* and *The grimoire* above. |
| **Next** | Mixing by ear with real players, real-multiplayer balance of the sight-lock, mobile controls. |
