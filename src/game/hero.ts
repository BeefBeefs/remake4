import { World } from './world';
import { directionFromVector, HERO_ANIM, recordIndex } from './anim';
import { SpriteSheetMeta } from '../data/types';
import { Loadout, UNARMED_ATTACK } from './stats';

export type HeroState = 'idle' | 'walk' | 'attack' | 'hurt' | 'dead';

export const WALK_SPEED = 96; // px/s, tuned by eye until the original's timing is measured
const FRAME_TIME: Record<HeroState, number> = { idle: 1 / 6, walk: 1 / 14, attack: 1 / 16, hurt: 1 / 12, dead: 1 / 8 };
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
  /** true for one update when an attack reaches its hit frame */
  swung = false;
  target: { x: number; y: number } | null = null;
  maxHp = 100;
  hp = 100;
  /** worn items by slot, and the numbers derived from them (set by the game, see game/stats.ts) */
  mana = 50;
  maxMana = 50;
  gear: Loadout = {};
  attackPower = UNARMED_ATTACK;
  defense = 0;
  speedMul = 1;
  /** attack animation speed (weapon speed and Dexterity) and the chance to ignore a blow (Skill) */
  attackRate = 1;
  ignore = 0;
  /** seconds of Buddha Shield left: no damage while above 0 */
  invuln = 0;
  /** multiplier on damage taken (Angel's Touch / Shield buffs) */
  guard = 1;
  get dead(): boolean {
    return this.hp <= 0;
  }
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

  /** placeholder combat: flat damage, brief stagger, death animation at 0 hp */
  takeDamage(n: number): void {
    if (this.dead || this.invuln > 0) return;
    if (this.ignore > 0 && Math.random() < this.ignore) return; // Skill: the blow is shrugged off
    this.hp = Math.max(0, this.hp - Math.max(1, Math.round(n * this.guard)));
    this.target = null;
    this.setState(this.dead ? 'dead' : 'hurt');
  }

  revive(): void {
    this.hp = this.maxHp;
    this.setState('idle');
  }

  attack(): void {
    if (this.dead || this.state === 'attack' || this.state === 'hurt') return;
    this.state = 'attack';
    this.frame = 0;
    this.t = 0;
  }

  private tryMove(world: World, dx: number, dy: number): boolean {
    // a character that starts inside a blocked cell (collision data is inferred) may always walk out of it
    if (world.blockedAt(this.x, this.y)) {
      this.x += dx;
      this.y += dy;
      return dx !== 0 || dy !== 0;
    }
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
    this.swung = false;
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.dead) this.input.x = this.input.y = 0;
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

    if (this.state !== 'attack' && this.state !== 'hurt' && this.state !== 'dead') {
      if (vx || vy) {
        // the 20px-tall tiles imply a squashed ground plane: walk slower along y
        const step = WALK_SPEED * this.speedMul * dt;
        const moved = this.tryMove(world, vx * step, vy * step * 0.625);
        this.dir = directionFromVector(vx, vy);
        this.setState(moved ? 'walk' : 'idle');
        if (!moved) this.target = null;
      } else this.setState('idle');
    }

    this.t += this.state === 'attack' ? dt * this.attackRate : dt;
    const ft = FRAME_TIME[this.state];
    while (this.t >= ft) {
      this.t -= ft;
      this.frame++;
    }
    const n = this.frameCountNow(meta);
    if (this.state === 'attack' && this.frame === Math.floor(n / 2) && this.t < dt + 1e-6) this.swung = true;
    if ((this.state === 'attack' || this.state === 'hurt') && this.frame >= n) {
      this.state = 'idle';
      this.frame = 0;
    } else if (this.state === 'dead') this.frame = Math.min(this.frame, Math.max(0, n - 1));
    else if (n > 0) this.frame %= n;
  }

  private setState(s: HeroState): void {
    if (this.state !== s) {
      this.state = s;
      this.frame = 0;
      this.t = 0;
    }
  }

  private action(): number {
    switch (this.state) {
      case 'walk':
        return HERO_ANIM.walk;
      case 'attack':
        return HERO_ANIM.attack;
      case 'hurt':
        return HERO_ANIM.hurt;
      case 'dead':
        return HERO_ANIM.death;
      default:
        return HERO_ANIM.idle;
    }
  }

  private frameCountNow(meta: SpriteSheetMeta): number {
    return meta.records[recordIndex(this.action(), this.dir).index]?.frames.length ?? 0;
  }

  drawFrame(flipOverride = false): DrawFrame {
    const { index, flip } = recordIndex(this.action(), this.dir, !flipOverride);
    return { record: index, frame: this.frame, flip };
  }
}
