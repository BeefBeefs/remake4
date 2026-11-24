import { SpriteActor } from '../render/renderer';

export const PICKUP_RADIUS = 24;

export interface GroundItem {
  id: number;
  x: number;
  y: number;
  actor: SpriteActor;
  record: number;
  t: number;
}

/** nearest ground item within reach of (x, y), or -1 */
export function findPickup(items: GroundItem[], x: number, y: number): number {
  let best = -1;
  let bd = PICKUP_RADIUS;
  items.forEach((it, i) => {
    const d = Math.hypot(it.x - x, (it.y - y) / 0.625);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
