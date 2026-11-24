import { SpriteRecord, SpriteSheetMeta } from '../data/types';

/**
 * Hero sprite sheets (KUSA / RINING / LEELIM .GOS) hold 22 actions x 5 stored directions.
 * Record index = action * 5 + storedDir. Stored directions run from back view (0) through the side
 * (2) to front view (4); the other three of eight directions are the horizontal mirror of 1..3.
 *
 * The 22 actions form three weapon-stance groups with the same shape
 *   [stand-ish, walk, attack..., hurt-ish x3] ; the last action (21) is the death animation.
 * Only the sword group (6..13) is wired up so far; the others are decoded but unlabelled.
 */
export const ACTIONS_PER_SHEET = 22;
export const STORED_DIRS = 5;

export const HERO_ANIM = {
  idle: 6,
  walk: 7,
  attack: 8,
  attack2: 9,
  attack3: 10,
  death: 21,
} as const;

/** true if the stored side views face screen-right (east). Unverified guess; flip with ?flip=1 */
export const STORED_FACES_EAST = true;

/** 8 directions, clockwise from screen-up: N NE E SE S SW W NW */
export function directionFromVector(dx: number, dy: number): number {
  const a = Math.atan2(dx, -dy); // 0 = up, +clockwise
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

export function storedDirection(dir: number, storedFacesEast = STORED_FACES_EAST): { rec: number; flip: boolean } {
  const rec = Math.min(dir, 8 - dir);
  if (dir === 0 || dir === 4) return { rec, flip: false };
  const isEast = dir >= 1 && dir <= 3;
  return { rec, flip: isEast !== storedFacesEast };
}

export function recordIndex(action: number, dir: number, storedFacesEast = STORED_FACES_EAST): { index: number; flip: boolean } {
  const { rec, flip } = storedDirection(dir, storedFacesEast);
  return { index: action * STORED_DIRS + rec, flip };
}

export function frameCount(meta: SpriteSheetMeta, recIndex: number): number {
  return meta.records[recIndex]?.frames.length ?? 0;
}

export function recordOf(meta: SpriteSheetMeta, recIndex: number): SpriteRecord | undefined {
  return meta.records[recIndex];
}
