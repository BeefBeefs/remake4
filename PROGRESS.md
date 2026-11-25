# Progress notes

## Session 1
Done
- Extracted the 7z (own stdlib reader) and the ISO; decoded GOS, MAP, TIL, SF5/6, EVT (see docs/FORMATS.md).
- `tools/build_assets.py` converts the disc into `public/assets` (tiles, maps, hero + a few enemy sprite atlases,
  pictures, sfx, music as ogg, intro videos as mp4). Original disc data is not committed; converted assets are (while the repo is public).
- Script engine: parser + interpreter + tests (every script block runs without errors).
- three.js renderer: 640x480 orthographic, chunked tile meshes, sprite atlas actors, pixelated scaling.
- Playable test scene: pick any of the 42 maps (hash `#t1`), walk (WASD / arrows / click), attack (space / right click),
  3 heroes follow-the-leader (keys 1-3), talk to the scripted NPCs of the current map from a dropdown (dialogue box,
  choices), WARP effects change map, music toggle.

Known gaps / next
- Terrain looks patchy: colour-key transition tiles have nothing underneath, a few marker pieces still show. Need the
  original ground fill rule and MAP trailer meaning.
- NPC/enemy placement, enemies/combat, items/shops/inventory UI, world map and cutscene playback.
- Direction flip, animation timing and walk speed are guesses; collision is inferred from marker tiles.
- Only the hero/enemy sprites listed in `DEFAULT_SPRITES` are converted (`--sprites all` for the rest).
- Music per map is a placeholder.
- `npm run build` has not been run locally (npm was blocked in the authoring sandbox); the renderer was bundled
  against three r170 with esbuild and tested in headless Chrome. CI is the first real vite build.

Dev
- `npm install && npm run dev`; `npm test`.
- Rebuild assets: `python3 tools/build_assets.py --disc <Akuma folder> --bin <AKUMA.bin>` (needs numpy, Pillow, ffmpeg).

## Session 1b
- Object layer decoded: values >= 10000 are tile + 10000 (an "overhead" flag); the port now draws objects (houses,
  walls, wagons) and flagged cells above the characters. Black colour-key pieces in the ground layer are left black
  (they look like cliff / void edges).
- Marker detection widened (two-tone marker tiles): ~470 per tileset.
- Next: y-sorting characters behind objects, where NPCs/enemies stand (trailer?), spawn points from WARP targets.

## Session 1c
- All 42 enemy/monster sheets converted (`public/assets/sprites`, ~36 MB of sprites in total).
- Enemies: placeholder AI (notice, chase, swing), hero attack damages enemies in range, 3 hits kill. Spawn from the
  "Spawn enemy..." menu (gallery of all sheets) or from LOCATE_ENEMY when a script runs.
- Entry points: maps open at the most common script WARP destination, snapped to open ground. 2 of 22 warp targets
  sit on a marker tile, so marker collision is not exact; characters standing in a blocked cell can walk out.
- Side-facing default is now "stored dir 2 faces left" (true for every sheet).
- Overhead flag makes y-sorting against buildings unnecessary (roofs above, walls below).
Open: kind -> sheet mapping, enemy stats/AI, hero HP and damage, trailer tables, NEW_OBJECT / LOCATE_ITEM, items.

## Session 1d
- Found the English string table (IMG/LANG.GOS): monster, item, weapon, magic and map names; kind -> sheet mapping is now
  mostly verified; item / equipment id numbering decoded. `public/assets/text/lang.json`.
