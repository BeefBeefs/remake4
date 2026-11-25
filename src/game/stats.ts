import { ItemDb } from './itemdb';
import { StatName } from '../script/state';

export type Slot = 'weapon' | 'shield' | 'cap' | 'armor' | 'shoes' | 'ring' | 'necklace';
export const SLOTS: Slot[] = ['weapon', 'shield', 'cap', 'armor', 'shoes', 'ring', 'necklace'];

const CATEGORY_SLOT: Record<string, Slot> = {
  sword: 'weapon',
  bow: 'weapon',
  shield: 'shield',
  cap: 'cap',
  armor: 'armor',
  shoes: 'shoes',
  ring: 'ring',
  necklace: 'necklace',
};

/** which slot an item id goes into, or null if it is not equipment */
export function slotOf(db: ItemDb, id: number): Slot | null {
  const c = db.lang.weapons[String(id)]?.category;
  return c ? (CATEGORY_SLOT[c] ?? null) : null;
}

/** one hero's worn items (item ids) */
export type Loadout = Partial<Record<Slot, number>>;

export interface Bonuses {
  stats: Record<StatName, number>;
  /** extra max life points ("Life+30") */
  life: number;
  /** movement speed bonus ("M.Speed+3" = +3%?? unit unknown; used as +3% of walking speed) */
  speed: number;
  atk: number;
  /** percentage bonuses of necklaces, applied to the stat's total (Strength+20%) */
  pct: Partial<Record<StatName | 'LIFE' | 'ATK', number>>;
}

const STAT_WORDS: Record<string, StatName> = {
  health: 'HEALTH',
  strength: 'STRENGTH',
  magic: 'MAGIC',
  dex: 'DEXTERITY',
  dexterity: 'DEXTERITY',
  intelligence: 'BRAIN',
  skill: 'SKILL',
};

export function emptyBonuses(): Bonuses {
  return { stats: { HEALTH: 0, STRENGTH: 0, MAGIC: 0, DEXTERITY: 0, BRAIN: 0, SKILL: 0 }, life: 0, speed: 0, atk: 0, pct: {} };
}

/** Parse the LANG.GOS equipment text, e.g. "Strength+3 Magic+10", "M.Speed+6 Life+10", "Skill+20%", "ALL Attributes+3". */
export function parseBonuses(text: string, into: Bonuses = emptyBonuses()): Bonuses {
  const re = /(ALL attributes|ALL Attributes|M\.Speed|A\.Speed|Intelligence|Dexterity|Strength|Health|Magic|Skill|Sight|Mana|Life|Attack|Dex)\s*([+-]\d+)(%?)/gi;
  for (const m of text.matchAll(re)) {
    const word = m[1].toLowerCase();
    const n = Number(m[2]);
    const pct = m[3] === '%';
    if (word === 'all attributes') {
      for (const k of Object.keys(into.stats) as StatName[]) {
        if (pct) into.pct[k] = (into.pct[k] ?? 0) + n;
        else into.stats[k] += n;
      }
    } else if (STAT_WORDS[word]) {
      const k = STAT_WORDS[word];
      if (pct) into.pct[k] = (into.pct[k] ?? 0) + n;
      else into.stats[k] += n;
    } else if (word === 'life') {
      if (pct) into.pct.LIFE = (into.pct.LIFE ?? 0) + n;
      else into.life += n;
    } else if (word === 'm.speed') into.speed += n;
    else if (word === 'attack') {
      if (pct) into.pct.ATK = (into.pct.ATK ?? 0) + n;
      else into.atk += n;
    }
    // Sight, Mana and A.Speed are not used yet
  }
  return into;
}

export interface Derived {
  maxHp: number;
  maxMana: number;
  attack: number;
  defense: number;
  speedMul: number;
  strength: number;
  dexterity: number;
  magic: number;
  /** Skill: Intelligence x 0.4 plus the Skill stat and gear (necklaces/rings) */
  skill: number;
  /** attack animation speed factor from the weapon's speed and Dexterity (a guess at the units) */
  attackRate: number;
}

