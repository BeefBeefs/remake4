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
+20 down). Object values >= 4320 are not tiles (**?** NPC / object / event references, e.g. 10354+).
Map order, tileset and name come from the EXE table in `tools/build_assets.py`
(A1-14, T1-4 -> ST1; B1-7, T5-6 -> ST2; C1-5, D1-10 -> ST3). EVT map numbers are 1-based into that order.

## TIL – tile sheets
RGB565 raster 640 px wide, 32x20 tiles, 20 per row, 4320 tiles. Black is the colour key (transition
tiles need something underneath: **?** how the original fills the base). Solid grey `8b898b` and purple
`83507b` tiles (also two-tone ones) are editor markers: collision / void. **?** exact semantics of each.
Assets are repacked to 32 tiles per row so the sheet stays under 4096 px.

## SF5 / SF6 – pictures
u16 w, u16 h (800x600), RGB555 (SF5) or RGB565 (SF6).

## EVT – scripts
cp949 text, one flat op stream with global labels. Headers `(event id, map number, object id, "name",
BASIC|FLOW, 100)` are entry points. Typos in the original commands are aliased in `src/script/parser.ts`.
The interpreter (`src/script/interpreter.ts`) covers IF/GO*/SELECT/CASE/GIVE/REMOVE/ORDER/shop lists;
world effects (WARP, LOCATE_ENEMY, NEW_OBJECT...) go to the host. One label (`마법소명령`) is missing in the
original data; jumping to a missing label warns and ends the script.

## Open questions
MAP trailer; object layer values >= 4320; NPC/enemy placement; real collision rules; unarmed stance and
actions 3-5, 11-13, 18-20; `GO_BASIC_EVENT`; which music plays where; walking speed and animation timing.
