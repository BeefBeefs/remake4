/**
 * The game clock. The manual says many overworld events "happen after a certain amount of time in the game has elapsed"
 * and lists each quest with a year (after 102 ... after 123 years); every script entry carries its year as the last
 * header number. The original's pace is unknown: one year per 90 seconds of play is a guess that has the whole chain
 * (year 123) available after about 35 minutes.
 */
export const START_YEAR = 100;
export const YEAR_SECONDS = 90;

export function advanceYear(year: number, dt: number): number {
  return year + dt / YEAR_SECONDS;
}