/** chance that Skill lets a hero shrug off a blow (no damage, no flinch); the wiki gives no figure, so Skill / 200 up to 50% */
export const ignoreChance = (skill: number): number => Math.min(0.5, Math.max(0, skill) / 200);

export const UNARMED_ATTACK = 4;

/**
 * Party stats + one hero's gear -> numbers the game uses. The formulas are the original's, recovered from the manual's
 * character screens (Elim level 1, Kusa level 10) and the Korean community wiki for Toema Jeonseol (the same game):
 *   life = 83 + level + 1.3 Health + 0.6 Strength (+ gear Life), mana = 99 + 1.7 Magic + 0.3 Intelligence,
 *   attack = weapon + 0.4 Strength + 0.1 Dexterity (Kusa: Saver Blade 75 + 12.8 + 1.4 = 89, as printed),
 *   defense = gear + 0.2 Health + 0.1 Strength + 0.1 Dexterity. Shields cost Dexterity (Wooden Shield Dex-5: Elim's 14 -> 9).
 */
/**
 * How the three heroes differ (the manual: Elim a swordsman with high Dexterity and Health, Kusa the spell caster, Raening the
 * long-range fighter). One shared stat pool feeds all three; these are mild multipliers on what comes out of it. Numbers are
 * placeholders: only the direction comes from the manual.
 */
export interface HeroTrait {
  hp: number;
  mana: number;
  attack: number;
  speed: number;
  /** spell power */
  spell: number;
  /** extra damage with a bow (Raening's archery) */
  bow: number;
}
const NEUTRAL: HeroTrait = { hp: 1, mana: 1, attack: 1, speed: 1, spell: 1, bow: 1 };
/** with real per-hero stats the old life / mana / attack multipliers are gone; only Raening's bow bonus is left (a placeholder) */
export const HERO_TRAITS: Record<string, HeroTrait> = {
  Elim: { ...NEUTRAL },
  Kusa: { ...NEUTRAL },
  Raening: { ...NEUTRAL, bow: 1.25 },
};
export const traitOf = (name: string): HeroTrait => HERO_TRAITS[name] ?? NEUTRAL;

export function derive(db: ItemDb, base: Record<StatName, number>, level: number, gear: Loadout, trait: HeroTrait = NEUTRAL, permLife = 0): Derived {
  const b = emptyBonuses();
  let atk = UNARMED_ATTACK;
  let def = 0;
  let aspeed = 4;
  for (const slot of SLOTS) {
    const id = gear[slot];
    if (!id) continue;
    parseBonuses(db.lang.weapons[String(id)]?.stats ?? '', b);
    const st = db.stat(id);
    if (slot === 'weapon') {
      atk = st.atk ?? atk;
      aspeed = st.aspeed ?? aspeed;
    }
    if (st.def) def += st.def;
  }
  const total = (k: StatName) => Math.round((base[k] + b.stats[k]) * (1 + (b.pct[k] ?? 0) / 100));
  const H = total('HEALTH');
  const S = total('STRENGTH');
  const M = total('MAGIC');
  const D = total('DEXTERITY');
  const I = total('BRAIN');
  const maxHp = Math.round((83 + level + 1.3 * H + 0.6 * S + b.life + permLife) * (1 + (b.pct.LIFE ?? 0) / 100));
  const attack = Math.round((atk + b.atk + 0.4 * S + 0.1 * D) * (1 + (b.pct.ATK ?? 0) / 100));
  const maxMana = Math.round(99 + 1.7 * M + 0.3 * I);
  const skill = Math.round((base.SKILL + b.stats.SKILL + 0.4 * I) * (1 + (b.pct.SKILL ?? 0) / 100));
  return {
    maxHp: Math.round(maxHp * trait.hp),
    maxMana: Math.round(maxMana * trait.mana),
    attack: Math.round(attack * trait.attack),
    defense: def + Math.round(0.2 * H + 0.1 * S + 0.1 * D),
    speedMul: (1 + (b.speed + Math.min(50, 0.3 * D)) / 100) * trait.speed,
    strength: S,
    dexterity: D,
    magic: Math.round(M * trait.spell),
    skill,
    // a weapon speed of 4 is the baseline; each point is 5%, each Dexterity point 0.4%
    attackRate: (0.8 + 0.05 * aspeed) * (1 + (0.4 * D) / 100),
  };
}

