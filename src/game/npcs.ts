import { EvtBlock } from '../script/parser';

/**
 * SPRITE.GOS record drawn for a script object. The EVT headers only carry a name, so this is chosen from the
 * name and the art of each record (9-17 villagers, 58/59 mages, 63 lord, 29-34 statues, 43/44 tables...). A guess.
 * Returns null for pure triggers (gates, warps) that have nothing to draw.
 */
export function npcSpriteRecord(name: string): number | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  if (/^(move|warp|entrance)|gate$|^dragon cave gate/.test(n)) return null;
  if (n.includes('table')) return 43;
  if (n.includes('hellfire')) return 29;
  if (n.includes('totem')) return 31;
  if (n.includes('statue') || n.includes('status')) return 30;
  if (n.includes('fountain')) return 36;
  if (/tomb|rock|god stone/.test(n)) return 34;
  if (/sword/.test(n)) return 41;
  if (n.includes('skeleton')) return 37;
  if (n.includes('blacksmith')) return 9;
  if (n.includes('jeweler')) return 12;
  if (n.includes('shopkeeper')) return 14;
  if (/merchant|intermediary|doll/.test(n)) return 16;
  if (/white lady|witch|white checker|raedina|shining/.test(n)) return 58;
  if (/magician|wizard|bluemoon|raegios|seajekus/.test(n)) return 59;
  if (/general|knight|warrior|ompherjo|keeper|guardian/.test(n)) return 15;
  if (/trainer|hunter|patewoos/.test(n)) return 10;
  if (/chief|old man/.test(n)) return 17;
  if (n === 'satan') return 63;
  if (/demon/.test(n)) return 64;
  return 11;
}

/**
 * All blocks sharing one object id on a map: conversation (FLOW) entries first, then BASIC ones. A quest NPC has several
 * entries (one per stage); the script command `CHANGE n` makes entry id n the one it answers with, `CHANGE 0` goes back
 * to the first.
 */
export function pickBlock(blocks: { fi: number; block: EvtBlock }[], entryId = 0): { fi: number; block: EvtBlock } {
  if (entryId > 0) {
    const chosen = blocks.find((b) => b.block.id === entryId);
    if (chosen) return chosen;
  }
  return blocks.find((b) => b.block.kind === 'FLOW') ?? blocks[0];
}

/**
 * GO_BASIC_EVENT hands over to the shop / plain-talk entry of the same NPC name. A few names have several BASIC entries
 * (the script comments say which village they serve): block ids below are those village-specific ones. Which map
 * "Western region / Eastern / Northern castle village" really is was inferred from the names (Western Village, Eastern
 * Village, Vulcan Village = the explosives smith), so treat it as a guess; every other map takes the generic entry.
 */
const BASIC_BY_MAP: Record<string, Record<string, number>> = {
  t1: { Blacksmith: 11, Witch: 12 },
  t4: { 'Item Merchant': 10 },
  t5: { Blacksmith: 9, 'Item Merchant': 13 },
};
const BASIC_VILLAGE_ONLY = new Set([9, 10, 11, 12, 13]);

export function basicBlockFor(blocks: EvtBlock[], name: string, mapId: string): EvtBlock | undefined {
  const same = blocks.filter((b) => b.kind === 'BASIC' && b.name === name);
  const want = BASIC_BY_MAP[mapId]?.[name];
  return same.find((b) => b.id === want) ?? same.find((b) => !BASIC_VILLAGE_ONLY.has(b.id)) ?? same[0];
}
