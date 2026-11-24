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
}

export const UNARMED_ATTACK = 4;

/**
 * Party stats + one hero's gear -> numbers the game uses. The formulas are placeholders (the real ones live in the EXE):
 * max life 50 + 5 x Health + gear life, attack = weapon attack + Strength/2, defense = sum of gear defense.
 */
export function derive(db: ItemDb, base: Record<StatName, number>, level: number, gear: Loadout): Derived {
  const b = emptyBonuses();
  let atk = UNARMED_ATTACK;
  let def = 0;
  for (const slot of SLOTS) {
    const id = gear[slot];
    if (!id) continue;
    parseBonuses(db.lang.weapons[String(id)]?.stats ?? '', b);
    const st = db.stat(id);
    if (slot === 'weapon') atk = st.atk ?? atk;
    if (st.def) def += st.def;
  }
  const total = (k: StatName) => Math.round((base[k] + b.stats[k]) * (1 + (b.pct[k] ?? 0) / 100));
  const maxHp = Math.round((50 + 5 * total('HEALTH') + b.life + (level - 1) * 4) * (1 + (b.pct.LIFE ?? 0) / 100));
  const attack = Math.round((atk + b.atk + total('STRENGTH') / 2) * (1 + (b.pct.ATK ?? 0) / 100));
  const maxMana = 20 + 3 * total('MAGIC');
  return { maxHp, maxMana, attack, defense: def, speedMul: 1 + b.speed / 100, strength: total('STRENGTH'), dexterity: total('DEXTERITY'), magic: total('MAGIC') };
}

/** damage after armour: each defense point soaks a bit, never below 1 */
export function mitigate(damage: number, defense: number): number {
  return Math.max(1, Math.round(damage * (100 / (100 + defense * 2))));
}

/** experience needed to leave `level` (placeholder curve) */
export function xpToNext(level: number): number {
  return 20 + 15 * (level - 1) * level;
}

/** stat points gained per level-up (placeholder; the trainer script wants Dexterity > 60 at level 16) */
export const LEVEL_GAIN: Record<StatName, number> = { HEALTH: 2, STRENGTH: 2, MAGIC: 1, DEXTERITY: 3, BRAIN: 1, SKILL: 1 };

export function enemyXp(power: number): number {
  return 4 + Math.floor(power / 2);
}
