# SIX HEARTS: THE FORBIDDEN CONVERGENCE
### Game Design Document · v0.2 (prototype)

> *Seven wizards. One mansion. Six hearts that must stop beating.*

---

## 1. High concept

A 3–4 player online co-op survival horror game played in first person in the browser. A coven of wizards enters a procedurally generated Gothic mansion in near-total darkness. They find and read a forbidden Tome, which wakes the mansion's Keeper (the Monster). Then they hunt down six Hearts disguised as ordinary heirlooms and destroy them. Finally they cast a spell that fuses their bodies into a single seven-element being, the **Archon**, to drag the Monster into Hell.

The Monster never kills. It **takes** wizards to a cell in the basement. The horror comes from slowly losing teammates, and the hope comes from going back down into the dark to get them.

### Pillars
1. **Darkness is the level design.** The only reliable light is the wand you hold. Rooms are learned by touch, sound, and memory.
2. **Never alone, never safe.** Co-op is required: capture can only be undone by a teammate, and the final fight needs everyone's magic at once.
3. **Ordinary things are wrong.** The Hearts hide among real props, so every clock, mirror and doll gets a second look.
4. **Earned dawn.** The ending is a hard turn from dread into warmth, and it feels earned because of the escalation that came before.

### Inspirations
- *P.T.* for corridor repetition, tight framing, and "is that new?" environmental dread.
- *Alien: Isolation* for an unkillable stalker AI that learns, retreats and returns, driven by noise.
- *Hereditary* for family-heirloom horror, miniatures and dolls, and grief made physical.
- *Lights Out* for things that exist only outside the light cone.

---

## 2. Players, session & flow

| | |
|---|---|
| Players | 3–4 (lobby of up to 4; **bots** fill seats for testing; host may enable **solo debug** to start with fewer than 3) |
| Session length | 25–40 minutes |
| Platform | Desktop browser (Chrome/Edge/Firefox/Safari), keyboard + mouse |
| Camera | First person, pointer-locked |

**Flow:** Title → Summon or Join a Coven (4-letter code) → Wizard Select (each wizard is unique per coven) → Ready → Host begins → Phases I–IV.

---

## 3. Phases

### Phase I — The Tome
- The coven spawns in the **Grand Foyer** on the ground floor. The Monster is dormant.
- The **Ritual Book** (the Forbidden Tome) rests on a lectern in the **Library**, somewhere mid-mansion.
- Reading it takes **2 seconds of channelling** (hold E). If the reader moves away, the channel breaks.
- **On completion:**
  - The phase advances to II for everyone.
  - The Monster awakens (Step 4: an awakening shriek, followed by its first hunt).
  - Every player's **Journal** (J) fills with the Tome's text and **six riddled clues**.
  - The six Hearts start showing their subtle **tells** (see §5).

### Phase II — The Six Hearts & The Cell
- Each clue names a Heart's disguise and hints at its room ("*A pendulum that keeps a pulse instead of the hour. Seek it where the dead were dressed for dinner.*" points to the Beating Clock in the Grand Dining Hall).
- Room names fade in as you enter a room, so players can match hints to places.
- Destroying a Heart takes **2.5 seconds of channelling**. Destroyed Hearts burst into embers and are crossed out in the journal and on the HUD.
- Examining a **decoy** gives a whisper. (Step 4: it also makes **noise**, which draws the Monster.)
- **Capture (Step 4):** a Monster catch never kills. The victim is teleported into the **Basement Ritual Cell** behind an iron gate.
  - A free teammate must reach the gate and **channel for 3 seconds** to break the ritual lock. Everyone inside is freed, and the gate re-seals after 5 seconds.
  - Caught players can still talk (proximity voice comes later) and watch through the bars.
  - **If every living wizard is in the Cell at the same time, it is Game Over.**
- Destroying a Heart enrages the Monster and forces it into a **Hunt** toward the Heart's room.

### Phase III — The Forbidden Spell & Soul Merge (Step 5)
- When all six Hearts are silent, the phase becomes **Convergence**. All free wizards must gather at the **Ritual Altar** in the Chapel, and any captives must be freed first.
- The **Forbidden Spell** is a group channel at the altar (each player holds E; progress only advances while every free wizard is in the circle).
- **Soul Merge:** the bodies dissolve and **the Archon** rises, a single towering avatar.
  - **Shared control:** the host's input drives movement. Each player owns their own element's ability and can also fire *any* of the seven abilities from a shared radial (keys 1–7). All cooldowns are **25%** of their normal values (`ARCHON_COOLDOWN_SCALE`).
  - The Monster now has a **health bar**. Damage comes from Fire, Water and Earth, plus combination bonuses (for example, Water then Earth equals "mire": a longer slow).
- **Hell Portal:** at 0 HP the Monster is staggered and a portal tears open under the altar. The Archon must use Wind to push the Monster into the rift and Black to hold its mind there, while the Monster claws back toward the light. Success is a 10-second tug-of-war bar.

