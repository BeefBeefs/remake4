import { World } from './world';
import { directionFromVector, HERO_ANIM, recordIndex } from './anim';
import { SpriteSheetMeta } from '../data/types';

export type HeroState = 'idle' | 'walk' | 'attack';

export const WALK_SPEED = 96; // px/s, tuned by eye until the original's timing is measured
const FRAME_TIME: Record<HeroState, number> = { idle: 1 / 6, walk: 1 / 14, attack: 1 / 16 };
const HALF_WIDTH = 7; // foot box half width for collision

export interface DrawFrame {
  record: number;
  frame: number;
  flip: boolean;
}

export class Hero {
  x: number;
  y: number;
  dir = 4;
  state: HeroState = 'idle';
  private t = 0;
  private frame = 0;
  target: { x: number; y: number } | null = null;
  /** direct input vector (keyboard), unit-ish; overrides target */
  input = { x: 0, y: 0 };

  constructor(
    readonly name: string,
    readonly sheet: string,
    x: number,
    y: number,
  ) {
    this.x = x;
    this.y = y;
  }

  attack(): void {
    if (this.state === 'attack') return;
    this.state = 'attack';
    this.frame = 0;
    this.t = 0;
  }

  private tryMove(world: World, dx: number, dy: number): boolean {
    let moved = false;
    const nx = this.x + dx;
    if (!world.blockedAt(nx - HALF_WIDTH, this.y) && !world.blockedAt(nx + HALF_WIDTH, this.y)) {
      this.x = nx;
      moved = dx !== 0;
    }
    const ny = this.y + dy;
    if (!world.blockedAt(this.x - HALF_WIDTH, ny) && !world.blockedAt(this.x + HALF_WIDTH, ny)) {
      this.y = ny;
      moved = moved || dy !== 0;
    }
    return moved;
  }

  update(dt: number, world: World, meta: SpriteSheetMeta): void {
    let vx = 0;
    let vy = 0;
    if (this.input.x || this.input.y) {
      this.target = null;
      const l = Math.hypot(this.input.x, this.input.y);
      vx = this.input.x / l;
      vy = this.input.y / l;
    } else if (this.target) {
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) this.target = null;
      else {
        vx = dx / d;
        vy = dy / d;
      }
    }

    if (this.state !== 'attack') {
      if (vx || vy) {
        // the 20px-tall tiles imply a squashed ground plane: walk slower along y
        const step = WALK_SPEED * dt;
        const moved = this.tryMove(world, vx * step, vy * step * 0.625);
        this.dir = directionFromVector(vx, vy);
        this.setState(moved ? 'walk' : 'idle');
        if (!moved) this.target = null;
      } else this.setState('idle');
    }

    this.t += dt;
    const ft = FRAME_TIME[this.state];
    while (this.t >= ft) {
      this.t -= ft;
      this.frame++;
    }
    const n = this.frameCountNow(meta);
    if (this.state === 'attack' && this.frame >= n) {
      this.state = 'idle';
      this.frame = 0;
    } else if (n > 0) this.frame %= n;
  }

  private setState(s: HeroState): void {
    if (this.state !== s) {
      this.state = s;
      this.frame = 0;
      this.t = 0;
    }
  }

  private action(): number {
    return this.state === 'walk' ? HERO_ANIM.walk : this.state === 'attack' ? HERO_ANIM.attack : HERO_ANIM.idle;
  }

  private frameCountNow(meta: SpriteSheetMeta): number {
    return meta.records[recordIndex(this.action(), this.dir).index]?.frames.length ?? 0;
  }

  drawFrame(flipOverride = false): DrawFrame {
    const { index, flip } = recordIndex(this.action(), this.dir, !flipOverride);
    return { record: index, frame: this.frame, flip };
  }
}
