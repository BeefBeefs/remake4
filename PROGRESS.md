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

## Next ideas
- Per-hero growth / real stat formulas; monster bytes b2 b4-b7; hero base stats / level / experience, magic (12 spells with names known), real enemy stats.
- NEW_OBJECT, BASIC event triggers (GO_BASIC_EVENT), save / load.
- Real collision rules, trailer class meanings. Remaining spells; per-hero stat growth.
