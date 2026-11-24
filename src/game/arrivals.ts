import { EvtFile } from '../script/parser';

/**
 * Where the scripts send the party on each map (WARP <map> <cellX> <cellY>). Used as the default entry
 * point when a map is chosen from the menu. The most frequent destination per map wins.
 */
export function collectArrivals(files: EvtFile[]): Map<number, { cx: number; cy: number }> {
  const count = new Map<string, number>();
  for (const f of files)
    for (const op of f.ops)
      if (op.t === 'cmd' && op.name === 'WARP' && op.args.length >= 3) {
        const key = `${Number(op.args[0])},${Number(op.args[1])},${Number(op.args[2])}`;
        count.set(key, (count.get(key) ?? 0) + 1);
      }
  const best = new Map<number, { cx: number; cy: number; n: number }>();
  for (const [key, n] of count) {
    const [map, cx, cy] = key.split(',').map(Number);
    const cur = best.get(map);
    if (!cur || n > cur.n) best.set(map, { cx, cy, n });
  }
  return new Map([...best].map(([m, v]) => [m, { cx: v.cx, cy: v.cy }]));
}
