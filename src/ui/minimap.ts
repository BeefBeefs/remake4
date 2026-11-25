import { revealCircle } from '../game/explored';
import { World } from '../game/world';

export interface Dot {
  x: number;
  y: number;
  color: string;
}

/** The original's overview window (top right): the whole map, the screen as a white frame, monsters red, villagers yellow. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base = document.createElement('canvas');
  private world: World | null = null;
  private terrain: Uint8ClampedArray = new Uint8ClampedArray(0);
  private bits: Uint8Array = new Uint8Array(0);
  private img: ImageData | null = null;
  private dirty = false;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** `seen` is the map's explored cells (kept by the caller so it can be saved); cells it marks show up, the rest stay black */
  setWorld(w: World, seen: Uint8Array): void {
    this.world = w;
    this.bits = seen;
    const { w: mw, h: mh } = w.map;
    this.base.width = mw;
    this.base.height = mh;
    this.terrain = new Uint8ClampedArray(mw * mh * 4);
    for (let y = 0; y < mh; y++)
      for (let x = 0; x < mw; x++) {
        const o = (y * mw + x) * 4;
        const free = !w.blockedCell(x, y);
        this.terrain[o] = free ? 118 : 24;
        this.terrain[o + 1] = free ? 104 : 22;
        this.terrain[o + 2] = free ? 84 : 22;
        this.terrain[o + 3] = 255;
      }
    this.img = this.base.getContext('2d')!.createImageData(mw, mh);
    for (let i = 0; i < mw * mh; i++) {
      if (seen[i]) this.img.data.set(this.terrain.subarray(i * 4, i * 4 + 4), i * 4);
      else this.img.data[i * 4 + 3] = 255; // unexplored: black
    }
    this.dirty = true;
  }

  /** the party has seen the cells within `r` of this pixel position */
  reveal(px: number, py: number, r: number): void {
    const w = this.world;
    if (!w || !this.img) return;
    const { w: mw, h: mh } = w.map;
    const cx = (px / w.pixelW) * mw;
    const cy = (py / w.pixelH) * mh;
    if (revealCircle(this.bits, mw, mh, cx, cy, r) > 0) this.paintSeen();
  }

  revealAll(): void {
    const w = this.world;
    if (!w || !this.img) return;
    this.bits.fill(1, 0, w.map.w * w.map.h);
    this.paintSeen();
  }

  private paintSeen(): void {
    const img = this.img!;
    for (let i = 0; i < this.bits.length && i * 4 < img.data.length; i++) if (this.bits[i]) img.data.set(this.terrain.subarray(i * 4, i * 4 + 4), i * 4);
    this.dirty = true;
  }

  isSeen(px: number, py: number): boolean {
    const w = this.world;
    if (!w) return false;
    const x = Math.floor((px / w.pixelW) * w.map.w);
    const y = Math.floor((py / w.pixelH) * w.map.h);
    return x >= 0 && y >= 0 && x < w.map.w && y < w.map.h && this.bits[y * w.map.w + x] === 1;
  }

  draw(cx: number, cy: number, viewW: number, viewH: number, dots: Dot[]): void {
    const w = this.world;
    if (!w) return;
    const { canvas, ctx } = this;
    const sx = canvas.width / w.pixelW;
    const sy = canvas.height / w.pixelH;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (this.dirty && this.img) {
      this.base.getContext('2d')!.putImageData(this.img, 0, 0);
      this.dirty = false;
    }
    ctx.drawImage(this.base, 0, 0, canvas.width, canvas.height);
    for (const d of dots) {
      if (!this.isSeen(d.x, d.y)) continue;
      ctx.fillStyle = d.color;
      ctx.fillRect(Math.round(d.x * sx) - 1, Math.round(d.y * sy) - 1, 3, 3);
    }
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round((cx - viewW / 2) * sx) + 0.5, Math.round((cy - viewH / 2) * sy) + 0.5, Math.round(viewW * sx), Math.round(viewH * sy));
  }
}
