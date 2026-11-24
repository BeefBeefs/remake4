import { MapData, NONE, OVERHEAD_FLAG, TILE_LIMIT, TilesetMeta } from '../data/types';

/** object cells >= 10000 carry a flag on top of the tile index (see docs/FORMATS.md) */
export const isOverhead = (v: number): boolean => v !== NONE && v >= OVERHEAD_FLAG;
export const objectTile = (v: number): number => (v >= OVERHEAD_FLAG && v !== NONE ? v - OVERHEAD_FLAG : v);

export const TILE_W = 32;
export const TILE_H = 20;

/**
 * Runtime view of a map: tile lookup and walkability.
 *
 * Collision is derived from the editor marker tiles (solid grey / purple) painted into the
 * ground and object layers, and from empty ground. This is an inference from the data, not yet
 * confirmed against the original engine; see PROGRESS.md.
 */
export class World {
  readonly markers: Set<number>;
  private readonly editor: Set<number>;

  constructor(
    readonly map: MapData,
    readonly tileset: TilesetMeta,
  ) {
    this.markers = new Set(tileset.markers);
    this.editor = new Set(tileset.editor ?? []);
  }

  get pixelW(): number {
    return this.map.w * TILE_W;
  }
  get pixelH(): number {
    return this.map.h * TILE_H;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.map.w && cy < this.map.h;
  }

  ground(cx: number, cy: number): number {
    return this.inBounds(cx, cy) ? this.map.ground[cy * this.map.w + cx] : NONE;
  }

  /** raw object cell: NONE, a tile index, or a tile index + OVERHEAD_FLAG */
  object(cx: number, cy: number): number {
    return this.inBounds(cx, cy) ? this.map.objects[cy * this.map.w + cx] : NONE;
  }

  /** editor art that must not be drawn (collision markers and the coloured trigger tiles) */
  isHidden(tile: number): boolean {
    return this.markers.has(tile) || this.editor.has(tile);
  }
  isMarker(tile: number): boolean {
    return this.markers.has(tile);
  }

  /** true when a (flag-stripped) tile index refers to real art */
  isTile(tile: number): boolean {
    return tile !== NONE && tile < TILE_LIMIT;
  }

  blockedCell(cx: number, cy: number): boolean {
    const g = this.ground(cx, cy);
    if (g === NONE || this.isMarker(g)) return true;
    const o = this.object(cx, cy);
    return o !== NONE && this.isMarker(objectTile(o));
  }

  blockedAt(px: number, py: number): boolean {
    return this.blockedCell(Math.floor(px / TILE_W), Math.floor(py / TILE_H));
  }

  /** nearest open cell to (cx0, cy0) as a pixel position at the cell's bottom middle */
  nearestFree(cx0: number, cy0: number): { x: number; y: number } {
    const maxR = Math.max(this.map.w, this.map.h);
    for (let r = 0; r < maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = cx0 + dx;
          const cy = cy0 + dy;
          if (!this.blockedCell(cx, cy)) return { x: cx * TILE_W + TILE_W / 2, y: cy * TILE_H + TILE_H - 2 };
        }
      }
    }
    return { x: this.pixelW / 2, y: this.pixelH / 2 };
  }

  /** nearest open cell to the map centre */
  findSpawn(): { x: number; y: number } {
    return this.nearestFree(this.map.w >> 1, this.map.h >> 1);
  }
}
