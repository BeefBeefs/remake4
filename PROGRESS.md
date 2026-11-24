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
