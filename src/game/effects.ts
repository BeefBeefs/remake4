import { World } from './world';

/** anything a spell or arrow can hurt */
export interface Target {
  x: number;
  y: number;
  dead: boolean;
  damage(n: number): void;
}

export type EffectSheet = 'MGC-EFF' | 'ARROW';

/** unit vector for each of the 8 facing directions (clockwise from screen-up) */
export const DIR_VECTORS: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
].map(([x, y]) => {
  const l = Math.hypot(x, y);
  return [x / l, y / l] as [number, number];
});

/**
 * ARROW.GOS: 5 arrow types x 32 frames, frame 0 pointing up, 8 right, 16 down, 24 left (11.25 degrees per step).
 */
export function arrowFrame(vx: number, vy: number): number {
  const a = Math.atan2(vx, -vy);
  return ((Math.round(a / (Math.PI / 16)) % 32) + 32) % 32;
}

export type EffectKind = 'ball' | 'arrow' | 'wall' | 'visual';

export interface Effect {
  kind: EffectKind;
  sheet: EffectSheet;
  record: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** seconds alive / lifetime; for balls and arrows the lifetime is range / speed */
  t: number;
  life: number;
  damage: number;
  /** blast radius (ball) or contact radius (arrow, wall), in px on the flat ground plane */
  radius: number;
  fps: number;
  /** wall: seconds between damage ticks */
  tick: number;
  tickT: number;
  spent: boolean;
  /** frame to show instead of animating (arrows) */
  fixedFrame: number;
  /** keeps the effect on a moving character (shields, curses) */
  follow?: { x: number; y: number };
  /** spawned when a ball detonates */
  burst?: { sheet: EffectSheet; record: number; frames: number };
}

function base(e: Partial<Effect> & Pick<Effect, 'kind' | 'sheet' | 'record' | 'x' | 'y'>): Effect {
  return { vx: 0, vy: 0, t: 0, life: 1, damage: 0, radius: 16, fps: 12, tick: 0.5, tickT: 0, spent: false, fixedFrame: -1, ...e };
}

const FLAT = 0.625; // the ground plane is squashed: 20px tiles for 32px of width

export function fireBall(x: number, y: number, dir: number, damage: number): Effect {
  const [dx, dy] = DIR_VECTORS[dir];
  const speed = 230;
  return base({
    kind: 'ball', sheet: 'MGC-EFF', record: 22, x, y: y - 14, vx: dx * speed, vy: dy * speed * FLAT, life: 280 / speed,
    damage, radius: 34, fps: 14, burst: { sheet: 'MGC-EFF', record: 10, frames: 16 },
  });
}

export function ghostBolt(x: number, y: number, dir: number, damage: number): Effect {
  const [dx, dy] = DIR_VECTORS[dir];
  const speed = 300;
  return base({
    kind: 'ball', sheet: 'MGC-EFF', record: 32, x, y: y - 14, vx: dx * speed, vy: dy * speed * FLAT, life: 320 / speed,
    damage, radius: 22, fps: 14, burst: { sheet: 'MGC-EFF', record: 39, frames: 10 },
  });
}

export function arrow(x: number, y: number, dir: number, damage: number, rangePx: number, type = 0): Effect {
  const [dx, dy] = DIR_VECTORS[dir];
  const speed = 320;
  return base({
    kind: 'arrow', sheet: 'ARROW', record: type, x, y: y - 16, vx: dx * speed, vy: dy * speed * FLAT, life: rangePx / speed,
    damage, radius: 14, fixedFrame: arrowFrame(dx, dy),
  });
}

/** a short row of flame columns in front of the caster (perpendicular to the facing), damaging whatever stands in it */
export function fireWall(x: number, y: number, dir: number, damage: number): Effect[] {
  const [dx, dy] = DIR_VECTORS[dir];
  const out: Effect[] = [];
  for (let i = -2; i <= 2; i++) {
    out.push(
      base({
        kind: 'wall', sheet: 'MGC-EFF', record: 13, x: x + dx * 44 + -dy * i * 22, y: y + dy * 44 * FLAT + dx * i * 22 * FLAT,
        life: 4, damage, radius: 20, fps: 10, tick: 0.5,
      }),
    );
  }
  return out;
}

