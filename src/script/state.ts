/** Persistent story state that scripts read and write. */

export type StatName = 'HEALTH' | 'STRENGTH' | 'MAGIC' | 'DEXTERITY' | 'BRAIN' | 'SKILL';

export class StoryState {
  /** `NUM n` event flags ("NUM_TO_ALL" = shared in multiplayer, identical single player) */
  flags = new Set<number>();
  /** inventory by item id */
  items = new Map<number, number>();
  /** active quest numbers (`ORDER n`) with their log text */
  orders = new Map<number, { title: string; ment: string[] }>();
  /** objects scripts have removed ("map:object") and sprite records they have swapped in (CHANGE_GOS) */
  removed = new Set<string>();
  gos = new Map<string, number>();
  money = 0;
  level = 1;
  /** experience towards the next level (party-wide) */
  xp = 0;
  stats: Record<StatName, number> = { HEALTH: 10, STRENGTH: 10, MAGIC: 10, DEXTERITY: 10, BRAIN: 10, SKILL: 10 };
  magic = new Map<number, number>();
  /** the quest log's capacity is not known yet; scripts only test whether there is room */
  maxOrders = 8;

  itemCount(id: number): number {
    return this.items.get(id) ?? 0;
  }
  giveItem(id: number, n = 1): void {
    this.items.set(id, this.itemCount(id) + n);
  }
  removeItem(id: number, n = 1): void {
    const left = this.itemCount(id) - n;
    if (left > 0) this.items.set(id, left);
    else this.items.delete(id);
  }
  hasOrderSpace(): boolean {
    return this.orders.size < this.maxOrders;
  }
}
