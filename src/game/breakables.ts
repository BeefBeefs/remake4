/**
 * SPRITE.GOS records 5-8 (crate, chest, barrel, jar) hold an intact picture followed by break frames (crate 2, chest 2,
 * barrel 4, jar 4 frames), so they are loot containers you smash, not scenery. They used to cycle through every frame like the
 * animated props and flickered between whole and smashed. Record 9 and up are 11-frame idle figures and do animate.
 */
export const BREAKABLE_FIRST = 5;
export const BREAKABLE_LAST = 8;
export const BREAK_FPS = 8;

export function isBreakable(kind: number): boolean {
  return kind >= BREAKABLE_FIRST && kind <= BREAKABLE_LAST;
}

/** frame to show: 0 while intact (broke undefined), then the break frames in order, ending on the last (debris) */
export function breakableFrame(frames: number, broke: number | undefined): number {
  if (broke === undefined || frames <= 1) return 0;
  return Math.min(frames - 1, Math.floor(broke * BREAK_FPS) + 1);
}

/** what a smashed container gives: money about half the time (id 200 = money, as for monsters) */
export function containerDrop(rand: () => number = Math.random): number {
  return rand() < 0.55 ? 200 : 0;
}