- Combat v0: hero HP, hurt / death animations (action 11 / 21), enemy swings hurt the nearest hero, party HUD, leader
  hand-over when one falls, "party has fallen" then respawn. Damage / HP numbers are placeholders (scaled from the
  script's power value) - the real stat tables have not been found.
- Items: one id space (equipment 1-142, consumables 151-196, quest items 200-254) resolved through LANG.GOS; ground items
  (LOCATE_ITEM, enemy drops, coins), walk-over pickup, inventory panel (key I) with "Use" for healing items, shop lists show
  real names. Money amounts, drop rates and which ITEM.GOS record is drawn for which item are guesses. Prices are not found yet,
  so shops cannot sell.
- Title picture (click to begin; also unlocks audio), world-map screen (key M, WORLD1 / WORLD2 pictures with a button per
  place - the original's clickable hotspots are not decoded), movie player for the four intro videos, music per map family
  (placeholder: which CD track belongs to which map is unknown).

## Session 1e
- The MAP trailer is the per-map object table (positions, class, kind). NPCs are placed from it (script object ids are
  indices), drawn from SPRITE.GOS and talkable with E / Enter or a tap next to them ("[E / tap] talk to ...").
- Props (SPRITE.GOS barrels, chests, statues) and animated scenery (BACK.GOS grass, fountains, trees) are placed from the
  table; monsters wake up when the party comes within ~340px (cap 40 alive), kind = LANG.GOS monster id.
- Converted BACK, ARMS, MENUICON, ICON1 banks (not used yet; ARMS looks like weapon / armour overlay frames).
- NPC sprite choice and trailer class meanings are heuristics.

## Session 1f
- Prices and stats found in the bundled HTML manual (MANUAL/WEAPONL.HTM): `itemstats.json` (158 items). Shops now sell and
  buy (sell price = half, a guess): list with attack / defense / special text, greyed when you lack the money.
- GO_BASIC_EVENT implemented (falls back to the NPC's BASIC shop block; village-specific variants are a guess).
- Still missing: ring prices, spell learning cost, repairs, equipping items (bought gear just sits in the bag).

## Session 1g
- Equipment: items equip per hero from the inventory (slot by LANG.GOS category; bows share the weapon slot), gear
  bonuses parsed from the item text, attack / defense / speed / max life derived (`src/game/stats.ts`, placeholder formulas).
- Experience: kills give xp, party-wide level-ups raise stats (placeholder curve and gains), heal the party, HUD shows Lv / xp.
- Trailer monsters no longer spawn in villages (T1 lists a Satan there: class 1-47 entries mean something else in towns).

## Session 1h
- Touch controls: on-screen attack / cast / next-spell buttons (bottom left); tap an enemy to walk up and attack it (bows
  shoot from range). Keys: F cast, Q next spell.
- Magic v0 with mana bars: Fire Wall, Fire Ball, Ghost Bolt, Death Spark, Lightning, Blood Fire, Healing, Resurrection
  (MGC-EFF.GOS art; costs from the manual; damage formulas are placeholders). Kusa's two starting spells are in from the
  start; magic trainers (LEARN_MAGIC) teach spells for free because no price is known. Ice Rain / Fire Rain / Stone Curse /
  Buddha Shield are not playable yet.
- Bows fire ARROW.GOS arrows (32 angle frames) with the bow's range from the manual; effects live in `src/game/effects.ts`.

## Session 1i
- Monster table found in the EXE (hp / attack / defense / speed for 59 monsters, `monsters.json`): enemies now use it
  (hp x0.25 and attack x0.4 so early fights stay short - placeholder factors), defense softens hero hits, xp from the stats.
- Music: the EXE shuffles CD tracks 7+ regardless of the map, so the game now shuffles track08-15 (no per-map music exists).
- World map: markers sit at the EXE's positions (map index carries wx / wy / world); real world vs underworld tab by order.
- Z / X / C select Elim / Kusa / Raening (manual hot keys).

## Session 1j
- Save / load (`src/game/save.ts`): story flags, items, quest log, money, level/xp, stats, spells, each hero's life/mana/gear,
  leader, map and position go to localStorage (`akuma.save.v1`) every 5 s, when the tab is hidden and on every map change.
  The title offers Continue / New game when a save exists. A `#map` or `?map=` link is a debug jump: it neither loads nor
  writes the save (and only those links get the `#map` hash written back). Enemies and ground items are not saved
  (the map reloads fresh). Original save format is not decoded (not needed).

## Session 1k
- Spells 7-11 playable: Stone Curse (freezes enemies within 220px, stone shell art MGC-EFF 34), Buddha Shield (party
  invulnerable ~10s, glow 33 follows each hero), Ice Rain (MGC-EFF 12) and Fire Rain (MGC-EFF 27) as 7 damaging patches
  ahead of the caster. Durations / damage are placeholders. Seal magic (184) is a story item, not castable.

## Session 1l
- Script effects now live: FULL_LIFE / FULL_MANA (inns, the Teleport Fountain's holy water: revives and restores the party),
  REMOVE_OBJECT (`THIS`, `CURMAP n`, `map n`; remembered in `story.removed`, saved), CHANGE_GOS n (the speaking object
  becomes SPRITE.GOS record n; remembered in `story.gos`, saved).
- CHANGE n: the EVT block header is `id map object name kind extra`; an object with several blocks (quest stages) answers
  with the entry whose id is n after `CHANGE n`, `CHANGE 0` returns to the first (`story.entry`, saved, `pickBlock`).
- NEW_OBJECT map x y object sprite extra: the script object (Ompherjo, Patewoos, the God Stone, Shining...) appears at that cell as
  SPRITE.GOS record `sprite`; until then it is not on the map (`story.placed`, saved). Checked: every target has an EVT block,
  and the sprite numbers fit the names (Shining 59, Ompherjo 15/16). Object 20 of c1 (Hellminor) uses sprite 70 = none (a boss; not spawned).
- UNSEAL n opens overworld place n (map numbers 1-22 = a1-a14, t1-t4, c1, c2, d8, d9). The places sam.evt unseals (2 3 6 8 9 10 12 13 14 22)
  start sealed (locked markers on the world map, `story.sealed`, saved); villages and everything else start open. Shop keepers
  and quest givers unseal neighbours one by one (t1's shopkeeper -> Shadow Mountain, its item merchant -> Dinyc, t4's White Lady ->
  Echo Valley + Dragon Valley). The gear button's debug tools show every place. The original's real start set is a guess.
- Still not done: STONE map amount.
- EVT files carry Korean design notes (cp949 comments after the scripts) that explain the quests; worth mining.

## Session 1m
- Rendering fix: grey / purple editor marker colours were still visible in the caves (c1 showed a checkerboard). Marker
  detection is now tolerant of the other shades, blue / red / green editor tiles are hidden, and marker-coloured bands
  inside art tiles are transparent (tiles re-exported).

- Open question: class-0 trailer objects with facing 5 and kind 5-12 (hundreds, even in caves) are drawn as SPRITE records
  5-12 (crates, barrels, and the 11-frame figures 9-12); they may really be an editor "random filler" with other art.

## Session 1n
- Quest log (`src/ui/quests.ts`, J or the Quests button): active ORDERs with their hint lines; toasts announce new / finished quests.

- HUD: map / NPC / spawn / marker / movie pickers moved behind the gear button (shown by default for #map debug links).

- Help overlay (? button), favicon stub; smoke test enters all 42 maps without page errors (tools: see /home/claude/work/web/smoke.mjs, not in repo).
- Not implemented: STONE map amount (the Magician at Veddyn turns the party to stone for a while; amount shrinks with level).

- Monster sprites: the first byte of every monster-table record is its sprite sheet index, so the story monsters (30-47) no longer
  use guessed sheets (`sheetForKind(kind, table)`); the byte agrees with every kind that had been verified by eye.

- LOCATE_ENEMY's last argument is an item id *or an event id*: Hellminor (drop 34) runs the unnamed entry 34 of its map when it dies
  ("Arghh, you defeated me... follow my spirit to the underworld"). Rule used: a drop below 150 that matches an unnamed entry of the
  current map runs that entry instead of dropping an item (only Hellminor matches in the shipped scripts).

- GO_END1 (end of event 34, the hellgate) now moves to the underworld's first place (b1 Death Rock - a guess); GO_END2 (Satan's riddle,
  the last script) shows "The End". The chain Satan -> hellgate -> underworld can be played start to finish in principle; untested as a whole.

## Next ideas
- Per-hero growth / real stat formulas; monster bytes b2 b4-b7; hero base stats / level / experience, magic (12 spells with names known), real enemy stats.
- NEW_OBJECT, BASIC event triggers (GO_BASIC_EVENT), save / load.
- Real collision rules, trailer class meanings. Remaining spells; per-hero stat growth.

## Session 1o – first-quest playtest
- Playtested Western Village (T1) NPCs headless: Village Chief, Item Merchant and Shopkeeper chains run; quest unseals fire.
- Found: `Shopkeeper#103` "Yes! I can do it for you" answer has a label-less `GO_DOWN` in the original data -> now falls back to `OK1` (quest accept). Test added.
- Found: under.evt numbers maps from the first underworld place (1 = b1), sam.evt from the overworld. Added `shiftMapNumbers` (+22) so under.evt blocks, WARP, LOCATE_*, NEW_OBJECT, REMOVE_OBJECT, UNSEAL and inline IF/CASE actions all use the unified map list. Underworld villages (t5/t6) and Satan's castle (c4) now get their NPCs. Confirms b1 as the GO_END1 target (under.evt map 1 = Knight Devil).
- Underworld UNSEALs are now part of the initial seal set (villages stay open).
- Still open: STONE, sprite-70 bosses, class-0 crowd objects, real combat formulas.

## Session 1p – quest turn-in
- Re-ran the T1 NPC walk with a loop-avoiding harness: all 7 NPCs run to the end with no script warnings. Shopkeeper scales quest verified end to end (accept -> UNSEAL 13 -> hand in item 209 -> Flygon dagger, order cleared).
- `CHANGE 0` is used 54x, mostly right after a quest finishes. It now stores entry -1 = the object's plain BASIC entry (shop / chat) instead of the first FLOW entry, so finished quests are not offered again. Falls back to the default entry when the object has no BASIC block. Old saves are unaffected (entry 0 was never stored).

## Session 1q – whole-game NPC walk
- Added `walkmap.mjs` (outside the repo): runs every NPC block on a map with loop-avoiding choices, advancing by clicking the dialogue (a trailing Enter after the dialogue closes re-triggered talk-to-nearest and looked like a stall). All 42 maps walked: no stalls, no errors.
- Fixed `GO_ DOWN` typo (Jeweler#76 in the underworld village) in the parser.
- Story audit (items/flags required by scripts vs. provided): every required item has a source. NUM 1/2/3 are "hero 1/2/3 in party" (Witch: "Kusa or me") and nothing grants them; the engine now sets them. Still unprovided: NUM 34 (Blacksmith#11 needs 33 && 34; probably set by the boss death event 34), NUM 64 and 49 (cleanup only).
- `STONE CURMAP n` implemented: every enemy on the map freezes for n frames (script notes say 300/500/700; assumed ~20 frames/s) with the stone-shell effect. Verified in a browser on d6 (8/8 frozen). Note: the d6 statues all share object id 5 with ~24 entries (blocks 151-181, one puzzle each); how the original told the statues apart is unknown, so we show the first entry unless a script `CHANGE n` picked another.

## Session 1r – dungeon statues and tables ("instant events")
- under.evt ends with a section titled "instant events" (blocks 151-181, header map 17 / object 5): stone statues (STONE for 300/500/700 frames, +1 brain/dexterity/strength/health/magic) and tables (one item each: 195, 168, 178-181, 176, 177, 196, 167). Under the +22 shift these were being attached to object index 5 of d6 as a bogus "Stone statue" NPC.
- They are now a shared pool (`src/game/instant.ts`): touching a dungeon statue sprite (SPRITE kind 26/28) or table sprite (kind 43) runs one random event of its kind, then the sprite is used up (saved in `removed`). Works by Enter near it or by tapping it. Blocks tied to one map (REMOVE_OBJECT / WARP / CHANGE_GOS / UNSEAL puzzle statues, blocks 151, 170-172, 180, 181) stay out of the pool.
- Guess: the original probably assigned a fixed event per sprite; the data we found does not say which. Browser check on d6: 16 statues, touching 4 froze demons twice, +1 dexterity, +1 strength.
- Kinds 45/46/47/49/53/57 on the dungeon maps are editor-marker rectangles (grey/purple), 23 = stairs, 61 = gate; not handled yet. Monster `extra` 151-181/201 values may be warp/event drops (180/181 = WARP blocks "warp space"); today drops >= 150 are treated as items.

## Session 1s – manual cross-check
- Read the disc manual (`docs/QUESTS.md`): confirms village names, the three requirements for the underworld, the quest list, and that heroes can revive each other (not implemented yet).
- Mantis Trainer needs level >= 16 and Strength >= 60; placeholder growth gave Strength 40 at level 16, so STRENGTH per level is now 4 (70 at 16). Test added.
- Looked at the d6 white patches: six bone-floor tiles in the source art, left alone.
- Companion revive from the manual: a living hero standing within ~44px of a fallen one for 2 s revives them at 30% life (unless the whole party is down). Browser-tested.
- Script warning audit (all blocks x 4 choice walks, now a test): only CANCEL_MAGIC (witch "give up training", now a no-op because spells are learnt instantly) and two declines that jump to labels missing from the original data (BlueMoon#17 `청아2`, Witch fortune `마법소명령`); a missing label ends the talk, which is the sensible outcome.

## Session 1t – "some sprites or textures are broken" (phone screen recording of the Western Village)
Reproduced from the video (T1 around cell 30,42) and fixed three things:
- **Black squares in the ground.** Ground cells whose tile is an invisible collision marker (and have no object art on top) were holes; 1 in ~20 cells in T1. `World.groundFill` now draws the nearest visible floor tile under them, and under art tiles that had editor marker colours punched out (`punched` list added to tilesets.json by the asset builder; the PNGs are byte-identical). Black *colour-key* pixels are left alone: the original manual screenshots show real black voids at cliff edges.
- **Flickering crates / barrels.** SPRITE records 5-8 (crate, chest, barrel, jar) are loot containers: intact frame first, break frames after. Props cycled through every frame, so they flashed between whole and smashed. They now stay on frame 0 until a melee swing breaks them (within ~56px, break animation, ~55% chance of money, gone for good via `story.removed`). `src/game/breakables.ts`.
- **A crowd of ~40 identical orange blacksmiths.** Records 9-12 are the scripted NPCs' idle figure models; ~740 unscripted copies sit in dense clumps over all maps, so they are editor filler and are no longer drawn (`isEditorFiller`). Scripted NPCs are unaffected. Hypothesis, not proven: if some of them turn out to be real ambience NPCs, loosen the rule in `src/data/mapobjects.ts`.
- Not changed: ground texture looks patchier than the original screenshots (stone strips and grass islands); the tile-assembly of the ground layer may still be off. Leftover black wedges where ground art has black colour key (roof edges at the village's south-west).
- Follow-up from the same video review: sprite records 45-50 and 52-57 are plain editor-marker rectangles (grey 8b898b / purple 83507b) and were drawn as props in the dungeons; they are hidden now (`isMarkerSprite`). Tiles with full-width pure-black bands (4+ rows, editor painting, not diagonal cliff edges) join the `punched` list (now 1315 / 982 / 735 tiles per tileset), and `groundFill` prefers a whole tile as the floor so a fill is never itself holed. D1 and A4 checked in the browser: the black bars and patches are gone; a few near-black blocks remain as shadow.

## Session 1u – heroes
- Sprite-70 `NEW_OBJECT` (Hellminor's unsealing): it is only a temporary speaker; the script removes it and spawns the real boss with LOCATE_ENEMY, so "no sprite" is correct. Closed.
- Per-hero traits (`HERO_TRAITS`, placeholders in the direction the manual gives): Elim +20% life, +6% speed, weak at spells; Kusa 1.7x mana, +30% spell power, frail; Raening +25% bow damage. `derive` takes an optional trait.
- New game now gives each hero their one starting weapon (manual): copper sword, dagger, wooden bow. Existing saves keep their gear.
- Consumables: `src/game/consumables.ts` reads LANG descriptions into effects (life/mana %, permanent stats, All attributes, rich scroll +500 money as placeholder, invincible scroll 20 s placeholder, spell books 185-196 learn spell). Inventory "Use" applies them; unused when nothing would change. Still not done: Teleport Gate jewel, Holy Eye, Seal Magic, Ice/Fire Ball items, passive items (Hawk Wings etc.) are just equipment-like descriptions with no effect.
- Items 151-160 (shop goods, 400-1300 gold): timed 60 s party buffs (guess for the duration): Angel's Touch/Shield damage taken x0.5/x0.2, Beast/Dragon nail damage dealt x2/x3, Hawk/Eagle wings, Skill Gem. Dragon Heart = +20 Health. Ice/Fire Ball items cast Ice Rain / Fire Ball free. Soul Scroll kills non-boss monsters within range in the underworld. Not implemented: Darkness Echo/Distant Viewer (no darkness/sight in the port), Gate Jewel, Holy Eye, Seal Magic (nothing in the scripts checks for them; only table events hand them out).
- Endings: GO_END1 shows end1.webp (red eyes in the dark) before the underworld; GO_END2 shows end2.webp (heroes on the cliff) then staff.webp with "THE END" and reloads to the title (caption texts are mine; the original's ending flow is unknown). `showSlides` in ui/overlays.ts.
- Story audit (script flags/items needed vs given, incl. monster drops and LOCATE_*): everything required is obtainable. Never-given leftovers are optional branches only: NUM 49/64 (redirect checks), item 220 Shadow Sword (optional dialogue with Raegios), 253 Pendant (Blacksmith lore). Heaven Bow (54) comes from the Hook demon's drop (LOCATE_ENEMY drop 54 = item since block 54 is not on that map).
- **Game clock** (new, from the manual's "after N years" quest list): `story.year` (saved; old saves start at 123 so nothing is locked), ticks 1 year / 90 s outside dialogue, shown in the status line. Script entries unlock by their year (last header number); `pickBlock`/`basicBlockFor` take the year; `CHANGE 0` is stored as minus the finished entry's year. This was a real blocker: White Lady's year-120 entry (rescue Shining -> Pass Sword) could never be reached before.
- NUM 101-111 are "quest in progress" flags used by both scripts (Blacksmith dragon scales in sam.evt, Intermediary tasks in under.evt); the shared ones are cleared on entering the underworld (`SHARED_QUEST_FLAGS`).
- `tests/story.test.ts`: a greedy bot talks to every object repeatedly (letting the clock run 100-125, overworld first, then underworld) and must reach GO_END1 and GO_END2. It handed over monster drops for free, so it proves the scripts chain, not that fights are winnable.
- Menu (Esc / "Menu" button): five save slots showing year, level and place, music and sound-effect toggles, exit to title. Defeat now shows the original text ("Exhausted my body and soul...") and wakes the party in the last village visited. Gate Jewel (176) opens the Teleport Gate list "Road to <village>" for the current world (strings 9, 10, 17, 18 of LANG; my reading of them). A "Year N" toast shows as the clock ticks.
- The disc manual's `SCREEN~1.JPG` / `SCREEN~3.JPG` are real in-game screenshots (640x480): they show the original HUD - hotkey bar 1-0 (items / spells), a "Year" panel with a sun/moon slider (day/night?) at 107-108 when the party is level 2-3, a minimap with the screen as a white frame, three portraits with life/mana bars. Added a minimap (`ui/minimap.ts`). Still to port: the 1-0 quick slots, the day/night slider (unknown meaning), portraits.
- Open question: villages' ground looks like a mosaic of grass / rock / dirt pairs (the map data really mixes tiles 67/87/107 pairs); the screenshots only show caves and a volcano, which look uniform, so no reference for villages.
- HUD pieces from the original screenshots: quick slots (keys 4-9, 0; known spells first, then usable potions/scrolls/buffs; the original uses 1-0 but 1-3 pick the leader here), a Year panel whose orb shows how far through the year the clock is (my reading of the slider), minimap. `applyItemEffect` in main.ts is shared by the inventory and the quick slots.
- Dialogue portraits: ICON1.GOS record 24 frame n is the picture for `FACE n` (0 Elim, 1 Raening, 2 Kusa, 3 chief/intermediary ... 14 Satan, 20 Hellminor); `FACE HERO` shows the party leader and names them. ICON1 also holds the original HUD art (location labels, hotkey bar digits, "OVER GAME", orbs) and MENUICON the title/menu button art - not used yet.
- HUD: each party row now has the hero's ICON1 portrait (36 px, greyed when down); the party panel sits above the status line.
- Ground check against manual screenshots (SCREEN~1 Wailing Cave, SCREEN~3 Volcano Top): Vulcan Village (t5) matches the Volcano Top look (brown dirt, dark rock edges). Cave rock (d9) is patchier than the manual's smooth dark stone; the map data itself mixes tile variants, so nothing was changed. Wailing Cave is not a map name in the list (probably a renamed cave map). No village screenshot exists to compare t1 against.
- New-game start (year 100, Western Village) checked on a phone-sized viewport: loads clean, no console errors, first-year toast shows.
- Original button art: MENUICON.GOS records are [normal, highlight] pairs (0 Single Play, 1 MultiPlay, 3 Quit Game, 4 New Game, 5 Load Game, 6 Back to Main Menu, 7 Save Game, 8 Load Game, 9 Option, 10 Exit to Menu, 11 Continue Game; 2 is the Korean title). `ui/artbutton.ts` draws them (mix-blend-mode screen drops the black); used on the title screen (Continue / New Game) and the ESC menu (Save, Load, Exit to Menu). Music/sound toggles and slot lists stay text.
- Year orb answered: ICON1 record 12 is 40 frames of a spinning 15x15 globe, so the orb is a decorative animation riding the year-progress slider, not a day/night indicator. Day/night cycle dropped for good; the orb now animates with those frames.
- ICON1 still unused: records 17-20 (map location name labels, 22 overworld + 20 underworld frames, normal/highlight), 4 (15 frames 29x29), 26-28 (round HUD icons), 0/5/6/8/14 (HUD frame pieces), 1 (104x78 portrait gauge frame). The in-game inventory has no item icons in any sheet found (ITEM.GOS is the dropped-item animation).
- Area name label: ICON1 records 17 (overworld, frame = map order) and 18 (underworld, frame = order - 22) drawn over the top-left of the play field, repositioned from the canvas rect every status tick.
- Manual quick guide (QUICK_~2.JPG): the in-game menu lists Continue Game / Save Game / Load Game / Option / Exit to Menu (our menu now starts with the Continue Game art button); the HUD "Time" field is the orb on the year slider. It also names three map objects: Demon's Gate ("use magic to seal the gate"), Warp Door ("activate the door and warp") and Sign ("click this and move to next place"). Sprite kind 23 is a stair archway and kind 61 a wooden wall gate (rendered as props, no behaviour); I could not tie them to the manual's objects, so they are left alone. Places are reached through scripts and the world map.
- Smoke test: entered all 42 maps in one page at year 110 on a phone viewport: no page or console errors, NPC and enemy counts sane.
- Found the Korean original (퇴마전설 / Toema Jeonseol) and its fan wiki; details in docs/KOREAN_NOTES.md. Applied: real stat formulas (life/mana/attack/defense, checked against both manual stat screens), Elim's real starting stats, LEVEL_GAIN re-tuned (total 9 points per level, still automatic), hero life/mana trait multipliers slightly trimmed. Spell numbers and mana costs already matched.
- Fog-of-war minimap (black until explored, saved per map), Darkness Echo / Holy Eye reveal the map, Distant Viewer widens the explored radius for a minute. ESC menu has "Enter a code..." with the English cheat words (years, map, levels, item drops).
- Local typecheck note: plain `tsc` here stops at the missing node/vite types and misses real errors; use a stubbed config (`/tmp/tscheck/tsconfig.json` with `types: []` and a `declare module 'three'` stub) and watch CI.
- Not done from the findings: weapon durability and blacksmith repair, carry weight, per-hero stats with a point-allocation screen, Skill (hit chance / ignore-damage) and attack speed from Dexterity.

- Dragon Heart now gives a flat +100 Life for the whole party (story.lifeBonus, saved) instead of an approximate Health gain.
- Gear durability (guesses flagged in game/durability.ts): itemstats `life` is durability, tracked per item id and saved. Melee/arrow hits wear the weapon; blows taken wear shield/cap/armour/shoes; Intelligence makes wear rarer (100/(100+Int)). A broken piece gives nothing until mended; the REPAIR_WEAPON shop now lists worn gear with a price (half the shop price, in proportion to the damage - a guess). Inventory shows durability and weight against the carry limit (200 + 3 Str + 1.5 Health, floored; matches the manual). The limit is shown, not enforced.
- Found 430 more monsters: object classes 48-60 (on a1, a5, a10, a13, b2-b7, d*) sit on walkable ground (2% blocked, props 11%) with valid monster kinds, and were skipped. They spawn now (map fill-in is much denser, ~+19%). Also: `extra` values 1-7 (on ~1,900 monsters) were being dropped as items 1-7 (swords!) or run as event numbers; now only extra >= 8 counts as a fixed drop/event. Documented in docs/FORMATS.md. 42-map smoke test still clean.
- Per-hero stats: Elim keeps story.stats (scripts test him), Kusa and Raening have story.heroStats (start values are guesses around the manual's totals: Elim 93 points at level 1, Kusa 175 at level 10, so ~9 points a level). Level-ups give every hero 9 points (POINTS_PER_LEVEL); the player spends them with the yellow + on the HUD portrait / item screen, or "Auto" (per-hero weights). Potions and script INCREASE reach every hero. The old life/mana/attack hero multipliers are gone (Elim's level-1 life is now exactly the manual's 129). Old saves migrate (start + Elim's gains). Carry limit = sum of the three heroes' limits; above it the party slows (guess: -5% per 10% over, floor 60%). Inventory sheet z-index fixed so the minimap no longer draws over it.
- Skill (Int x 0.4 + Skill stat) gives a chance to ignore a blow (Skill/200, max 50%); Dexterity adds move speed (0.3%/pt, cap 50%) and attack animation speed; weapon speed (aspeed 4 = baseline) too. All unit guesses, noted in docs/KOREAN_NOTES.md.
