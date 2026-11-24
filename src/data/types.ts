/** Shapes of the converted assets written by tools/build_assets.py (see docs/FORMATS.md). */

export const NONE = 0xffff;
/** object-layer cells >= this are `tile + OVERHEAD_FLAG`: drawn above characters (roofs, canopies) */
export const OVERHEAD_FLAG = 10000;

export interface TilesetMeta {
  tileW: number;
  tileH: number;
  cols: number;
  count: number;
  width: number;
  height: number;
  /** solid grey / purple editor tiles: collision + void markers, never drawn in game */
  markers: number[];
  /** blue / red / green editor tiles (start points, triggers): hidden like markers but not solid */
  editor?: number[];
}
export type TilesetTable = Record<string, TilesetMeta>;

export interface MapIndexEntry {
  id: string;
  name: string;
  tileset: string;
  w: number;
  h: number;
  order: number;
  /** position on the 800x600 world pictures, and which one (1 real world, 2 underworld) */
  wx: number;
  wy: number;
  world: 1 | 2;
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

/** public/assets/text/lang.json, written by tools/build_assets.py --only lang */
export interface LangData {
  ui: string[];
  monsters: string[];
  maps: string[];
  magic: Record<string, { name: string; desc: string }>;
  items: Record<string, { name: string; desc: string }>;
  weapons: Record<string, { name: string; stats: string; category: string }>;
}

/** Prices and stats from the printed manual (tools/build_assets.py `stats`). */
export interface ItemStat {
  atk?: number;
  aspeed?: number;
  def?: number;
  life?: number;
  range?: number;
  weight?: number;
  price?: number;
  mana?: number;
  special?: string;
  effect?: string;
}
export type ItemStats = Record<string, ItemStat>;

/** one row of AKUMA.EXE's monster table (tools/build_assets.py `monsters`), keyed by LOCATE_ENEMY kind */
export interface MonsterStat {
  name: string;
  /** index into the enemy sprite sheet list (game/enemies.ts ENEMY_SHEETS) */
  sheet: number;
  hp: number;
  atk: number;
  def: number;
  speed: number;
  raw: number[];
  sfx: number[];
}
export type MonsterTable = Record<string, MonsterStat>;
