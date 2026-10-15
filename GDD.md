# SIX HEARTS: THE FORBIDDEN CONVERGENCE
### Game Design Document · v0.5 (prototype)

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
| Session length | Open-ended: no timer. It ends on victory (the Portal sealed) or when everyone is held. Typically 30–60 minutes. |
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
- **Capture:** a lunge that lands never kills.
  - The victim gets a 0.85s close-up of its screaming face, then a fade to black, and wakes in the **Basement Ritual Cell**. The gate re-seals.
  - Prisoners can walk the Cell and watch through the bars.
  - They can **call for help** with **G**: a marker visible through walls plus a spatial wail.
  - They can **cast through the bars**; projectiles fly between them.
  - A free teammate (human or bot) must reach the gate and **channel for 3s** (Soham: 1.5s) to break the lock. The gate opens for 6s and everyone held is freed. It never slams shut on someone standing in it.
  - **If every wizard is held at the same time, it is Game Over: "The Ritual Consumes You".** The host chooses **Retry**, which restarts the current phase from the Foyer with your progress (Tome and Hearts) kept, or **Return to the coven**.
- Destroying a Heart enrages the Monster and forces it into a **Hunt** toward the Heart's room.

### Phase III — The Forbidden Spell & Soul Merge
- When all six Hearts are silent, the phase becomes **Convergence**. Every wizard must gather at the **Ritual Altar** in the Chapel; anyone held in the Cell must be freed first, because the spell needs **every** voice.
- **The Forbidden Spell** is a group channel: each player **holds E** at the altar. A bar at the top fills over **6s** of unbroken chanting by everyone, and drains (0.15/s) whenever any wizard lets go. Gold and violet motes spiral into the altar while the chant rises. Bots walk to their own place around the circle and join in.
- **Soul Merge (3s cinematic):** ribbons of gold and violet spiral out of every wizard into a blinding core over the altar. Then the bodies are gone and **the Archon** stands in their place.
- **The Archon** is one towering body (eye height 3m, speed ×1.25, **500 HP**):
  - **The host drives.** Everyone else rides along inside and aims and casts freely.
  - Everyone's **own four spells and Ultimate stay live** on supercharged cooldowns (`ARCHON_COOLDOWN_SCALE`, ×0.25).
  - **Keys 1–7 fire the seven Elemental Masteries.** They share one set of cooldowns because they belong to one body: ✹ Fire Dragon (25 dmg), ≈ Wind Dragon (shove; it pushes *into* the rift once it's open), ♒ Water Deluge (slow), ▲ Earth Pillars (ring of pillars, root), ☉ White Chains (freeze), ☾ Black Torment (interrupt), ⚔ Anti-Magic Slash (cone; the only thing that breaks a ward).
  - In first person a **heptagram crown** of seven orbs circles your sight. An orb shrinks while its Mastery cools down.
  - Archon damage is shared by everyone. Devil Union makes it immune, Aegis blocks, Granite Skin hardens it, and the Patronus and the Tree of Life heal it. **At 0 HP it is Game Over**, and Retry re-merges and refights the boss.
- **The Unbound Malphas Amalgam** (300 HP, ×1.45 scale): the Chapel splits with glowing hellfire cracks and the Amalgam rises from them.
  - **Bullet-hell orb volleys:** a ring of 16 orbs plus three fast ones aimed at the Archon, every 4.5s. Raising a ward fires a 24-orb ring.
  - **Floor shockwaves:** a 1s telegraphed windup, then an expanding ring every 7s.
  - **Telegraphed charges** every 9s.
  - It circles the Archon at 5 to 9 units.
  - At **66% and 40%** it raises a crimson **ward** for 4s, and only the Anti-Magic Slash cuts through.
  - The Archon's normal spells hit it **×2.5**. No crowd control holds it longer than **2.5s**, so even Dawn doesn't stunlock it.
- **The Hell Portal:** at **20% HP** a swirling rift tears open over the altar. The Amalgam can no longer die. It claws away from the rift (sliding along walls) unless it is bound.
  - **Bind** it with roots, chains, freeze or pins, **shove** it with Wind, and **Soul Grapple** it: hold **E** or **R**, and each grappling wizard adds pull, up to 3.
  - Inside 2.6u of the centre it is **dragged under**. A 3s sealing roar follows, then **victory**.

### Phase IV — Epilogue
- **Whiteout**, then **warm major-key procedural music**: C–G–Am–F pads, a harp arpeggio and birdsong. The horror drones fade away.
- **Scene 1, the Grand Foyer restored:** the real generated foyer relit by morning sun. Light shafts, ivy climbing the walls, flowers in the corners, dust motes in the beams; no monster, no fog.
- **Scene 1b, the Estate:** the manor seen from its gardens. Ivy on the stone, a running fountain, low-poly trees, flower beds, birds and a blue sky.
- **Scene 2, the families:** one vignette per wizard in the coven, 5s each. Their family picnics on the lawn, children play, and the wizard's translucent spirit watches over them. Each vignette shows the wizard's personal `epilogue` text, plus "for *player*, who gave their soul to the Convergence".
- **The final card**, "The Convergence Is Ended", with **Play Again** (a fresh mansion for the same coven) or **Return to the Coven**. Only the host can choose; everyone else sees "The host will choose…".

### Loss
- **Game Over:** all wizards are in the Cell at once. The screen fills with red static, the gate slams, and the Monster's face appears in the bars. Then the lobby returns.
- **The Archon falls** (0 HP in Phase III): Game Over. Retry re-merges the coven at the altar and refights the Unbound Amalgam from full health.

---

## 4. The Seven Wizards: a 35-spell Grimoire

Every wizard has **four spells on the hotbar (1–4)** and an **Ultimate (R)**. The numbers live in `shared/wizards.js` and are the single source of truth for the server, the bots and the HUD.

**Casting:**
- **1–4** casts that slot and selects it; **Left Mouse / Q** casts the selected slot.
- The server checks cooldown, range, aim cone and line of sight, then broadcasts the cast so every client renders it.
- Projectiles that home in or curve around corners move on the server, and clients follow their snapshot positions.
- **R** fires the Ultimate at **100% charge**. A targeted Ultimate with nothing to hit is refused, and the charge is not spent.

| Wizard | 1 | 2 | 3 | 4 | R · Ultimate |
|---|---|---|---|---|---|
| **Injorath Blackthorn** · Black · *Heir of the Forbidden Arts* | **Psychic Torment**: chase broken 2s, shriek, visible through walls 6s (16s) | **Dimension Slash**: void crescent; 5 dmg, heavy stagger, **reach −40% for 6s** (7s) | **Black Hole Singularity**: gravity well drags the Monster in for 3s, 1.5 dmg/s (14s) | **Shadow Step**: 2.5s of smoke: +40% speed, **invisible to the Monster**, through furniture (16s) | **Abyssal Mind Fracture**: chains + crimson sigils lock its mind **10s**. It can't move and tears at itself (4 dmg/s), shrieking. It can't flee until released. |
| **Parthius Pyreborne** · Fire · *Infernal Prodigy* | **Ignis Blast**: fireball, 4 dmg + burn, scorch light 4s (5s) | **Calidus Brachium**: 3 flame fists, 2 dmg + knockback each (8s) | **Sol Linea**: white-hot beam (6 dmg) + **burning floor line 5s** (11s) | **Phoenix Cinder Aura**: 6s ember cloak: +30% sprint, bright light, burns on contact (18s) | **Fiendfyre Great Dragon**: an articulated fire serpent (head, jaws, wings, ember body) hunts the Monster through the corridors and detonates: **35 dmg** + burn. |
| **Himandriel Tidecrest** · Water · *Lord of the Tidal Arts* | **Tidal Surge**: wave, 3 dmg, slow 40% 4s, slick puddle (9s) | **Valkyrie Water Spear**: piercing spiral lance, 5 dmg, **pinned 1.5s** (9s) | **Sea Dragon's Cradle**: water spheres on allies within 4u **absorb 40 dmg** for 10s (20s) | **Riptide Vortex**: rune trap (30s). Stepped on, a geyser lifts it 2.5s (15s) | **Abyssal Deluge**: animated water floods **the whole mansion for 25s**. The Monster moves at **35%** everywhere. |
| **Sushantus Thornwick** · Earth · *Warden of the Ancient Grounds* | **Terra Spike**: spikes 3 dmg + 3-tile barricade 5s (12s) | **Devil's Snare Briars**: thorned vines, **rooted 2.5s** (12s) | **Golem Boulder Toss**: 6 dmg, shatters into a **slowing debris field** (10s) | **Granite Skin**: allies within 4u take **−60% damage** for 6s (18s) | **Yggdrasil, Tree of Life**: a glowing tree grows from the floor with **one golden fruit per wizard**. **E** eats one: **+60 HP** and all terror cleared. |
| **Kartavian Windermere** · Wind · *Tempest Sovereign* | **Gale Force**: knockback 5u (8s) | **Crescent Kamaitachi**: 3 wind blades that **home in, even around corners** (7s) | **Zephyr Tailwind**: allies within 5u +45% speed, tireless sprint, 6s (16s) | **Vacuum Tempest**: imploding vortex, **lifted 1.5s** (12s) | **Sylph's Great Wind Dragon**: a tornado serpent seizes the Monster and **sweeps it to the farthest room on the floor** (2s stagger on landing). |
| **Soham Everlight** · White · *Luminary of the Sacred Order* | **Sacred Bind**: stun + blind 3.5s. Passive: 2× lock breaking (20s) | **Arrows of Judgment**: 5 homing swords of light (9s) | **Patronus Beacon**: a radiant spirit stag for 10s, **heals 4 HP/s** within 6u (22s) | **Flash Step**: blink 6u; the afterimage blinds 1.2s (10s) | **Dawn of the Sacred Order**: golden cathedral light floods the mansion (fog lifts) and the Monster is **frozen in golden chains for 30s**. |
| **Himanshu Nullgrave** · Anti-magic · *The Unspellable* | **Aegis of the Void**: attacks fail vs allies within 3u for 3s (18s) | **Black Slash**: cancels its windup, **strips enrage 8s** (9s) | **Null Zone**: 6s field: no light flicker, no terror (18s) | **Bull Thrust**: dash 5u, knockback 3u, **taunts it onto you** (12s) | **Devil Union: Absolute Nullification**: black-and-crimson wings on every wizard for **30s**. Monster attacks, lunges and captures **have no effect**, and it recoils. |

**Ultimate charge (0–100%):**
- **+8%** for landing a normal spell (once per cast).
- **+2%/s** while the Amalgam hunts you.
- **+25% team-wide** per destroyed Heart.
- **+20%** for freeing prisoners.
- **+0.4%/s** passively once the Tome is read.

**Combined elements:** three *different* elements landing on the Amalgam within 5s banish it (a coven tactic; one wizard alone can't).

---

## 4b. Lumos, Health & the Endless Night

- **Lumos / Nox (F):**
  - **Nox** is the default: a narrow, dim wand glow.
  - **Lumos** is a bright, wide crystalline torch (28u, about 50° cone) that makes rooms readable.
  - **Trade-off:** with Lumos lit, the Amalgam **sees you 50% further away** (16u → 24u; crouched 8u → 12u).
  - During a hunt within 12u, Lumos strobes violently as a warning.
- **Health (100 HP):**
  - **Claw Slash:** 30.
  - **Dark Shockwave:** 15 to everyone within 3.5u.
  - **Shadow Tendril:** 20 at up to 7u, from 2+ Hearts.
- **Capture:**
  - A hit on a wizard **at or below 40 HP drags them to the Cell**, and so does the **heavy, telegraphed Lunge** at any HP.
  - The shockwave splash only captures someone it knocks to 0.
  - **Prisoners stabilise at 50 HP.**
- **Recovery:** HP regenerates slowly (1/s) after 8s without damage, **only up to 60**. Above that you need magic: the Patronus, the Tree of Life, Cradle absorbs and Granite skin.
- **No timer:** a session lasts until the coven seals the Hell Portal (victory) or everyone is held at once (game over, Retry keeps your progress).
- **A tougher Keeper:**
  - Hunt speed **4.5 → 5.4 u/s** at five Hearts, and aggression rises with every Heart.
  - **At 2+ Hearts:** the Shadow Tendril.
  - **At 4+ Hearts:** it **smashes Earth barricades in two hits** and conjures **phantom decoys**.

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

## 6. The Monster: the Malphas Amalgam

The last lord's Keeper: too tall for the doorways, gaunt and lopsided (one arm far longer than the other), in a tattered burial shroud. Its ribcage is open, and six heart-nodes pulse inside it. **One goes dark each time a mansion Heart is destroyed.** Its head is a pale, crooked skull with an unhinged jaw, pinpoint eyes, and hair hanging in curtains.

### Uncanny motion (client)
- **Stop-motion body:** limbs and head are re-posed at a quantised ~13 Hz while its position glides smoothly. It moves like a stop-motion nightmare.
- **Doorway neck-snap:** at doorways it snaps its head 90° sideways and hunches its shoulders to fit through.
- **Convulsions:** when Stunned (White) or Tormented (Black) it twitches its head, jaw and limbs violently. When idle it twitches occasionally.
- **Hunting gait:** pitched forward with arms trailing behind. Peeking: leaning out sideways with a hand on the door frame.
- **Retreating:** claws its way up into the ceiling.

### Senses
- **Sight:** a ~125° cone with line of sight. A wizard is visible at 16u (8u crouched), and **×1.5 with Lumos lit**. Shadow-stepped wizards are invisible. While hunting it tracks its prey in every direction (30u).
- **Noise:** carries to a radius. Sprinting carries 10u, any spellcast 14u, a decoy heirloom 8u (sends it to search there). A **dying Heart is felt anywhere** and sends it to hunt the destroyer.
- **Being stared at:** a lit wand held on it for **1.5s** (within 14u, inside about 15°) makes it **duck out of sight** (55%) or **charge** (45%). With no cover nearby it charges.

### States (server, `server/Monster.js`)
| State | Behaviour |
|---|---|
| **Dormant** (before the Tome) | Not in the world. Every 35–75s (first time at 20–40s) it **haunts** a wizard: a silhouette 14–24u away at a corner or doorway, in view but out of the light. Its eyes glint through the fog. When a wand beam lands on it, it lingers about 0.3s (a lit glimpse) and then vanishes. It also fades on its own after 6s. It cannot be targeted. |
| **Stalking** | Picks spots 12–22u from the nearest free wizard, preferring tiles no one can see, out of wand light, at doorways and corners. **Peeks** for 1.5–3s at those spots. Charges if a wizard comes within 8u in its view, and occasionally (30% every 7s while it sees prey) on its own. |
| **Hunting** | Sprints at **4.5 u/s + 0.18 per destroyed Heart** (5.4 at five; wizards sprint at 5.6 but tire). Close in (2.6u):<br>• **Claw Slash** (0.35s windup, 30 HP)<br>• **Dark Shockwave** (0.6s, 15 HP to everyone within 3.5u, favoured against groups)<br>• the **heavy Lunge** (22%, 0.7s telegraph, always captures)<br>• the **Grab** (any wizard at ≤ 40 HP).<br>From 2+ Hearts it adds the **Shadow Tendril** at 3–7u (20 HP). From 4+ it **smashes barricades**. Void shields block every attack, and Devil Union nullifies them. After 3.5s without sight, or 40s of hunting, it switches to Searching. |
| **Searching** | Goes to the last known position, **listens** for 2.5s, sweeps up to 3 nearby rooms, then returns to Stalking after 16s. Sight or noise restarts the hunt. |
| **Retreating** | Flees and climbs into the ceiling (1s), then stays hidden **12–18s** and reappears out of sight. Triggered by: a capture; its **60 stagger HP** running out; or **three different elements within 5s** (combined elements). Psychic Torment and Sacred Bind also break an active chase (switching it to Searching). |
| **Guarding** | While anyone is held, stalking goals favour the basement (65% from upstairs, 85% once down there). It prowls near the stair and Crypt but **never within 6u of the gate**, and still ventures upstairs to stalk. |

---

## 7. Horror presentation

### Visual
- `FogExp2` black fog and a near-zero hemisphere fill. The wand spotlight is about 25° with soft edges and casts shadows from a hand offset, so shadows swing as you move.
- **Post-processing** (`client/js/fx/PostFX.js`):
  - film grain;
  - a vignette that tightens as the Amalgam nears or stamina runs low;
  - chromatic aberration on Black casts, lunges and the jumpscare;
  - a lens warp and wider FOV from **terror**;
  - desaturation while held in the Cell;
  - a red flash and fade to black on capture.
- **Lights Out:** within 15u of the Amalgam, wand lights and candles gutter and drop out. While it hunts nearby, your wand **cuts out for 0.3s** at random, causing panic flashes.
- **Terror:** looking straight at it within 12u (with line of sight) builds terror, which warps the FOV and thickens the grain until you look away.
- Procedural textures only: damask wallpaper with water damage, wainscot, planks, carpet runners, flagstones, oil portraits with hollow eyes, and a seven-pointed ritual circle.

### Audio (Web Audio API, fully procedural: `client/js/audio/AudioEngine.js`)
- **Ambience:** detuned low oscillators, filtered draughts, and a generated stone-house reverb.
- **Proximity:**
  - a **40–60 Hz sub-bass thrum** and a muffled **heartbeat (58→168 bpm)** that grow as the Amalgam closes from 18u to 3u;
  - the heartbeat never drops below a racing pulse while you are being hunted.
- **Spatial Amalgam cues (HRTF):** wet clicking footfalls with a bone click, and dragging claws.
- **Hallucinations** while it stalks within 26u:
  - formant-shifting **whispers** just behind your left or right ear;
  - **three rapid ceiling knocks** overhead.
- **Black Magic shriek:** an FM sawtooth screech, a dissonant square with vibrato, and bandpass-swept noise, distorted and fed into a long reverb tail. It also plays on awakening and (lower) on banishment.
- **One-shots:**
  - a distinct sound for each of the seven spells, plus fireball impacts;
  - the gate clank and lock-grinding;
  - the **Tome awakening gong** and the hunt stinger;
  - the capture jumpscare, Heart destruction, and ping calls;
  - your own footsteps on wood and stone.
- **Heart tells:** once the Tome names them, undestroyed Hearts beat faintly within 7u.

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
| 1 – 4 | Cast spell 1–4 (and select it) |
| Left Mouse / Q | Cast the selected spell |
| R | Ultimate (needs 100% charge) |
| E (hold) | Interact: read, destroy, examine, use stairs, break the lock, eat from the Tree of Life |
| F | Lumos / Nox: a bright, wide torch, but you're seen 50% further away |
| J | Journal (the Tome's text and clues) |
| G | Call for help: ping your location to the coven |
| E (hold, Convergence) | Chant the Forbidden Spell at the altar (everyone at once) |
| 1–7 (Archon) | Elemental Masteries (shared cooldowns) |
| E / R (hold, Hell Portal) | Soul Grapple: drag the Amalgam into the rift |
| M (debug) | Top-down debug map. Click it to teleport. |
| P (debug) | Cycle the monster: Husk → Haunt → Stalk → Hunt → Capture test → Auto |
| K (debug) | Capture yourself instantly; if you're already held, break the lock |
| Shift + 1–7 (debug) | Hot-swap your wizard (whoever held it gets yours) |
| U (debug) | Fill your Ultimate charge |
| H (debug) | Skip to Convergence: Tome read, all six Hearts destroyed, prisoners freed to the altar |
| N (debug) | During the boss fight: drop the Unbound Amalgam to 25% with its wards spent, just above the Hell Portal |

---

## 10. Debug & testing affordances
- **Solo test** button: creates a coven with solo debug enabled and two bot teammates.
- **Bots use the whole grimoire:** each spell's `bot` hint (target, ally, self, escape, zone, heal) decides when it fits. They fire Ultimates at 100% against the real Amalgam (or to heal), and eat Tree of Life fruit when hurt.
- **Bots** rescue first: when anyone is held, they run to the Cell (taking the stairs) and break the lock. Against the Amalgam they cast only when it threatens someone, which means it is hunting or within 8u. A bot's name follows its wizard when swapped.
- **Bots (movement):** server-side teammates that follow the nearest human using A*, take the stairs when you change floor, sprint to catch up, and scan the dark when idle. A human picking a bot's wizard makes the bot switch. When a monster is within 16u and their spell is nearly ready, they **move into range and cast it**. Aegis bots shield when the monster closes on someone near them.
- **Test Monster Husk** (P, debug only): a slow, harmless husk with 100 HP that patrols, shambles after the nearest wizard it can see, and telegraphs a claw swipe (0.7s windup, every 3s). A floating panel shows HP and every status (Stunned, Tormented, Slowed, Burning, Knocked Back, Blocked, Visible Through Walls), along with damage numbers. It crumbles at 0 HP and re-forms after 3s. It uses the same `MonsterBody` as the Step 4 Monster, so every spell verified on it works on the real thing.
- **Bots in the finale:** they walk to their own place around the altar and chant. Inside the Archon they cast their own spells, channel **their own element's Mastery** (and the Wind Dragon at the portal) only after it has sat ready for 2.5s, so humans get first pick of the shared cooldowns, and they Soul Grapple at the rift. Outside the finale they save Ultimates for the real Amalgam.
- `?debug=1` shows the FPS, draw call and position HUD, enables the M map, and exposes `window.__game`.
- `?join=CODE` pre-fills the join code (useful for shareable links).

---

## 11. Roadmap

| Step | Scope | Status |
|---|---|---|
| 1 | Project, server, client shell, GDD/Architecture | ✅ Done |
| 2 | Mansion generator, rendering, movement, lobby, bots, Tome/Hearts/stairs interactions | ✅ Done |
| 3 | Seven spells (server-side), cooldown HUD, procedural VFX, Earth barricades in collision and pathfinding, gate unlocking, Training Husk, bot casting, debug wizard swap | ✅ Done |
| 4 | Malphas Amalgam (model, stop-motion, AI states, haunting, noise, stare), procedural audio, post-processing, Lights Out, terror, capture/rescue/ping/game over, bot rescue | ✅ Done |
| 4.5 | Lumos, 35-spell grimoire + Ultimates and charge, player HP, tougher Amalgam (attacks, tendrils, smashing, phantoms), bots using the grimoire | ✅ Done |
| 5 | Forbidden Spell (group chant), Soul Merge, the Archon (7 Masteries, crown), the Unbound Amalgam (volleys, shockwaves, charges, wards), Hell Portal + Soul Grapple, sunlit Epilogue with families + Play Again | ✅ Done |