### Phase IV — Epilogue (Step 5)
- A whiteout transition. Then the same mansion appears in **warm, low morning sun**: open shutters, ivy, birds, a working fountain, children on the lawn.
- The camera glides through rooms the players fought in, now clean and lived in.
- **Epilogue cards:** one per wizard in the coven, each showing their family at peace (text from `shared/wizards.js` → `epilogue`), with a hand-painted-style procedural vignette.
- The credits roll over a slow piano rendition of the music-box lullaby, now in a major key.

### Loss
- **Game Over:** all wizards are in the Cell at once. The screen fills with red static, the gate slams, and the Monster's face appears in the bars. Then the lobby returns.

---

## 4. The Seven Wizards

| # | Wizard | Element | Title | Ability | Effect | CD |
|---|---|---|---|---|---|---|
| 1 | **Injorath Blackthorn** | Black | Heir of the Forbidden Arts | **Mental Torture** | 0 dmg. Monster shrieks (distorted audio), **chase interrupted 2s**, **silhouette visible through walls for all players 5s**. | 16s |
| 2 | **Parthius Pyreborne** | Fire | Infernal Prodigy | **Fireball** | Projectile, **4 chip dmg**, leaves **burning embers = dynamic light for 8s**. | 5s |
| 3 | **Himandriel Tidecrest** | Water | Lord of the Tidal Arts | **Tidal Wave** | **3 chip dmg**, **slow −40% for 4s**. | 9s |
| 4 | **Sushantus Thornwick** | Earth | Warden of the Ancient Grounds | **Earth Wall / Tremor** | **3 chip dmg**, spawns a **stone barricade (4 units wide) for 5s** that blocks the Monster (and pathing). | 12s |
| 5 | **Kartavian Windermere** | Wind | Tempest Sovereign | **Gale Push** | 0 dmg, **knockback 5 units** directly away from the caster. | 8s |
| 6 | **Soham Everlight** | White | Luminary of the Sacred Order | **Sacred Flash** | **Stun + blind 3.5s** (Monster loses all targets). | 20s |
| 7 | **Himanshu Nullgrave** | Anti-magic | The Unspellable | **Void Shield** | **Blocks Monster attacks/lunges for 3s** for the caster and allies within **6 units**. | 18s |

Numbers live in `shared/wizards.js` and are the single source of truth for both the server and the HUD.

**Role notes:** Black and White are the "save a friend" tools. Fire lights the way and keeps chip damage flowing for Phase III. Earth controls space. Wind is the panic button. Anti-magic makes a rescue run possible. Water sets up every combo.

**Combos (Phase III / stretch for Phase II):** Water → Earth = *Mire* (double the slow duration). Fire → Wind = *Firestorm* (knockback plus a burning trail). White → Black = *Revelation* (stun plus a reveal that lasts the whole stun).

---

## 5. The Six Hearts

| Heart | Disguise | Tell (after the Tome is read) |
|---|---|---|
| The Cursed Mirror | Gilded wall mirror | Glass blushes red in a heartbeat rhythm |
| The Bleeding Painting | Ancestral portrait | Eyes and canvas bleed; the paint pulses |
| The Beating Clock | Grandfather clock | Pendulum swings in a *lub-dub*, not a tick; the bob glows |
| The Weeping Doll | Porcelain doll on a side table | Weeps red; the head **turns to follow you** |
| The Whispering Music Box | Music box on a side table | The ballerina turns; red light inside the lid |
| The Black Candelabra | Five-candle candelabra | Burns with black flame that casts no light |

- Every disguise has 2–3 identical **decoys** spread across other rooms. The Portrait Gallery and the Nursery are natural traps.
- Each Heart sits in a different room. There is a 40% chance that one Heart is placed in the basement (Crypt, Wine Cellar or Ossuary).
- **Clients never learn which props are Hearts until the Tome is read.** The server strips heart and decoy flags from the map it sends.

---

## 6. The Monster: "The Keeper" (Step 4)

A tall, emaciated thing in the last lord's funeral clothes. It moves wrong.

### Senses
- **Sight:** a cone, blocked by walls. A lit wand is visible from much farther away than a dark one.
- **Hearing:** noise events with a loudness and position. Sprinting is loud, walking is medium, crouching is near-silent. Also loud: examining a decoy, destroying a Heart (very loud), casting.
- **Menace gauge:** the Alien: Isolation approach. A hidden "director" keeps the Monster near the coven without cheating outright, and backs it off after a capture or a long chase.

### States
1. **Dormant** (Phase I).
2. **Stalking:** paths to positions *just outside* players' light cones, preferring doorways and corners (peek behind a frame, withdraw). Plays footsteps behind the player. Never attacks from this state.
3. **Hunting:** triggered by a loud noise, a sighting, or a Heart being destroyed. It sprints with jittery, stuttering animation (frame skips, limb snapping) and lunges at close range.
4. **Searching:** goes to the last known position and sweeps nearby rooms.
5. **Stunned / Retreating:** a reaction state for each counter-spell:
   - *Wind:* physically flung 5 units, staggers.
   - *White:* frozen and blinded for 3.5s.
   - *Black:* clutches its head, shrieks, drops its target for 2s, visible through walls.
   - *Anti-magic:* lunge rebounds off the shield, brief stagger.
   - *Earth wall:* re-paths around it, or waits.
   - *Water:* 40% slower.
