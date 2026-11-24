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
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  setWorld(w: World): void {
    this.world = w;
    const { w: mw, h: mh } = w.map;
    this.base.width = mw;
    this.base.height = mh;
    const c = this.base.getContext('2d')!;
    const img = c.createImageData(mw, mh);
    for (let y = 0; y < mh; y++)
      for (let x = 0; x < mw; x++) {
        const o = (y * mw + x) * 4;
        const free = !w.blockedCell(x, y);
        const v = free ? 118 : 24;
        img.data[o] = v;
        img.data[o + 1] = free ? 104 : 22;
        img.data[o + 2] = free ? 84 : 22;
        img.data[o + 3] = 255;
      }
    c.putImageData(img, 0, 0);
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
    ctx.drawImage(this.base, 0, 0, canvas.width, canvas.height);
    for (const d of dots) {
      ctx.fillStyle = d.color;
      ctx.fillRect(Math.round(d.x * sx) - 1, Math.round(d.y * sy) - 1, 3, 3);
    }
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round((cx - viewW / 2) * sx) + 0.5, Math.round((cy - viewH / 2) * sy) + 0.5, Math.round(viewW * sx), Math.round(viewH * sy));
  }
}
