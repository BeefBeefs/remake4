import { World } from './world';
import { directionFromVector, recordIndex } from './anim';
import { ENEMY_ANIM } from './enemies';
import { SpriteSheetMeta } from '../data/types';
import { DrawFrame } from './hero';

export type EnemyState = 'idle' | 'walk' | 'attack';

const FRAME_TIME: Record<EnemyState, number> = { idle: 1 / 4, walk: 1 / 12, attack: 1 / 14 };
const HALF_WIDTH = 8;

/** Placeholder AI: notice the hero, walk to it, swing. Stats and real behaviour are not decoded yet. */
export class Enemy {
  dir = 4;
  state: EnemyState = 'idle';
  hp = 3;
  hurt = 0;
  dead = false;
  private t = 0;
  private frame = 0;
  private cooldown = 0;
  /** set when a swing reaches its hit frame; the game decides what that means */
  swung = false;

  constructor(
    readonly sheet: string,
    public x: number,
    public y: number,
    readonly kind = 0,
  ) {}

  damage(n: number): void {
    this.hp -= n;
    this.hurt = 0.25;
    if (this.hp <= 0) this.dead = true;
  }

  private set(s: EnemyState): void {
    if (this.state !== s) {
      this.state = s;
      this.frame = 0;
      this.t = 0;
    }
  }

  private action(): number {
    return ENEMY_ANIM[this.state];
  }

  update(dt: number, world: World, meta: SpriteSheetMeta, target: { x: number; y: number }): void {
    this.hurt = Math.max(0, this.hurt - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    const dx = target.x - this.x;
    const dy = (target.y - this.y) / 0.625;
    const d = Math.hypot(dx, dy);
    if (this.state !== 'attack') {
      if (d < 150 && d > 34) {
        const k = (55 * dt) / d;
        const nx = this.x + dx * k;
        const ny = this.y + dy * k * 0.625;
        if (!world.blockedAt(nx - HALF_WIDTH, this.y) && !world.blockedAt(nx + HALF_WIDTH, this.y)) this.x = nx;
        if (!world.blockedAt(this.x - HALF_WIDTH, ny) && !world.blockedAt(this.x + HALF_WIDTH, ny)) this.y = ny;
        this.dir = directionFromVector(dx, dy);
        this.set('walk');
      } else if (d <= 34) {
        this.dir = directionFromVector(dx, dy);
        if (this.cooldown <= 0) {
          this.set('attack');
          this.cooldown = 1.4;
        } else this.set('idle');
      } else this.set('idle');
    }
    this.t += dt;
    const ft = FRAME_TIME[this.state];
    while (this.t >= ft) {
      this.t -= ft;
      this.frame++;
    }
    const n = meta.records[recordIndex(this.action(), this.dir).index]?.frames.length ?? 0;
    if (this.state === 'attack') {
      if (this.frame === Math.floor(n / 2)) this.swung = true;
      if (this.frame >= n) this.set('idle');
    } else if (n > 0) this.frame %= n;
  }

  drawFrame(flipOverride = false): DrawFrame {
    const { index, flip } = recordIndex(this.action(), this.dir, !flipOverride);
    return { record: index, frame: this.frame, flip };
  }
}
