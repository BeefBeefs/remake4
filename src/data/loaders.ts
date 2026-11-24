import { MapData, MapIndexEntry, SpriteSheetMeta, TilesetTable, LangData, ItemStats, MonsterTable } from './types';

const ASSETS = 'assets/';

export function assetUrl(path: string): string {
  return ASSETS + path;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(assetUrl(path));
  if (!r.ok) throw new Error(`failed to load ${path}: ${r.status}`);
  return (await r.json()) as T;
}

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** little-endian u16 array regardless of host endianness */
export function u16le(bytes: Uint8Array): Uint16Array {
  const out = new Uint16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = bytes[2 * i] | (bytes[2 * i + 1] << 8);
  return out;
}

interface RawMap {
  id: string;
  name: string;
  tileset: string;
  w: number;
  h: number;
  ground: string;
  objects: string;
  trailer: string;
}

export function parseMap(raw: RawMap): MapData {
  return {
    id: raw.id,
    name: raw.name,
    tileset: raw.tileset,
    w: raw.w,
    h: raw.h,
    ground: u16le(decodeBase64(raw.ground)),
    objects: u16le(decodeBase64(raw.objects)),
    trailer: decodeBase64(raw.trailer),
  };
}

export const loadMapIndex = () => getJson<MapIndexEntry[]>('maps/index.json');
export const loadTilesets = () => getJson<TilesetTable>('tiles/tilesets.json');
export const loadSpriteMeta = (name: string) => getJson<SpriteSheetMeta>(`sprites/${name.toLowerCase()}.json`);
export async function loadMap(id: string): Promise<MapData> {
  return parseMap(await getJson<RawMap>(`maps/${id}.json`));
}
export async function loadText(path: string): Promise<string> {
  const r = await fetch(assetUrl(path));
  if (!r.ok) throw new Error(`failed to load ${path}: ${r.status}`);
  return r.text();
}
export const loadLang = () => getJson<LangData>('text/lang.json');
export const loadMonsters = () => getJson<MonsterTable>('text/monsters.json');
export const loadItemStats = () => getJson<ItemStats>('text/itemstats.json');
