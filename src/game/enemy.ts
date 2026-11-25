import { World } from './world';
import { directionFromVector, recordIndex } from './anim';
import { ENEMY_ANIM } from './enemies';
import { MonsterStat, SpriteSheetMeta } from '../data/types';
import { enemyXp } from './stats';
import { DrawFrame } from './hero';

export type EnemyState = 'idle' | 'walk' | 'attack';

const FRAME_TIME: Record<EnemyState, number> = { idle: 1 / 4, walk: 1 / 12, attack: 1 / 14 };
const HALF_WIDTH = 8;
const HP_SCALE = 0.5;
const DAMAGE_SCALE = 0.55;

/** Placeholder AI: notice the hero, walk to it, swing. Stats and real behaviour are not decoded yet. */
export class Enemy {
  dir = 4;
  state: EnemyState = 'idle';
  hp: number;
  maxHp: number;
  /** damage dealt per swing and how much each hit on it is softened (from the EXE table when the kind is known) */
  readonly damageOut: number;
  readonly defense: number;
  readonly moveSpeed: number;
  readonly xp: number;
  hurt = 0;
  /** seconds left turned to stone (Stone Curse): it neither moves nor attacks */
  frozen = 0;
  dead = false;
  private t = 0;
  private frame = 0;
  private cooldown = 0;
  /** set when a swing reaches its hit frame; the game decides what that means */
  swung = false;
  private swingFired = false;

  constructor(
    readonly sheet: string,
    public x: number,
    public y: number,
    readonly kind = 0,
    readonly power = 20,
    readonly drop = 0,
    stat?: MonsterStat,
  ) {
    if (stat) {
      // the table's numbers are in the original's scale; the factors below are placeholders that keep early fights short
      this.hp = Math.max(8, Math.round(stat.hp * HP_SCALE));
      this.damageOut = Math.max(2, Math.round(stat.atk * DAMAGE_SCALE));
      this.defense = stat.def;
      this.moveSpeed = 30 + stat.speed * 3.5;
      this.xp = Math.round((stat.hp + stat.atk * 4 + stat.def * 3) / 20);
    } else {
      this.hp = 8 + power;
      this.damageOut = 3 + Math.floor(power / 8);
      this.defense = 0;
      this.moveSpeed = 55;
      this.xp = enemyXp(power);
    }
    this.maxHp = this.hp;
  }

  freeze(secs: number): void {
    this.frozen = Math.max(this.frozen, secs);
    this.cooldown = Math.max(this.cooldown, 0.5);
  }

  /** a hit of `n` raw damage, softened by this monster's defense (never below 1) */
  damage(n: number): void {
    if (this.dead) return;
    this.hp -= Math.max(1, Math.round((n * 100) / (100 + this.defense * 2)));
    this.hurt = 0.25;
    if (this.hp <= 0) this.dead = true;
  }

  private set(s: EnemyState): void {
    if (this.state !== s) {
      this.state = s;
      this.swingFired = false;
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
    if (this.frozen > 0) {
      this.frozen -= dt;
      if (this.state === 'attack') this.set('idle');
      return;
    }
    const dx = target.x - this.x;
    const dy = (target.y - this.y) / 0.625;
    const d = Math.hypot(dx, dy);
    if (this.state !== 'attack') {
      if (d < 150 && d > 34) {
        const k = (this.moveSpeed * dt) / d;
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
      // the blow lands once, when the swing reaches its middle frame (this runs every tick, so remember that it did)
      if (this.frame >= Math.floor(n / 2) && !this.swingFired) {
        this.swingFired = true;
        this.swung = true;
      }
      if (this.frame >= n) this.set('idle');
    } else if (n > 0) this.frame %= n;
  }

  drawFrame(flipOverride = false): DrawFrame {
    const { index, flip } = recordIndex(this.action(), this.dir, !flipOverride);
    return { record: index, frame: this.frame, flip };
  }
}
