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
- Objects (>= 4320), NPC/enemy placement, enemies/combat, items/shops/inventory UI, world map and cutscene playback.
- Direction flip, animation timing and walk speed are guesses; collision is inferred from marker tiles.
- Only the hero/enemy sprites listed in `DEFAULT_SPRITES` are converted (`--sprites all` for the rest).
- Music per map is a placeholder.
- `npm run build` has not been run locally (npm was blocked in the authoring sandbox); the renderer was bundled
  against three r170 with esbuild and tested in headless Chrome. CI is the first real vite build.

Dev
- `npm install && npm run dev`; `npm test`.
- Rebuild assets: `python3 tools/build_assets.py --disc <Akuma folder> --bin <AKUMA.bin>` (needs numpy, Pillow, ffmpeg).
