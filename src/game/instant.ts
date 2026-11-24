import type { EvtBlock, EvtFile } from '../script/parser';

/**
 * under.evt ends with a group of "instant events" (the file's own section title): stone statues that raise a stat, freeze
 * the demons, refill life or mana, and tables that conjure an item. The blocks carry the dungeon number 17 and object 5, but
 * the dungeons have statue (26 / 28) and table (43) sprites on every map, so the events are a shared pool: touching one
 * runs one of them. Which event a given sprite owns is not in the data we found, so each touch picks one at random.
 */
export const INSTANT_FIRST_ID = 151;
export const INSTANT_UNDER_MAP = 17;

export type InstantKind = 'statue' | 'table';

export function instantKindOfSprite(kind: number): InstantKind | null {
  if (kind === 26 || kind === 28) return 'statue';
  if (kind === 43) return 'table';
  return null;
}

/** commands that tie a block to one particular map (puzzle statues, warps): those are not part of the random pool */
const MAP_BOUND = new Set(['REMOVE_OBJECT', 'WARP', 'CHANGE_GOS', 'LOCATE_ENEMY', 'NEW_OBJECT', 'UNSEAL']);

/** all instant-event blocks of the file (map = the shifted dungeon number), keyed by what they are */
export function instantBlocks(file: EvtFile, mapNo: number): { all: Set<EvtBlock>; statue: EvtBlock[]; table: EvtBlock[] } {
  const sorted = [...file.blocks].sort((a, b) => a.start - b.start);
  const all = new Set<EvtBlock>();
  const statue: EvtBlock[] = [];
  const table: EvtBlock[] = [];
  sorted.forEach((b, i) => {
    if (b.map !== mapNo || b.id < INSTANT_FIRST_ID) return;
    all.add(b);
    const end = sorted[i + 1]?.start ?? file.ops.length;
    const bound = file.ops.slice(b.start, end).some((o) => o.t === 'cmd' && MAP_BOUND.has(o.name));
    if (bound) return;
    const name = b.name.trim().toLowerCase();
    if (name.includes('statue')) statue.push(b);
    else if (name.includes('table')) table.push(b);
  });
  return { all, statue, table };
}
