import { Arg, EvtFile, Op } from './parser';

/**
 * under.evt numbers its places from the first underworld map (1 = Death Rock), sam.evt from the first overworld map. The
 * game's map list puts the 22 overworld places first, so the underworld numbers are shifted by 22 to line up with it.
 */
export const UNDERWORLD_OFFSET = 22;

/** commands whose first argument is a map / place number */
const MAP_FIRST = new Set(['WARP', 'LOCATE_ENEMY', 'LOCATE_ITEM', 'NEW_OBJECT', 'REMOVE_OBJECT', 'UNSEAL', 'STONE']);

function shiftAction(action: Arg[], by: number): Arg[] {
  if (action.length < 2) return action;
  const name = String(action[0]).toUpperCase();
  if (!MAP_FIRST.has(name)) return action;
  const n = Number(action[1]);
  if (typeof action[1] === 'string' && !/^\d+$/.test(action[1])) return action; // THIS / CURMAP
  if (!Number.isFinite(n)) return action;
  return [action[0], n + by, ...action.slice(2)];
}

/** Returns a copy of the script file with every map number shifted (blocks, world commands and inline IF / CASE actions). */
export function shiftMapNumbers(file: EvtFile, by: number): EvtFile {
  const ops: Op[] = file.ops.map((op): Op => {
    if (op.t === 'cmd') {
      if (MAP_FIRST.has(op.name)) return { ...op, args: shiftAction([op.name, ...op.args], by).slice(1) };
      if (op.name === 'IF') {
        const then = op.args.findIndex((a) => String(a).toUpperCase() === 'THEN');
        if (then >= 0) return { ...op, args: [...op.args.slice(0, then + 1), ...shiftAction(op.args.slice(then + 1), by)] };
      }
      return op;
    }
    if (op.t === 'case') return { ...op, action: shiftAction(op.action, by) };
    return op;
  });
  return { ...file, ops, blocks: file.blocks.map((b) => ({ ...b, map: b.map + by })) };
}

/**
 * Both scripts hand out "quest in progress" flags from the same range (NUM 101-111: the overworld Blacksmith's dragon
 * scales and the underworld Intermediary's tasks both use 104), so the underworld must start with those cleared or one
 * unfinished overworld quest would lock every Intermediary. Entering the underworld (GO_END1) clears them.
 */
export const SHARED_QUEST_FLAGS = [101, 103, 104, 105, 107, 108, 109, 111];
