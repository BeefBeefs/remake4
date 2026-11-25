import type { ItemDb } from './itemdb';
import type { Loadout } from './stats';

/** weight of everything the party carries: the shared bag plus what the heroes wear */
export function partyLoad(db: ItemDb, items: Map<number, number>, gears: Loadout[]): number {
  let load = 0;
  for (const [id, n] of items) load += (db.stat(id).weight ?? 0) * n;
  for (const g of gears) for (const id of Object.values(g)) if (id) load += db.stat(id).weight ?? 0;
  return load;
}

/**
 * Walking speed factor for a party that carries more than it can (a guess: the manual shows the limit but nothing says what
 * happens past it). Each 10% over the limit costs 5% of speed, down to 60%.
 */
export function encumbrance(load: number, capacity: number): number {
  if (capacity <= 0 || load <= capacity) return 1;
  return Math.max(0.6, 1 - 0.5 * (load / capacity - 1));
}
