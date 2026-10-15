# SEVEN HEARTS: THE FORBIDDEN CONVERGENCE
### Game Design Document · v2.0 (prototype)

> *Seven wizards. Seven Sins. Seven hearts that must stop beating.*

---

## 1. High concept

A 3–4 player online co-op survival horror game played in first person in the browser. A coven of wizards enters a procedurally generated Gothic mansion in near-total darkness. They find and read a forbidden Tome, which wakes the mansion's Keeper (the Monster), an unkillable stalker that locks on to the first wizard it sees. Then, across two stories, they hunt down seven Hearts disguised as ordinary heirlooms, break the wards that seal each one, and slay the Demon of the Seven Deadly Sins that erupts from it, locked in a room with it. Finally they cast a spell that fuses their bodies into a single seven-element being, the **Archon**, to drag the Monster into Hell.

The Monster never kills. It **takes** wizards to an iron cage under the basement. The horror comes from slowly losing teammates, and the hope comes from going back down into the dark to get them.

### Pillars
1. **Darkness is the level design.** The only reliable light is the wand you hold. Rooms are learned by touch, sound, and memory.
2. **Never alone, never safe.** Co-op is required: capture can only be undone by a teammate, and the final fight needs everyone's magic at once.
3. **Ordinary things are wrong.** The Hearts hide among real props, so every clock, mirror and doll gets a second look.
5. **Hide before it sees you.** Once it has you, only three Ultimates can save you; invisibility works only if you vanish first, and hold still.
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
  - Every player's **Journal** (J) fills with the Tome's text and **seven riddled clues**. The Tome names each Heart's disguise and hints at its room, but never says which object it is.
  - A Heart only shows its **tell** (see §5) once its room's wards are broken.

### Phase II — The Seven Hearts, Their Wards, the Seven Deadly Sins & the Iron Cage
- **Seven Hearts** hide across **Floor 1 and Floor 2** (3–4 on each; never in the basement). Each clue names a disguise and hints at a room ("*A pendulum that keeps a pulse instead of the hour. Seek it where the dead were dressed for dinner.*" points to the Beating Clock in the Banquet Hall). Room names fade in as you enter a room, and the minimap labels every room.
- **Room wards (3-part tasks):** a Heart cannot simply be destroyed. Its room holds three ward props of one kind, and all three must be broken (hold E) before the Heart unseals:
  - **Runic braziers:** light all three (1.4s each).
  - **Rune mirrors:** turn each until it faces the Heart; every mirror needs 1–3 turns (0.6s each).
  - **Clockwork pedestals:** wind all three (2.2s each).
  - **Cursed chalices:** place a coin in each (1s each).
  - With **Lumos** lit within about 9u, the ward runes glow faintly: Lumos is how you find them in the dark.
  - Wards only wake once the Tome has been read. Examining the true Heart while it is sealed tells you so ("It beats behind a seal… 2 of 3 still hold it shut"); decoys just whisper (and make noise).
- **Unsealed:** every client sees the Heart for what it is: its tell begins, and a red aura beats around it. A banner names the Sin waiting inside it.
- **Breaking it open (hold E, 2.5s) starts a lockdown:**
  1. **Room lockdown:** every doorway of that room is sealed by glowing **blood-rune barriers** (collision, pathfinding and visuals). No one inside can leave, nobody outside can come in, and **the Keeper cannot enter**: it is pushed out of the room if it was there, cannot attack or lock on to anyone behind the runes, and its lock on anyone inside is severed.
  2. **A Sin erupts** from the Heart (a 2.2s rise): one of the **Seven Deadly Sins** (§5b), 130–160 HP.
  3. **Slay it** with the 35-spell grimoire and the Ultimates. Its Heart shatters for good, every wizard gains **+25 Ult (the Heart) +20 (the Sin)**, and the runes fade.
  - If everyone inside is taken, the Sin withdraws into its Heart (still unsealed) and the doors open for the next attempt.
