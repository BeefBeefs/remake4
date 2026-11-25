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
  /** talk entry an object currently answers with ("map:object" -> block id), set by CHANGE n; absent = its first entry */
  entry = new Map<string, number>();
  /** script objects a NEW_OBJECT has put on the map ("map:object" -> cell and SPRITE record) */
  /** overworld places (map numbers 1-22) that are still sealed: not reachable from the world map until a script says UNSEAL n */
  sealed = new Set<number>();
  placed = new Map<string, { x: number; y: number; rec: number }>();
  /** game clock in years: starts at 100, scripts' entries unlock when their year (last header number) has come */
  year = 100;
  /** map id -> seen cells (1 byte per cell, y * w + x) for the minimap */
  explored = new Map<string, Uint8Array>();
  money = 0;
  level = 1;
  /** experience towards the next level (party-wide) */
  xp = 0;
  /** durability points used per item id (see game/durability.ts) */
  wear = new Map<number, number>();
  /** permanent Life gained from the Dragon Heart (flat, not a stat) */
  lifeBonus = 0;
  /** Elim's stats (the manual's level-1 screen); scripts test and change these, and stat gains reach every hero */
  stats: Record<StatName, number> = { HEALTH: 23, STRENGTH: 25, MAGIC: 15, DEXTERITY: 14, BRAIN: 16, SKILL: 10 };
  /** the other heroes' own stats (starting values are guesses, see game/stats.ts) */
  heroStats: Record<string, Record<StatName, number>> = {
    Kusa: { HEALTH: 14, STRENGTH: 15, MAGIC: 28, DEXTERITY: 10, BRAIN: 20, SKILL: 10 },
    Raening: { HEALTH: 18, STRENGTH: 18, MAGIC: 10, DEXTERITY: 22, BRAIN: 14, SKILL: 10 },
  };
  /** level-up points each hero has not spent yet */
  points: Record<string, number> = { Elim: 0, Kusa: 0, Raening: 0 };

  statsOf(name: string): Record<StatName, number> {
    return this.heroStats[name] ?? this.stats;
  }
  /** a potion or script reward: every hero gains it */
  addStat(k: StatName, n: number): void {
    this.stats[k] += n;
    for (const s of Object.values(this.heroStats)) s[k] += n;
  }
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