6. **Carrying:** after a catch, a short fade to black, then the victim wakes in the Cell. The Monster retreats for a while.

### Presence cues (anything within 15 units)
- Lights and the wand flicker or brown out.
- The proximity heartbeat speeds up (60 to 160 bpm).
- Film grain and vignette tighten. Ambience ducks.

---

## 7. Horror presentation

### Visual
- `FogExp2` black fog and a near-zero hemisphere fill. The wand spotlight is about 25° with soft edges and casts shadows from a hand offset, so shadows swing as you move.
- **(Step 4)** Post-processing: film grain, vignette, chromatic aberration on scares, desaturation when caught, a lens-dirt bloom on fire.
- Procedural textures only: damask wallpaper with water damage, wainscot, planks, carpet runners, flagstones, oil portraits with hollow eyes, and a seven-pointed ritual circle.
- Room titles fade in with letter-spacing, like a P.T.-style hallway card.

### Audio (Step 4, Web Audio API, fully procedural)
- **Ambient drone:** detuned low oscillators, filtered noise "air", and a slow LFO.
- **Footsteps behind the player:** positional (PannerNode, HRTF) noise bursts with a lowpass. Sometimes they belong to the Monster and sometimes to nothing.
- **Proximity heartbeat:** a two-thump envelope whose rate maps to Monster distance.
- **Black Magic shriek:** stacked sawtooth formants, a pitch-bending waveshaper, and ring modulation.
- **Heart tells:** a positional heartbeat, audible within about 4 units of an undestroyed Heart.
- **Music box lullaby:** a sine-and-bell synth. Its minor version plays in Phase II and its major version in Phase IV.

---

## 8. The Mansion

### Ground floor (60 × 60 tiles, 1 tile = 2 m)
- Rooms come from BSP leaves (min leaf 10 tiles). They are joined by 1- or 2-tile corridors, with **3 extra loop corridors** so chases rarely dead-end.
- Doorways at choke points get dark wood frames.
- **Fixed roles:**
  - *Grand Foyer:* the southernmost room and the spawn.
  - *Chapel of the Altar:* the farthest room by walking distance with a large floor area. It is the Phase III arena.
  - *Library:* about the midpoint by walking distance. Holds the Tome.
  - *Servants' Stairwell:* about 70% of the way out. Holds the stairs down.
- **Themed rooms** (assigned by size): Ballroom, Grand Dining Hall, Portrait Gallery, Conservatory, Music Room, Master Bedroom, Parlor, Billiard Room, Trophy Room, Kitchen, Guest Bedroom, Nursery, Study, Servants' Quarters, Washroom, Sewing Room, Smoking Room. Each one has a furnishing recipe.

### Basement (34 × 26, authored template)
- Cellar Antechamber (stairs up), Family Crypt, Wine Cellar, Ossuary.
- The **Basement Ritual Cell** is reachable only through a 1-tile passage closed by an **iron gate** with a glowing ritual lock.

### Guarantees (enforced by the generator and by tests on 60 seeds)
- The floor is never cut in two by furniture.
- Doorways are never blocked.
- Every interactable can be reached on foot.
- The Cell can only be left through the gate.

---

## 9. Controls

| Input | Action |
|---|---|
| Mouse | Look (pointer lock; click to capture, Esc to release) |
| W A S D / arrows | Move |
| Shift | Sprint: loud, uses stamina (drains in about 4s, recovers in about 7s) |
| C (toggle) / Ctrl (hold) | Crouch: slow and quiet |
| E (hold) | Interact: read, destroy, examine, use stairs, break the lock |
| F | Wand light on or off. Darkness hides you from the Monster but blinds you too. |
| J | Journal (the Tome's text and clues) |
| 1–7 (Phase III) | Archon element radial |
| Q / RMB (Step 3) | Cast your wizard's ability |
| M (debug) | Top-down debug map. In solo-debug lobbies, click it to teleport. |

---

## 10. Debug & testing affordances
- **Solo test** button: creates a coven with solo debug enabled and two bot teammates.
- **Bots:** server-side teammates that follow the nearest human using A*, take the stairs when you change floor, sprint to catch up, and scan the dark when idle. A human picking a bot's wizard makes the bot switch.
- `?debug=1` shows the FPS, draw call and position HUD, enables the M map, and exposes `window.__game`.
- `?join=CODE` pre-fills the join code (useful for shareable links).

---

## 11. Roadmap

| Step | Scope | Status |
|---|---|---|
| 1 | Project, server, client shell, GDD/Architecture | ✅ Done |
| 2 | Mansion generator, rendering, movement, lobby, bots, Tome/Hearts/stairs interactions | ✅ Done |
| 3 | Wizard abilities: casting, cooldown UI, VFX, server-side effects | ⏳ Next |
| 4 | Monster AI, post-processing, procedural audio, Cell capture and rescue | ⏳ |
| 5 | Forbidden Spell, the Archon, Hell Portal, Epilogue | ⏳ |