- **Capture:** a lunge that lands never kills.
  - **The Scary Capture Screen (1.5s):** the camera snaps into the Amalgam's unhinged, screaming skull; blood-red runes flash across the screen; it shakes violently; a multi-layered, distorted shriek. Then black.
  - The victim wakes locked in the **Underground Iron Cage** in the basement. Wizards broken to 0 HP by a Sin are taken the same way (the Keeper collects what the Sins break).
  - Prisoners can walk the cage and watch through the bars.
  - They can **call for help** with **G**: a marker visible through walls plus a spatial wail.
  - They can **cast through the bars**; projectiles fly between them.
  - A free teammate (human or bot) must reach the cage door and **channel for 3s** (Soham: 1.5s) to break the lock. The door opens for 6s and everyone held is freed. It never slams shut on someone standing in it.
  - **If every wizard is held at the same time, it is Game Over: "The Ritual Consumes You".** The host chooses **Retry**, which restarts the current phase from the Foyer with your progress (Tome and Hearts) kept, or **Return to the coven**.
- Every Heart that dies enrages the Keeper, and it goes to the room to see (it never learns who did it).

### Phase III — The Forbidden Spell & Soul Merge
- When all seven Hearts are silent, the phase becomes **Convergence**. Every wizard must gather at the **Ritual Altar** in the Chapel; anyone held in the cage must be freed first, because the spell needs **every** voice.
- **The Forbidden Spell** is a group channel: each player **holds E** at the altar. A bar at the top fills over **6s** of unbroken chanting by everyone, and drains (0.15/s) whenever any wizard lets go. Gold and violet motes spiral into the altar while the chant rises. Bots walk to their own place around the circle and join in.
- **Soul Merge (3s cinematic):** ribbons of gold and violet spiral out of every wizard into a blinding core over the altar. Then the bodies are gone and **the Archon** stands in their place.
- **The Archon** is one towering body (eye height 3m, speed ×1.25, **500 HP**):
  - **The host drives.** Everyone else rides along inside and aims and casts freely.
  - Everyone's **own four spells and Ultimate stay live** on supercharged cooldowns (`ARCHON_COOLDOWN_SCALE`, ×0.25).
  - **Keys 1–7 select one of the seven Elemental Masteries, and the trigger (Left Mouse) fires it.** They share one set of cooldowns because they belong to one body: ✹ Fire Dragon (25 dmg), ≈ Wind Dragon (shove; it pushes *into* the rift once it's open), ♒ Water Deluge (slow), ▲ Earth Pillars (ring of pillars, root), ☉ White Chains (freeze), ☾ Black Torment (interrupt), ⚔ Anti-Magic Slash (cone; the only thing that breaks a ward).
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
- **Game Over:** all wizards are in the Iron Cage at once. The screen fills with red static, the gate slams, and the Monster's face appears in the bars. Then the lobby returns.
- **The Archon falls** (0 HP in Phase III): Game Over. Retry re-merges the coven at the altar and refights the Unbound Amalgam from full health.

---

## 4. The Seven Wizards: a 35-spell Grimoire

Every wizard has **four spells on the hotbar (1–4)** and an **Ultimate (R)**. The numbers live in `shared/wizards.js` and are the single source of truth for the server, the bots and the HUD.

**Casting (Step 6): select, then fire.**
- **1–4 and R only select** a slot: the hotbar highlights it and the wand tip shows an elemental preview aura (small and wizard-coloured for spells; big, gold and pulsing when a charged Ultimate is selected).
- **Left Mouse** fires whatever is selected. **Q** is an alternate trigger (and lets headless tests without pointer lock fire too; `GameClient.castSelectedSpell()` does the same).
- The server checks cooldown, range, aim cone and line of sight, then broadcasts the cast so every client renders it.
- Projectiles that home in or curve around corners move on the server, and clients follow their snapshot positions.
- With **R** selected, the trigger fires the Ultimate at **100% charge**. A targeted Ultimate with nothing to hit is refused, and the charge is not spent.

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
  - A hit on a wizard **at or below 40 HP drags them to the cage**, and so does the **heavy, telegraphed Lunge** at any HP.
  - The shockwave splash only captures someone it knocks to 0.
  - **Prisoners stabilise at 50 HP.**
- **Recovery:** HP regenerates slowly (1/s) after 8s without damage, **only up to 60**. Above that you need magic: the Patronus, the Tree of Life, Cradle absorbs and Granite skin.
- **No timer:** a session lasts until the coven seals the Hell Portal (victory) or everyone is held at once (game over, Retry keeps your progress).
- **A tougher Keeper:**
  - Hunt speed **4.8 → 5.64 u/s** at seven Hearts (and a **6.4 u/s** charge once it sees you within 10u), and aggression rises with every Heart.
  - **At 2+ Hearts:** the Shadow Tendril.
  - **At 4+ Hearts:** it **smashes Earth barricades in two hits** and conjures **phantom decoys**.

---

## 4c. Unkillable: Hiding, the Disillusionment Charm & the Three-Ultimate Escape

- **The Keeper cannot be killed in Phases I and II.** Spells, dragons, fire and Ultimates do no damage (it shows "nothing harms it while a single Heart still beats"). Combining elements no longer drives it off. Only the finale gives it a body that can be hurt.
- **Heavy footsteps:** its footfalls are loud, deep thuds with scraping claws that carry a long way. Within **22 units** each step trembles the camera slightly and draws a **red ripple** on the minimap where it fell. You hear it coming before it sees you.
- **The Disillusionment Charm (V):** every wizard has it. **12s unseen, 18s cooldown**, with a glassy chameleon shimmer on your hands and wand, a shimmering screen edge and a HUD timer. Teammates see you as a faint glassy outline.
- **The strict rules of sight:**
  1. **Hide before it sees you, then stand still.** Invisible *before* it has locked on to you, and standing completely still while it is near, it walks right past you, even brushing by.
  2. **Moving gives you away.** Moving (or casting) while invisible within **14 units** of it: it senses you, locks on at once and charges.
  3. **Spotted = locked.** About 0.35s in plain view (or any wizard within 3u in its sight) and it **locks on to the first wizard it sees**. It then knows where they are wherever they go, invisible or not, on any floor, and charges at lethal speed. Going invisible after it has seen you does not work (the HUD says so). Its catch is a capture.
  4. **The only escape once spotted: three Ultimates.** Ordinary stuns, roots, freezes, pushes and pulls only stall it for **0.8s** (and shove it at most 2.5u); they never break the lock. Only these break it:
     - **Dawn of the Sacred Order (White):** the mansion fills with golden light and it is frozen solid in chains for **30s**.
     - **Abyssal Mind Fracture (Black):** its mind is locked in place for **10s** while it claws at itself.
     - **Devil Union (Anti-magic):** **30s** of complete immunity for the coven; if it touches an immune wizard it recoils and freezes for **6s**.
     - When one lands, its lock is wiped (and it is blind for 1.5s after it is released). Get out of its sight, cast V, and hold still.
  - A taunt (Bull Thrust) can still redirect a lock onto the wizard who struck it.
- **Bots** hide too: with the Keeper prowling within 18u (and not locked on to them) they cast V and freeze until it has passed. They save Dawn, Mind Fracture and Devil Union to rescue a teammate it is about to catch.

---

## 5. The Seven Hearts

| Heart | Disguise | Its Sin | Tell (once its wards are broken) |
|---|---|---|---|
| The Cursed Mirror | Gilded wall mirror | Pride | Glass blushes red in a heartbeat rhythm |
| The Bleeding Painting | Ancestral portrait | Wrath | Eyes and canvas bleed; the paint pulses |
| The Beating Clock | Grandfather clock | Sloth | Pendulum swings in a *lub-dub*, not a tick; the bob glows |
| The Weeping Doll | Porcelain doll on a side table | Envy | Weeps red; the head **turns to follow you** |
| The Whispering Music Box | Music box on a side table | Lust | The ballerina turns; red light inside the lid |
| The Black Candelabra | Five-candle candelabra | Greed | Burns with black flame that casts no light |
| The Grinning Skull | Skull on a velvet stand | Gluttony | Its jaw chews on nothing; its sockets glow |

- Every disguise has 2–3 identical **decoys** spread across other rooms.
- Each Heart sits in a different room with its three wards: 3–4 Hearts on Floor 1, the rest on Floor 2.
- **Clients never learn which props are Hearts** until a Heart unseals. The server strips heart, decoy and ward-ownership flags from the map it sends, and the Tome sends riddles only.

## 5b. The Seven Deadly Sins

| Sin | Demon | HP | Its kit |
|---|---|---|---|
| Pride | The Mirror Seraph | 150 | Spells cast at its face (within about 60° of where it looks) are **reflected** onto the caster (10 HP). It turns slowly: flank it, or stun it (stunned, it can't reflect). A light lance (0.8s aim, 20 HP) you can sidestep. |
| Greed | The Gilded Hoarder | 140 | Lobs three bursts of **molten gold** (14 HP each, radius 1.8); every splash **steals 25% Ultimate charge**. |
| Lust | The Siren Weaver | 130 | **Hypnotic ribbons** drag everyone in sight up to 4.5u toward it (your view is yanked along); a close caress (16 HP). |
| Envy | The Hollow Mimic | 130 | Whatever element strikes it, it throws back 1.1s later as an expanding **counter-wave** of that element (15 HP); claws. |
| Gluttony | The Maw of Famine | 160 | Spits **acid pools that spread** (to 3u, 9 HP/s). Every 7s it **inhales the room** (pulling everyone within 9u in) and bites (18 HP). |
| Wrath | The Blood Berserker | 150 | Telegraphed **charges** (24 HP, knocks you aside) and cleaves; up to **+140% speed** as it bleeds; slams into walls. |
| Sloth | The Somnolent Dread | 160 | A room-wide **aura of heavy sleep**: −45% speed and draining stamina for everyone inside. A slow, crushing yawn (5u, 22 HP). |

- Every Sin's attacks are telegraphed (windup poses, sound and light) and dodgeable. No crowd control holds a Sin longer than **3s**, and the wind dragon can't carry one out of its arena.

---

## 6. The Monster: the Malphas Amalgam

The last lord's Keeper: too tall for the doorways, gaunt and lopsided (one arm far longer than the other), in a tattered burial shroud. Its ribcage is open, and seven heart-nodes pulse inside it. **One goes dark each time a mansion Heart is destroyed.** Its head is a pale, crooked skull with an unhinged jaw, pinpoint eyes, and hair hanging in curtains.

### Uncanny motion (client)
- **Stop-motion body:** limbs and head are re-posed at a quantised ~13 Hz while its position glides smoothly. It moves like a stop-motion nightmare.
- **Doorway neck-snap:** at doorways it snaps its head 90° sideways and hunches its shoulders to fit through.
- **Convulsions:** when Stunned (White) or Tormented (Black) it twitches its head, jaw and limbs violently. When idle it twitches occasionally.
- **Hunting gait:** pitched forward with arms trailing behind. Peeking: leaning out sideways with a hand on the door frame.
- **Retreating:** claws its way up into the ceiling.

### Senses
- **Sight:** a ~125° cone with line of sight. A wizard is visible at 16u (8u crouched), and **×1.5 with Lumos lit**. Invisible wizards (V, Shadow Step) are unseen. About **0.35s** in plain view **locks it on** (§4c).
- **Sensing the invisible:** an invisible wizard who moves or casts within **14u** is sensed and locked on to at once.
- **Noise:** carries to a radius. Sprinting carries 10u, any spellcast 14u, a decoy heirloom 8u and a ward's seal breaking 12u (both send it to search there). Noise that reaches it from a visible wizard locks on. A **dying Heart is felt anywhere** and sends it to search that room.
- **Being stared at:** a lit wand held on it for **1.5s** (within 14u, inside about 15°) makes it **duck out of sight** (55%) or **charge** (45%), if it hasn't already seen you.

### States (server, `server/Monster.js`)
| State | Behaviour |
|---|---|
| **Dormant** (before the Tome) | Not in the world. Every 35–75s (first time at 20–40s) it **haunts** a wizard: a silhouette 14–24u away at a corner or doorway, in view but out of the light. Its eyes glint through the fog. When a wand beam lands on it, it lingers about 0.3s (a lit glimpse) and then vanishes. It also fades on its own after 6s. It cannot be targeted. |
| **Stalking** | Prowls toward the wizards (it smells where they are, even unseen), picking spots 12–22u away, preferring tiles no one can see, out of wand light, at doorways and corners. **Peeks** for 1.5–3s at those spots. It locks on to the first wizard it sees (§4c). |
| **Hunting (locked on)** | It always knows where its target is (invisible, out of sight, on any floor) and runs them down at **4.8 u/s + 0.12 per destroyed Heart** (5.64 at seven), **charging at 6.4 u/s** once it sees them within 10u. Close in, its catch is the **Lunge** (a capture; the **Grab** at ≤ 40 HP), with a **Dark Shockwave** against crowds. From 2+ Hearts it adds the **Shadow Tendril** at 3–7u (20 HP). From 4+ it **smashes barricades**. Void shields make it rebound; Devil Union makes it recoil and freeze. The lock ends only with a capture, one of the three Ultimates, or a Sin's blood-runes. |
| **Searching** | Goes to the place it was sent (a decoy, a broken Heart), **listens** for 2.5s, sweeps up to 3 nearby rooms, then returns to Stalking after 16s. |
| **Retreating** | After a capture: flees and climbs into the ceiling (1s), then stays hidden **12–18s** and reappears out of sight. Nothing else drives it off. |
| **Guarding** | While anyone is caged, stalking goals favour the basement (65% from upstairs, 85% once down there). It prowls near the stair and Crypt but **never within 6u of the gate**, and still ventures upstairs to stalk. |

---

## 7. Horror presentation

### Visual
- `FogExp2` black fog and a near-zero hemisphere fill. The wand spotlight is about 25° with soft edges and casts shadows from a hand offset, so shadows swing as you move.
- **Post-processing** (`client/js/fx/PostFX.js`):
  - film grain;
  - a vignette that tightens as the Amalgam nears or stamina runs low;
  - chromatic aberration on Black casts, lunges and the capture screen;
  - a lens warp and wider FOV from **terror**;
  - desaturation while caged;
  - a red flash and fade to black on capture.
- **Lights Out:** within 15u of the Amalgam, wand lights and candles gutter and drop out. While it hunts nearby, your wand **cuts out for 0.3s** at random, causing panic flashes.
- **Terror:** looking straight at it within 12u (with line of sight) builds terror, which warps the FOV and thickens the grain until you look away.
- **Step 6 materials (all procedural, no image files):** every surface is a `MeshStandardMaterial` with a canvas-painted albedo plus a **normal map** computed (Sobel) from a painted height map, and a **roughness map** where the finish varies:
  - **polished black-and-white checkered marble** (Foyer, Balcony Gallery, Grand Ballroom, Banquet Hall, Observatory) with scuffed dull patches;
  - oak parquet with worn varnish paths; **velvet** corridor runners with a gold border; damp flagstones (chapel, armory, kitchens, basement);
  - damask wallpaper (crimson, rose, or green by room) above **carved-oak wainscoting** with raised panels and rosettes; **Gothic stone** in the chapel, armory and basement;
  - **Gothic pointed stone arches** over every single-width doorway; coffered plaster ceilings;
  - **framed moving paintings** (the ancestors breathe and sway, very slightly);
  - **stained-glass moonlight windows** with **volumetric light cones** sloping into the room (they drift as clouds pass);
  - ornate two-tier **chandeliers** and **flickering wall sconces** with glowing halos (no extra real lights, so frame rate stays high);
  - teammates' **Lumos beams are visible** as soft cones, and dust motes drift in your own;
  - the **Underground Iron Cage**: iron bars all round the prison room.
- **Wizard avatars:** layered robes (a dark open cloak with a lining and a trim in the wizard's colour, a **house crest** with their element's sigil on the breast, a gold belt), a striped house **scarf** whose tails swing, a **pointed hat** with a crooked tip (Injorath and Himanshu wear deep hoods), articulated arms with the wand arm following their aim, a **carved wand** with gold rings and a glowing core, boots that step under the hem, **cloth sway** as they walk, real shadows from the wand lights plus a soft contact shadow. In first person you see your robed sleeve, cuff, hand and carved wand.
- **The Seven Sins** each have their own procedural model and animation (§5b): the Mirror Seraph's mirror-shard wings and halo, the Hoarder's gold body and coins, the Weaver's never-still ribbons, the Mimic's cracked porcelain that takes on the colour of the last element that hit it, the Maw's ring of fangs, the Berserker's glowing veins and blades, the Dread's sleeping shroud and chains.
- **The minimap (top-left):** a Marauder's-Map plan in ink on parchment (§8).

### Audio (Web Audio API, fully procedural: `client/js/audio/AudioEngine.js`)
- **Ambience:** detuned low oscillators, filtered draughts, and a generated stone-house reverb.
- **Proximity:**
  - a **40–60 Hz sub-bass thrum** and a muffled **heartbeat (58→168 bpm)** that grow as the Amalgam closes from 18u to 3u;
  - the heartbeat never drops below a racing pulse while you are being hunted.
- **Spatial Amalgam cues (HRTF):** **heavy** footfalls that carry a long way: a deep distorted thud with a sub tail, a wet slap, a bone click, the creak of the boards under it, and scraping claws.
- **Hallucinations** while it stalks within 26u:
  - formant-shifting **whispers** just behind your left or right ear;
  - **three rapid ceiling knocks** overhead.
- **Black Magic shriek:** an FM sawtooth screech, a dissonant square with vibrato, and bandpass-swept noise, distorted and fed into a long reverb tail. It also plays on awakening and (lower) on banishment.
- **One-shots:**
  - a distinct sound for each of the seven spells, plus fireball impacts;
  - the gate clank and lock-grinding;
  - the **Tome awakening gong** and the hunt stinger;
  - the capture screen's **multi-layered shriek** (three detuned screams, a crushed scrape, a sub-bass drop and a heartbeat that stops), Heart destruction, and ping calls;
  - Step 6: each room ward (brazier whoomph, mirror grind, clockwork, coin), the arena slam, each Sin's windups and strikes, the glassy Disillusionment shimmer, the chord when a lock is broken, and a click (or hum, for the Ultimate) when you select a slot;
  - your own footsteps on wood and stone.
- **Heart tells:** once their wards are broken, undestroyed Hearts beat faintly within 7u.

## 8. The Mansion

Three levels (1 tile = 2 m): **Floor 1** (ground, 60 × 60 tiles), **Floor 2** (the upper story, 60 × 60, its floor 0.6u above Floor 1's ceiling) and the **Basement** (34 × 26).

### Floor 1 (ground)
- Rooms come from BSP leaves (min leaf 10 tiles), joined by 1- or 2-tile corridors with **3 extra loop corridors** so chases rarely dead-end.
- **Fixed rooms:** the **Grand Foyer** (the southernmost big room and the spawn), the **Chapel of the Altar** (farthest by walking distance, the Phase III arena), the **Library** (midway, with the Tome), the **Banquet Hall** (the largest room left), the **Armory Hall**, the **Nursery**, the **Servants' Stairwell** (about 70% out, stairs down to the Basement) and the **West Stair Hall** (far from the Foyer, the family stair up).
- Other rooms by size: Conservatory, Music Room, Drawing Room, Parlor, Billiard Room, Trophy Room, Kitchen, Gun Room, Servants' Quarters, Washroom, Smoking Room, Pantry, Cloakroom.
- **Grand Dual Staircases:** two oak-and-iron **spiral staircases** stand against the Foyer's back wall, rising through the ceiling to the Balcony Gallery.

### Floor 2 (upper story)
- Its own BSP layout (min leaf 12) around the **Balcony Gallery**, joined by a minimum spanning tree plus **4 extra loops** (so there are no unfair dead ends).
- **The Balcony Gallery** rings an **open void directly over the Foyer**, with a balustrade along its edge. From the Foyer you look up into a double-height hall with the gallery's chandelier hanging into it; from the balcony you look down. The void blocks movement but not sight.
- **Fixed rooms:** Balcony Gallery, **Grand Ballroom** (the largest), **Master Study**, **Rose Bedroom**, **Observatory**, **Alchemy Wing**, and the **Upper Stair Landing**. Others: Master Bedroom, Portrait Hall, Reading Room, Guest Bedroom, Sewing Room, Marble Bath, Map Room, Linen Room, Clock Room, Dressing Room, Card Room.
- **Two ways up:** the dual staircases (Foyer ↔ Balcony Gallery) and the family stair (West Stair Hall ↔ Upper Stair Landing). Each pair shares one tile column, so the spiral really rises through the ceiling: a hole in Floor 1's ceiling, a balustraded stairwell in Floor 2's floor.

### Basement (authored template)
- Cellar Antechamber (the servants' stair up), Family Crypt, Wine Cellar, Ossuary.
- The **Underground Cage Prison** is reachable only through a 1-tile passage closed by an **iron cage door** with a glowing ritual lock.

### The minimap (top-left)
- A **Marauder's-Map-style** plan inked on aged parchment, for the floor you're on: walls, corridors, the hatched void, every room's name in a cramped italic hand, spiral-stair glyphs with ▲/▼, a gold arrow for you and coloured arrows for your coven (✕ over anyone caged), floor tabs (II · I · B), and the floor's name.
- **Sealed Sin arenas** are cross-hatched in blood and marked "ᛉ SEALED ᛉ".
- **Red acoustic ripples** bloom wherever the Keeper's footsteps fall within 22u.
- **M** (debug) still opens the full debug map, now with floor tabs: look at any floor and click to teleport there.

### Guarantees (enforced by the generator and by tests on 60 seeds)
- Every floor is fully connected; furniture never cuts it in two and doorways are never blocked.
- Every interactable and every room is reachable on foot from the spawn, using the stairs.
- Every void tile hangs over the Foyer's floor; the dual staircases rise to the gallery through their own tile column.
- Seven Hearts on Floors 1 and 2, in seven different rooms, each with three ward props of one kind in the same room.
- The cage can only be left through its door.

---

## 9. Controls

| Input | Action |
|---|---|
| Mouse | Look (pointer lock; click to capture, Esc to release) |
| W A S D / arrows | Move |
| Shift | Sprint: loud, uses stamina (drains in about 4s, recovers in about 7s) |
| C (toggle) / Ctrl (hold) | Crouch: slow and quiet |
| 1 – 4 | **Select** spell 1–4 (no cast; the wand tip previews it) |
| R | **Select** the Ultimate |
| Left Mouse | **Cast** the selected slot |
| Q | Cast the selected slot (alternate trigger) |
| V | Disillusionment Charm: 12s unseen, 18s cooldown |
| E (hold) | Interact: read, break a ward, open a Heart, use stairs, break the cage lock, eat from the Tree of Life |
| F | Lumos / Nox: a bright, wide torch, but you're seen 50% further away (and it reveals ward runes) |
| J | Journal (the Tome's text and riddles) |
| G | Call for help: ping your location to the coven |
| E (hold, Convergence) | Chant the Forbidden Spell at the altar (everyone at once) |
| 1–7 then Left Mouse (Archon) | Select an Elemental Mastery, then fire it (shared cooldowns) |
| E / R (hold, Hell Portal) | Soul Grapple: drag the Amalgam into the rift |
| M (debug) | Top-down debug map with floor tabs. Click to teleport. |
| P (debug) | Cycle the monster: Husk → Haunt → Stalk → Hunt → Capture test → Auto |
| K (debug) | Capture yourself instantly; if you're already held, break the lock |
| L (debug) | Break open the nearest sealed Heart (wards done for you), pull the coven into its room and start the Sin's lockdown; inside a live arena, slay the Sin |
| Shift + 1–7 (debug) | Hot-swap your wizard (whoever held it gets yours) |
| U (debug) | Fill your Ultimate charge |
| H (debug) | Skip to Convergence: Tome read, all seven Hearts destroyed, prisoners freed to the altar |
| N (debug) | During the boss fight: drop the Unbound Amalgam to 25% with its wards spent, just above the Hell Portal |

---

## 10. Debug & testing affordances
- **Solo test** button: creates a coven with solo debug enabled and two bot teammates.
- **Bots use the whole grimoire:** each spell's `bot` hint (target, ally, self, escape, zone, heal) decides when it fits. They fire Ultimates at 100% against the real Amalgam (or to heal), and eat Tree of Life fruit when hurt.
- **Bots** rescue first: when anyone is held, they run to the cage (taking the right stairs on any floor) and break the lock. Spells only stagger the Keeper, so they cast at it only when it threatens someone (hunting, or within 8u); the Sins and the husk come first. A bot's name follows its wizard when swapped.
- **Bots in Step 6:** they hide with the Disillusionment Charm when the Keeper prowls close, saving the three lock-breaking Ultimates for a teammate it is about to catch, and fight a Sin with everything (other Ultimates included) when locked in its arena.
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
| 6 (v2.0) | Select-then-fire input; 2-story mansion + basement (Balcony Gallery over the Foyer, dual spiral staircases, family stair); top-left Marauder's-Map minimap with footstep ripples; PBR-style procedural materials, Gothic arches, stained-glass moonbeams, moving paintings, sconces, chandeliers; robed Harry-Potter-style wizard avatars; 7 Hearts with 3-part room wards; the Seven Deadly Sins in locked arenas; the unkillable Keeper with sight-lock, heavy footsteps, the Disillusionment Charm (V) and the three-Ultimate escape; the 1.5s Scary Capture Screen and the Underground Iron Cage | ✅ Done |
