/**
 * The 2003-byte trailer of every .MAP is a table of up to 200 placed objects, stored column-wise
 * as 10 arrays of 200 bytes. Decoded so far (see docs/FORMATS.md):
 *   0 facing (2-7)   1 cell x   2 cell y   3 class   4 kind   5 extra (drop / state)   6-9 always 0
 * Entry numbers are the "object id" of the EVT script headers (the Blacksmith of T1 is object 1).
 * `kind` 1-60 is a monster name index (LANG.GOS); 65-67 are something else (not monsters).
 */
export interface MapObject {
  index: number;
  facing: number;
  x: number;
  y: number;
  cls: number;
  kind: number;
  extra: number;
}

export const OBJECT_SLOTS = 200;

export function parseMapObjects(trailer: Uint8Array, w: number, h: number): MapObject[] {
  const out: MapObject[] = [];
  const at = (field: number, i: number) => trailer[field * OBJECT_SLOTS + i] ?? 0;
  for (let i = 0; i < OBJECT_SLOTS; i++) {
    const x = at(1, i);
    const y = at(2, i);
    if (!x && !y) continue;
    if (x >= w || y >= h) continue;
    out.push({ index: i, facing: at(0, i), x, y, cls: at(3, i), kind: at(4, i), extra: at(5, i) });
  }
  return out;
}

export type ObjectRole = 'prop' | 'scenery' | 'monster' | 'unknown';

/**
 * What a placed object is (inferred; checked by drawing the maps):
 *  - class 0        a SPRITE.GOS record `kind` (barrels, chests, villagers, statues, skeletons...)
 *  - class 98 / 99  a BACK.GOS record `kind` (grass, plants, fountains, pillars, trees)
 *  - class 1-60     a monster, `kind` = LANG.GOS monster number (class: behaviour / group, not understood)
 * Objects bound to a script (object ids in the EVT headers) are NPCs and are handled separately.
 */
export function objectRole(o: MapObject): ObjectRole {
  if (o.cls === 0) return o.kind < 70 ? 'prop' : 'unknown';
  if (o.cls === 98 || o.cls === 99) return o.kind < 70 ? 'scenery' : 'unknown';
  // classes 1-60: 430 objects with class 48-60 sit on walkable ground (2% blocked against 11% for props) and carry valid monster
  // numbers, so they are monsters too (the class itself is still not understood)
  if (o.cls >= 1 && o.cls < 98 && o.kind >= 1 && o.kind <= 60) return 'monster';
  return 'unknown';
}

export function monsterSpawns(objs: MapObject[]): MapObject[] {
  return objs.filter((o) => objectRole(o) === 'monster');
}

/**
 * Class-0 objects of kind 9-12 are the idle-animated figure models of the scripted NPCs (9 = the Blacksmith's, 12 = the
 * Jeweler's ...). Unscripted ones number about 740 over all maps and sit in dense clumps among crates and barrels (about 40
 * stacked blacksmiths in the Western Village market), so they are editor leftovers and are not drawn. Scripted NPCs reach the
 * map through their script entry and are unaffected.
 */
export function isEditorFiller(o: MapObject): boolean {
  return o.cls === 0 && ((o.kind >= 9 && o.kind <= 12) || isMarkerSprite(o.kind));
}

/** SPRITE.GOS records 45-50 and 52-57 are plain 16x32 rectangles in the editor's marker grey (8b898b) / purple (83507b) */
export function isMarkerSprite(kind: number): boolean {
  return kind >= 45 && kind <= 57 && kind !== 51;
}
