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

const NAMED = ENEMY_SHEETS.slice(29); // BIRD .. WATER

/**
 * LOCATE_ENEMY's "kind" k is monster name k (1-based) in LANG.GOS:
 *   1-16  Hooks .. Satan           -> ENEMY-A .. ENEMY-P            (verified by sprite vs name: Tiger = J, Satan = P)
 *   17-29 Hook Demon .. Iron Knight -> the 13 recoloured variants     (verified: Bull Demon = red axe B2, Golden Tiger = J2)
 *   48-60 Agroha .. Wiceli          -> the 13 named sheets in EXE order (name fits sprite: Cyclopean, Ficeli = fire, Matrock = stone)
 *   30-47 boss / story monsters     -> GUESSED from the names (no sheet of their own was found)
 */
const STORY_GUESS: Record<number, string> = {
  30: 'BIRD', // Hell Witch
  31: 'CYCLOP', // Western Demon
  32: 'FIRE', // Doldoras
  33: 'DRAGON', // Dragon Warrior
  34: 'ENEMY-F1', // Mantitus
  35: 'ENEMY-G2', // Skeleton King
  36: 'ENEMY-D', // Bandit
  37: 'STONE', // Gate Keeper
  38: 'STONE', // Gate Keeper
  39: 'LION', // Bagiramas
  40: 'ZAMBIE', // Galapagos
  41: 'ENEMY-M1', // Vamp
  42: 'GEARBIG', // Hellminor
  43: 'LAMB', // Manutis
  44: 'ENEMY-P', // Satan
  45: 'ENEMY-G', // Skeleton
  46: 'ENEMY-G1', // Skeleton
  47: 'ENEMY-G2', // Skeleton
};

export function sheetForKind(kind: number): string {
  if (kind >= 1 && kind <= 29) return ENEMY_SHEETS[kind - 1];
  if (kind >= 48 && kind <= 60) return NAMED[kind - 48];
  return STORY_GUESS[kind] ?? 'ENEMY-A';
}

/** record groups of every enemy sheet: 5 stored directions per action */
export const ENEMY_ANIM = { idle: 0, walk: 1, attack: 2 } as const;
