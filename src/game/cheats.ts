/**
 * The original's cheat codes (single player; typed after pressing Enter). The English build keeps their words in LANG.GOS
 * ui strings 63-72; the Korean game's cheat list (Toema Jeonseol) says what the matching Korean phrases do:
 *   "The blue earth is rolling now N" = jump N years ahead, "SHOW ME THE NARA" / "See the silver lining" = show the map,
 *   "The soul Hunter's holy Power N" = N levels, "If I want I got it N" = drop item N, "You gain as one please N S" = S of item N.
 * The remaining ui strings (ISM, MO, END, WHAT IS HAPPEN TO RENING SIR?) are not matched to anything yet.
 */
export type Cheat =
  | { kind: 'years'; n: number }
  | { kind: 'reveal' }
  | { kind: 'levels'; n: number }
  | { kind: 'item'; id: number; count: number };

/** ui = the LANG ui strings array */
export function parseCheat(input: string, ui: string[]): Cheat | null {
  const table: [number, (nums: number[]) => Cheat | null][] = [
    [70, (n) => (n.length ? { kind: 'years', n: Math.min(60, n[0]) } : null)],
    [69, () => ({ kind: 'reveal' })],
    [66, () => ({ kind: 'reveal' })],
    [67, (n) => ({ kind: 'levels', n: Math.min(60, n[0] ?? 1) })],
    [64, (n) => (n.length ? { kind: 'item', id: n[0], count: 1 } : null)],
    [63, (n) => (n.length ? { kind: 'item', id: n[0], count: Math.min(99, n[1] ?? 1) } : null)],
  ];
  const text = input.trim();
  for (const [k, make] of table) {
    const code = (ui[k] ?? '').toLowerCase().replace(/\s+/g, '');
    if (!code) continue;
    // letters of the code may be separated by spaces; whatever follows must be the numbers
    let i = 0;
    let j = 0;
    while (i < text.length && j < code.length) {
      const c = text[i].toLowerCase();
      if (c === ' ') i++;
      else if (c === code[j]) (i++, j++);
      else break;
    }
    if (j < code.length) continue;
    const rest = text.slice(i);
    if (/[^\d\s]/.test(rest)) continue;
    return make((rest.match(/\d+/g) ?? []).map(Number));
  }
  return null;
}