/** damage after armour: each defense point soaks a bit, never below 1 */
export function mitigate(damage: number, defense: number): number {
  return Math.max(1, Math.round(damage * (100 / (100 + defense * 2))));
}

/** experience needed to leave `level` (placeholder curve) */
export function xpToNext(level: number): number {
  return 20 + 15 * (level - 1) * level;
}

/**
 * Every hero has his own stats and the player spends the points a level-up brings (the yellow + on the HUD portraits). The
 * manual shows Elim at level 1 (23/25/15/14/16: 93 points) and Kusa at level 10 (14/32/71/14/44: 175 points); if Kusa began
 * near 93 too, nine levels add about 9 points each. Kusa's and Raening's starting stats are guesses around that total.
 */
export const POINTS_PER_LEVEL = 9;
export const ALLOC_STATS: StatName[] = ['HEALTH', 'STRENGTH', 'MAGIC', 'DEXTERITY', 'BRAIN'];
export const START_STATS: Record<string, Record<StatName, number>> = {
  Elim: { HEALTH: 23, STRENGTH: 25, MAGIC: 15, DEXTERITY: 14, BRAIN: 16, SKILL: 10 },
  Kusa: { HEALTH: 14, STRENGTH: 15, MAGIC: 28, DEXTERITY: 10, BRAIN: 20, SKILL: 10 },
  Raening: { HEALTH: 18, STRENGTH: 18, MAGIC: 10, DEXTERITY: 22, BRAIN: 14, SKILL: 10 },
};
/** how "Auto" spreads a hero's points (shares of 10) */
export const AUTO_WEIGHTS: Record<string, Partial<Record<StatName, number>>> = {
  Elim: { HEALTH: 2, STRENGTH: 5, DEXTERITY: 2, BRAIN: 1 },
  Kusa: { HEALTH: 1, MAGIC: 6, BRAIN: 2, DEXTERITY: 1 },
  Raening: { HEALTH: 2, STRENGTH: 1, MAGIC: 2, DEXTERITY: 4, BRAIN: 1 },
};
/** spread `n` points over a hero's weights; the remainder goes to the heaviest stat */
export function autoSpread(name: string, n: number): Partial<Record<StatName, number>> {
  const w = AUTO_WEIGHTS[name] ?? AUTO_WEIGHTS.Elim;
  const total = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
  const out: Partial<Record<StatName, number>> = {};
  let used = 0;
  let top: StatName = 'STRENGTH';
  for (const k of ALLOC_STATS) {
    const share = Math.floor((n * (w[k] ?? 0)) / total);
    if (share) out[k] = share;
    used += share;
    if ((w[k] ?? 0) > (w[top] ?? 0)) top = k;
  }
  if (n > used) out[top] = (out[top] ?? 0) + (n - used);
  return out;
}

/**
 * old shared-pool level gain (placeholder, kept for the old tests). The Mantis Village trainer asks for level 16 and Strength 60 (the printed
 * strategy guide says Dexterity 60): starting from 10, level 16 gives Strength 70 and Dexterity 55, so both are in reach by
 * about level 18 even without gear.
 */
export const LEVEL_GAIN: Record<StatName, number> = { HEALTH: 1, STRENGTH: 3, MAGIC: 1, DEXTERITY: 3, BRAIN: 1, SKILL: 0 };

/** carry weight limit: 200 + 3 per Strength + 1.5 per Health (base stats), as printed on the manual's character screens */
export const carryCapacity = (base: Record<StatName, number>): number => Math.floor(200 + 3 * base.STRENGTH + 1.5 * base.HEALTH);

export function enemyXp(power: number): number {
  return 4 + Math.floor(power / 2);
}
