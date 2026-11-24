/**
 * Enemy sprite sheets in the order the EXE lists them (A-P, then the recoloured / alternate
 * versions, then the named monsters). LOCATE_ENEMY's "kind" argument ranges 2..47 in the scripts; mapping
 * kind -> sheet by this list is a GUESS (six kinds, 42-47, have no sheet in the list). Verify against play.
 */
export const ENEMY_SHEETS = [
  'ENEMY-A', 'ENEMY-B', 'ENEMY-C', 'ENEMY-D', 'ENEMY-E', 'ENEMY-F', 'ENEMY-G', 'ENEMY-H',
  'ENEMY-I', 'ENEMY-J', 'ENEMY-K', 'ENEMY-L', 'ENEMY-M', 'ENEMY-N', 'ENEMY-O', 'ENEMY-P',
  'ENEMY-A1', 'ENEMY-B1', 'ENEMY-B2', 'ENEMY-E1', 'ENEMY-F1', 'ENEMY-G1', 'ENEMY-G2', 'ENEMY-J1',
  'ENEMY-J2', 'ENEMY-M1', 'ENEMY-N1', 'ENEMY-N2', 'ENEMY-N3',
  'BIRD', 'CYCLOP', 'FIRE', 'FISH', 'FLY', 'GEAR', 'GEARBIG', 'LAMB', 'LION', 'ZAMBIE', 'STONE', 'DRAGON', 'WATER',
] as const;

export function sheetForKind(kind: number): string {
  return ENEMY_SHEETS[((kind % ENEMY_SHEETS.length) + ENEMY_SHEETS.length) % ENEMY_SHEETS.length];
}

/** record groups of every enemy sheet: 5 stored directions per action */
export const ENEMY_ANIM = { idle: 0, walk: 1, attack: 2 } as const;
