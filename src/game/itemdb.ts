import { ItemStat, ItemStats, LangData } from '../data/types';

export type ItemKind = 'equipment' | 'consumable' | 'quest' | 'unknown';

/** Item id space shared by GIVE / REMOVE / LOCATE_ITEM / shop lists (see docs/FORMATS.md, LANG.GOS). */
export class ItemDb {
  constructor(
    readonly lang: LangData,
    private stats: ItemStats = {},
  ) {}

  stat(id: number): ItemStat {
    return this.stats[String(id)] ?? {};
  }

  /** shop price from the manual; undefined = not sold (quest items, rings) */
  price(id: number): number | undefined {
    return this.stats[String(id)]?.price;
  }

  /** what a shop pays: half the price (GUESS - the manual only lists the buy price) */
  sellPrice(id: number): number | undefined {
    const p = this.price(id);
    return p === undefined ? undefined : Math.max(1, Math.floor(p / 2));
  }

  /** one-line summary for shop lists: attack / defense / effect from the manual, else the string-table text */
  summary(id: number): string {
    const st = this.stat(id);
    const parts: string[] = [];
    if (st.atk !== undefined) parts.push(`atk ${st.atk}`);
    if (st.aspeed !== undefined) parts.push(`spd ${st.aspeed}`);
    if (st.def !== undefined) parts.push(`def ${st.def}`);
    if (st.special) parts.push(st.special.replace(/\s+/g, ''));
    if (parts.length) return parts.join(' ');
    return this.desc(id);
  }

  kind(id: number): ItemKind {
    if (this.lang.weapons[String(id)]) return 'equipment';
    if (id >= 151 && id <= 196) return 'consumable';
    if (id >= 200 && id <= 254) return 'quest';
    return 'unknown';
  }

  name(id: number): string {
    return this.lang.weapons[String(id)]?.name ?? this.lang.items[String(id)]?.name ?? `item ${id}`;
  }

  desc(id: number): string {
    return this.lang.weapons[String(id)]?.stats ?? this.lang.items[String(id)]?.desc ?? '';
  }

  isMoney(id: number): boolean {
    return id === 200;
  }

  /**
   * Record in ITEM.GOS used for the item lying on the ground. GUESSED from the art of each record
   * (0 selection frame, 1 herb, 2 potion, 3 coins, 4 orb, 5 scroll, 6 tablet, 7 small trinket, 8 sword, 9 shield,
   * 10 cap, 11 armour, 12 shoes, 13 bow, 14 necklace, 15 ring).
   */
  groundRecord(id: number): number {
    const w = this.lang.weapons[String(id)];
    if (w) {
      return { sword: 8, bow: 13, shield: 9, cap: 10, armor: 11, shoes: 12, ring: 15, necklace: 14 }[w.category] ?? 7;
    }
    if (this.isMoney(id)) return 3;
    const n = this.name(id).toLowerCase();
    if (/ginseng/.test(n)) return 1;
    if (/water|drug/.test(n)) return 2;
    if (/scroll|seal|fire wall|ghost|spark|lightning|blood fire|curse|shield|healing|rain|resurrection/.test(n)) return 5;
    if (/ball|jewel|eye/.test(n)) return 4;
    if (/map/.test(n)) return 6;
    return 7;
  }
}
