import type { ItemDb } from './itemdb';
import type { Loadout } from './stats';

/**
 * Weapon and armour wear. itemstats.json gives every weapon, shield, cap, armour and pair of shoes a `life` column; the Korean
 * fan wiki says it is durability, that Intelligence slows the wear and that a blacksmith repairs worn gear. How fast it wears
 * and what a repair costs is not documented, so both are guesses (see docs/KOREAN_NOTES.md).
 *
 * Wear is tracked per item id (copies of one item share it) as points used.
 */
export type Wear = Map<number, number>;

export const maxDurability = (db: ItemDb, id: number): number => db.stat(id).life ?? 0;

export const wearOf = (wear: Wear, id: number): number => wear.get(id) ?? 0;

export const durabilityLeft = (db: ItemDb, wear: Wear, id: number): number => Math.max(0, maxDurability(db, id) - wearOf(wear, id));

export const isBroken = (db: ItemDb, wear: Wear, id: number): boolean => maxDurability(db, id) > 0 && wearOf(wear, id) >= maxDurability(db, id);

/** chance that one swing or one blow taken costs a point of durability: Intelligence (Brain) makes it rarer */
export const wearChance = (brain: number): number => 100 / (100 + Math.max(0, brain));

/** price of mending an item back to full: half the shop price in proportion to the damage (a guess; at least 1) */
export function repairCost(db: ItemDb, wear: Wear, id: number): number {
  const max = maxDurability(db, id);
  const used = Math.min(max, wearOf(wear, id));
  if (!max || !used) return 0;
  return Math.max(1, Math.ceil(((db.price(id) ?? 0) * 0.5 * used) / max));
}

/** the gear that actually counts: broken pieces give nothing until they are repaired */
export function workingGear(db: ItemDb, wear: Wear, gear: Loadout): Loadout {
  const out: Loadout = {};
  for (const [slot, id] of Object.entries(gear)) if (id && !isBroken(db, wear, id)) (out as Record<string, number>)[slot] = id;
  return out;
}

/** costs one point of durability; returns true when this made the item break */
export function wearOut(db: ItemDb, wear: Wear, id: number): boolean {
  const max = maxDurability(db, id);
  if (!max || wearOf(wear, id) >= max) return false;
  wear.set(id, wearOf(wear, id) + 1);
  return wearOf(wear, id) >= max;
}

export function repair(wear: Wear, id: number): void {
  wear.delete(id);
}