/** sparks around the caster, hitting everything close */
export function lightning(x: number, y: number, damage: number): Effect[] {
  const out: Effect[] = [base({ kind: 'visual', sheet: 'MGC-EFF', record: 26, x, y: y - 10, life: 6 / 12, fps: 12 })];
  out.push(base({ kind: 'wall', sheet: 'MGC-EFF', record: 0, x, y: y - 10, life: 0.5, damage, radius: 72, fps: 12, tick: 0.25 }));
  return out;
}

/** a patch of falling ice / fire in front of the caster: scattered columns that keep hurting whatever stands in them */
export function rain(x: number, y: number, dir: number, damage: number, record: number): Effect[] {
  const [dx, dy] = DIR_VECTORS[dir];
  const cx = x + dx * 100;
  const cy = y + dy * 100 * FLAT;
  const spots: [number, number][] = [[0, 0], [-46, 0], [46, 0], [-23, -40], [23, -40], [-23, 40], [23, 40]];
  return spots.map(([ox, oy], i) =>
    base({
      kind: 'wall', sheet: 'MGC-EFF', record, x: cx + ox, y: cy + oy * FLAT, life: 3, damage, radius: 36, fps: 12 + (i % 3), tick: 0.6,
      tickT: 0.1 * i,
    }),
  );
}

/** a glow that stays on a character for `secs` (Buddha Shield) */
export function aura(target: { x: number; y: number }, record: number, secs: number): Effect {
  return base({ kind: 'wall', sheet: 'MGC-EFF', record, x: target.x, y: target.y - 10, life: secs, radius: 0, fps: 8, follow: target });
}

/** the stone shell of Stone Curse; its last frame stays up until the curse ends */
export function shell(target: { x: number; y: number }, secs: number): Effect {
  return base({ kind: 'visual', sheet: 'MGC-EFF', record: 34, x: target.x, y: target.y, life: secs, fps: 10, follow: target });
}

export function visual(sheet: EffectSheet, record: number, frames: number, x: number, y: number, fps = 16): Effect {
  return base({ kind: 'visual', sheet, record, x, y, life: frames / fps, fps });
}

/** advance one effect; detonations and hits append to `spawn`. Returns false when the effect is finished. */
export function updateEffect(e: Effect, dt: number, world: World, targets: Target[], spawn: Effect[]): boolean {
  e.t += dt;
  if (e.follow) {
    e.x = e.follow.x;
    e.y = e.follow.y - (e.kind === 'visual' ? 0 : 10);
  }
  if (e.spent || e.t >= e.life) {
    if (e.kind === 'ball' && !e.spent) detonate(e, targets, spawn);
    return false;
  }
  const near = (t: Target, r: number) => !t.dead && Math.hypot(t.x - e.x, (t.y - (e.y + 14)) / FLAT) < r;
  if (e.kind === 'ball' || e.kind === 'arrow') {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (world.blockedAt(e.x, e.y + 14)) {
      if (e.kind === 'ball') detonate(e, targets, spawn);
      return false;
    }
    const hit = targets.find((t) => near(t, e.radius * (e.kind === 'ball' ? 0.5 : 1)));
    if (hit) {
      if (e.kind === 'ball') detonate(e, targets, spawn);
      else {
        hit.damage(e.damage);
        e.spent = true;
      }
      return false;
    }
  } else if (e.kind === 'wall') {
    e.tickT -= dt;
    if (e.tickT <= 0) {
      e.tickT = e.tick;
      for (const t of targets) if (near(t, e.radius)) t.damage(e.damage);
    }
  }
  return true;
}

function detonate(e: Effect, targets: Target[], spawn: Effect[]): void {
  e.spent = true;
  for (const t of targets) if (!t.dead && Math.hypot(t.x - e.x, (t.y - (e.y + 14)) / FLAT) < e.radius) t.damage(e.damage);
  if (e.burst) spawn.push(visual(e.burst.sheet, e.burst.record, e.burst.frames, e.x, e.y + 14));
}

/** frame of an effect's record to draw now */
export function effectFrame(e: Effect, frameCount: number): number {
  if (e.fixedFrame >= 0) return Math.min(e.fixedFrame, frameCount - 1);
  const f = Math.floor(e.t * e.fps);
  return e.kind === 'visual' ? Math.min(f, frameCount - 1) : f % Math.max(1, frameCount);
}
