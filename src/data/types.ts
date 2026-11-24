/** Shapes of the converted assets written by tools/build_assets.py (see docs/FORMATS.md). */

export const NONE = 0xffff;

export interface TilesetMeta {
  tileW: number;
  tileH: number;
  cols: number;
  count: number;
  width: number;
  height: number;
  /** solid grey / purple editor tiles: collision + void markers, never drawn in game */
  markers: number[];
}
export type TilesetTable = Record<string, TilesetMeta>;

export interface MapIndexEntry {
  id: string;
  name: string;
  tileset: string;
  w: number;
  h: number;
  order: number;
}

export interface MapData {
  id: string;
  name: string;
  tileset: string;
  w: number;
  h: number;
  /** ground tile index per cell, row-major, w*h, NONE = empty */
  ground: Uint16Array;
  /** object/overlay tile per cell. Values >= TILE_LIMIT are not tiles (unknown, see FORMATS.md) */
  objects: Uint16Array;
  trailer: Uint8Array;
}

export interface SpriteFrame {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** offset of the trimmed frame's top-left from the hotspot */
  ox: number;
  oy: number;
}
export interface SpriteRecord {
  w: number;
  h: number;
  hx: number;
  hy: number;
  frames: (SpriteFrame | null)[];
}
export interface SpriteSheetMeta {
  name: string;
  pages: { file: string; w: number; h: number }[];
  records: SpriteRecord[];
}

/** tiles in the game's sheets are 20 per row, 216 rows */
export const TILE_LIMIT = 4320;
