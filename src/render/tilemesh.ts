import { TilesetMeta } from '../data/types';
import { isOverhead, objectTile, TILE_H, TILE_W, World } from '../game/world';

export type Layer = 'ground' | 'objects' | 'overhead';

export interface ChunkArrays {
  positions: Float32Array; // x, y, z per vertex; y is negated (three.js is y-up, the game is y-down)
  uvs: Float32Array;
  indices: Uint16Array;
  quads: number;
}

export const CHUNK = 16;

/**
 * Geometry for one CHUNK x CHUNK block of cells of a layer. One textured quad per drawable tile;
 * marker tiles (collision / void editor art) are skipped unless showMarkers is set.
 */
export function buildChunk(
  world: World,
  layer: Layer,
  chunkX: number,
  chunkY: number,
  ts: TilesetMeta,
  showMarkers: boolean,
): ChunkArrays | null {
  const x0 = chunkX * CHUNK;
  const y0 = chunkY * CHUNK;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let q = 0;
  for (let cy = y0; cy < Math.min(y0 + CHUNK, world.map.h); cy++) {
    for (let cx = x0; cx < Math.min(x0 + CHUNK, world.map.w); cx++) {
      let t: number;
      if (layer === 'ground') t = world.ground(cx, cy);
      else {
        const raw = world.object(cx, cy);
        if (isOverhead(raw) !== (layer === 'overhead')) continue;
        t = objectTile(raw);
      }
      if (!world.isTile(t)) continue;
      const px = cx * TILE_W;
      const py = cy * TILE_H;
      const quad = (tile: number): void => {
        const col = tile % ts.cols;
        const row = Math.floor(tile / ts.cols);
        const u0 = (col * ts.tileW) / ts.width;
        const u1 = ((col + 1) * ts.tileW) / ts.width;
        const vTop = 1 - (row * ts.tileH) / ts.height;
        const vBot = 1 - ((row + 1) * ts.tileH) / ts.height;
        pos.push(px, -py, 0, px + TILE_W, -py, 0, px + TILE_W, -py - TILE_H, 0, px, -py - TILE_H, 0);
        uv.push(u0, vTop, u1, vTop, u1, vBot, u0, vBot);
        const b = q * 4;
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
        q++;
      };
      if (!showMarkers && world.isHidden(t)) {
        if (layer !== 'ground') continue;
        const fill = world.groundFill(cx, cy); // a floor under hidden marker cells, so nothing shows black
        if (fill >= 0) quad(fill);
        continue;
      }
      // art tiles with the editor's marker colours punched out of them: floor underneath, so the holes are not black
      if (layer === 'ground' && !showMarkers && world.isPunched(t)) {
        const fill = world.groundFill(cx, cy);
        if (fill >= 0) quad(fill);
      }
      quad(t);
    }
  }
  if (!q) return null;
  return { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint16Array(idx), quads: q };
}
