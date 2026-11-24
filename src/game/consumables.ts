import type { StatName } from '../script/state';

/** what using a consumable does; every field is optional and they combine (Holy Scroll heals and adds Health) */
export interface ItemEffect {
  /** fraction of max life restored (1 = full) */
  life?: number;
  /** fraction of max mana restored */
  mana?: number;
  /** permanent stat gains */
  stats?: Partial<Record<StatName, number>>;
  money?: number;
  /** spell number learnt from a spell book (item 184 + n) */
  learn?: number;
  /** seconds of invincibility for the whole party */
  shield?: number;
}

const STAT_WORDS: Record<string, StatName> = {
  health: 'HEALTH',
  strength: 'STRENGTH',
  magic: 'MAGIC',
  dexterity: 'DEXTERITY',
  intelligence: 'BRAIN',
};

export const RICH_SCROLL_MONEY = 500;
export const SHIELD_SCROLL_SECONDS = 20;

/**
 * Reads a LANG.GOS consumable description ("Fully recover Life and Mana, Health+1", "Mana+50%", "Strength+1", "All
 * attributes+1") into an effect. Items that work passively (Hawk Wings "Dexterity+50%", Angel's Touch, Dragon Heart "Life+100"...)
 * and the ones that need systems we do not have (Teleport Gate jewel, Holy Eye, Seal Magic, Ice / Fire Ball) give null.
 */
export function itemEffect(id: number, desc: string): ItemEffect | null {
  if (id >= 185 && id <= 196) return { learn: id - 184 };
  const d = desc.toLowerCase();
  const fx: ItemEffect = {};
  if (/fully recover life/.test(d)) fx.life = 1;
  if (/fully recover (life and )?mana/.test(d)) fx.mana = 1;
  const life = d.match(/life\+(\d+)%/);
  if (life) fx.life = Number(life[1]) / 100;
  const mana = d.match(/mana\+(\d+)%/);
  if (mana) fx.mana = Number(mana[1]) / 100;
  const stats: Partial<Record<StatName, number>> = {};
  for (const m of d.matchAll(/(health|strength|magic|dexterity|intelligence)\+(\d+)(?!\d|%)/g)) stats[STAT_WORDS[m[1]]] = Number(m[2]);
  const all = d.match(/all attributes\+(\d+)(?!\d|%)/);
  if (all) for (const k of Object.values(STAT_WORDS)) stats[k] = (stats[k] ?? 0) + Number(all[1]);
  if (Object.keys(stats).length) fx.stats = stats;
  if (/appear money/.test(d)) fx.money = RICH_SCROLL_MONEY;
  if (/invincible/.test(d)) fx.shield = SHIELD_SCROLL_SECONDS;
  return Object.keys(fx).length ? fx : null;
}
