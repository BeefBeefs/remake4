# Akuma – Demon Spawn (Lamentation Sword): file formats

Reverse engineered from the 1999 CD (JC Research / Triger Soft). Everything below was checked against
the real data; items marked **?** are guesses or still unknown.

## Disc
BIN/CUE, MODE2/2352 data track (ISO9660) + 14 CDDA tracks (track 1 is data; music is tracks 2-15).
`tools/iso_rip.py` reads the ISO, `tools/sevenzip.py` unpacks the 7z (stdlib only).
Folders: `MAP` (A1-D10, T1-T6 `.MAP`, `ST1-3.TIL`), `IMG` (sprites `.GOS`, pictures `.SF5/.SF6`), `WAV`, `*.EVT`, AVI intros.

## GOS – sprite banks
Row-RLE frames grouped in records (header per record, `count` chunks). RGB565; the `*0.GOS` twins are RGB555.
Colour key is black. Hero sheets: 22 actions x 5 stored directions (N, NE, E, SE, S), record = action*5+dir.
**?** the three mirrored directions (SW, W, NW) are assumed to be flips; which side the stored art faces
is a guess (`?flip=1` in the URL swaps it). Sword stance: idle 6, walk 7, attack 8-10; death 21. Other
actions unlabelled. **?** GOS lead u16 and per-chunk flag byte.

## MAP
u8 w, u8 h, then a 128x128 buffer of 4-byte cells (ground u16, object u16, 0xFFFF = none), then a 2003-byte
trailer (**?** meaning). Ground tiles are stamped from larger pieces using consecutive indices (+1 right,
+20 down). Object-layer values are tile indices; values in 10000-12999 are `tile + 10000`, and the 10000
flag marks cells that look like roofs / upper parts of buildings, so the port draws them above the
characters (**?** the flag's real meaning; it may be a per-cell draw-order or occlusion flag). Ground cells never use it.
NPC / enemy placement is not in the cell data (**?** trailer or scripts).
Map order, tileset and name come from the EXE table in `tools/build_assets.py`
(A1-14, T1-4 -> ST1; B1-7, T5-6 -> ST2; C1-5, D1-10 -> ST3). EVT map numbers are 1-based into that order.

## TIL – tile sheets
RGB565 raster 640 px wide, 32x20 tiles, 20 per row, 4320 tiles. Black is the colour key (transition
tiles need something underneath: **?** how the original fills the base). Solid grey `8b898b` and purple
`83507b` tiles (also two-tone ones) are editor markers: collision / void. **?** exact semantics of each.
Assets are repacked to 32 tiles per row so the sheet stays under 4096 px.

## LANG.GOS - the string table (`IMG/LANG.GOS`, cp949 text, CRLF; `tools/build_assets.py --only lang` -> `text/lang.json`)
Lines 0-76 UI text; 77-136 monster names; 137-228 consumable items as (name, effect) pairs; 229-283 quest items
(one line each); 284-486 equipment; 487-528 the 42 map names (identical to the EXE order, which confirms it);
205+ magic as (name, effect) pairs (12 spells).
- `LOCATE_ENEMY` kind k = monster name k (1-based). 1-16 = sheets A-P, 17-29 = the 13 recoloured variants (both checked
  against the art: Tiger = J, Satan = P, Bull Demon = red axe), 48-60 = the 13 named sheets in EXE order. 30-47 (Hell Witch
  ... Skeleton) have no sheet of their own: guessed.
- Item ids: consumables id i -> line 2*i-165 (effect on the next line), 151-196; quest items id i -> line i+29, 200-254
  (checked on six items). Magic k -> line 205+2(k-1).
- Equipment ids (shop LIST numbers): swords 1-33, bows 41-56, shields 61-69, caps 71-77, armour 81-91, shoes 101-110,
  rings 111-124, necklaces 131-142. Shop lists fall inside these ranges.

## Scripts: placement commands
`WARP map cellX cellY` (map = 1-based index in the map order above; all 22 targets verified in bounds).
`LOCATE_ENEMY map cellX cellY kind power drop` (468 uses; kind 2-47, power 8-210, drop 0 = none, otherwise an
item id **?**). The cluster of 5-7 lines with nearby cells is one group spawn. `NEW_OBJECT` / `LOCATE_ITEM` are not
decoded. Kind -> sprite sheet: the EXE lists the enemy sheets in order (A-P, 13 recoloured variants, 13 named
monsters = 42), but kinds go up to 47, so kinds 30-47 are guessed (see LANG.GOS above).

## Enemy sheets
`ENEMY-A..P`, variants `A1 B1 B2 E1 F1 G1 G2 J1 J2 M1 N1 N2 N3` (recolours, same frame layout), monsters
`BIRD CYCLOP FIRE FISH FLY GEAR GEARBIG LAMB LION ZAMBIE STONE DRAGON WATER`. 5 stored directions per action;
actions 0 idle (1 frame), 1 walk (10), 2 attack (8), 3-5 unlabelled (9, 8, 10 frames; **?** hurt/special/death).
`*-D.GOS` files hold the same layout (**?** death or dark variant), the `*0` files are the RGB555 twins.
In all converted sheets (heroes too) stored direction 2 faces screen-left.

## SF5 / SF6 – pictures
u16 w, u16 h (800x600), RGB555 (SF5) or RGB565 (SF6).

## EVT – scripts
cp949 text, one flat op stream with global labels. Headers `(event id, map number, object id, "name",
BASIC|FLOW, 100)` are entry points. Typos in the original commands are aliased in `src/script/parser.ts`.
The interpreter (`src/script/interpreter.ts`) covers IF/GO*/SELECT/CASE/GIVE/REMOVE/ORDER/shop lists;
world effects (WARP, LOCATE_ENEMY, NEW_OBJECT...) go to the host. One label (`마법소명령`) is missing in the
original data; jumping to a missing label warns and ends the script.

## Open questions
MAP trailer (10 blocks of 200 bytes, ~125 used entries each, small per-type values: looks like per-monster-type
attribute tables, not positions); exact meaning of the 10000 object flag; NPC/enemy placement; real collision rules; unarmed stance and
actions 3-5, 11-13, 18-20; `GO_BASIC_EVENT`; which music plays where; walking speed and animation timing.
