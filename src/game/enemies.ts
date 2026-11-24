/**
 * Enemy sprite sheets in the order the EXE lists them (A-P, then the recoloured / alternate
 * versions, then the named monsters).
 */
export const ENEMY_SHEETS = [
  'ENEMY-A', 'ENEMY-B', 'ENEMY-C', 'ENEMY-D', 'ENEMY-E', 'ENEMY-F', 'ENEMY-G', 'ENEMY-H',
  'ENEMY-I', 'ENEMY-J', 'ENEMY-K', 'ENEMY-L', 'ENEMY-M', 'ENEMY-N', 'ENEMY-O', 'ENEMY-P',
  'ENEMY-A1', 'ENEMY-B1', 'ENEMY-B2', 'ENEMY-E1', 'ENEMY-F1', 'ENEMY-G1', 'ENEMY-G2', 'ENEMY-J1',
  'ENEMY-J2', 'ENEMY-M1', 'ENEMY-N1', 'ENEMY-N2', 'ENEMY-N3',
  'BIRD', 'CYCLOP', 'FIRE', 'FISH', 'FLY', 'GEAR', 'GEARBIG', 'LAMB', 'LION', 'ZAMBIE', 'STONE', 'DRAGON', 'WATER',
] as const;

/**
 * LOCATE_ENEMY's "kind" k is monster name k (1-based) in LANG.GOS. The EXE's monster table (monsters.json) starts every
 * record with the index of its sprite sheet in the list above, so with the table every kind is exact. Without it
 * (tests, kind 1 "Hooks" which has no record) the fallbacks below apply: 1-16 -> A..P, 17-29 -> the recoloured variants,
 * 48-60 -> the named sheets.
 */
export function sheetForKind(kind: number, table?: Record<string, { sheet: number }>): string {
  const rec = table?.[String(kind)];
  if (rec && ENEMY_SHEETS[rec.sheet]) return ENEMY_SHEETS[rec.sheet];
  if (kind >= 1 && kind <= 29) return ENEMY_SHEETS[kind - 1];
  if (kind >= 48 && kind <= 60) return ENEMY_SHEETS[29 + kind - 48];
  return 'ENEMY-A';
}

/** record groups of every enemy sheet: 5 stored directions per action */
export const ENEMY_ANIM = { idle: 0, walk: 1, attack: 2 } as const;
