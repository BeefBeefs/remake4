import { Hero } from './hero';
import { World } from './world';
import { SpriteSheetMeta } from '../data/types';

/** The three heroes. One leads (player controlled); the others trail behind it. */
export class Party {
  leaderIndex = 0;
  constructor(readonly heroes: Hero[]) {}

  get leader(): Hero {
    return this.heroes[this.leaderIndex];
  }

  setLeader(i: number): void {
    if (i < 0 || i >= this.heroes.length || i === this.leaderIndex) return;
    this.leader.input.x = this.leader.input.y = 0;
    this.leaderIndex = i;
  }

  placeAt(x: number, y: number): void {
    this.heroes.forEach((h, i) => {
      h.x = x + (i - 1) * 22;
      h.y = y;
      h.target = null;
    });
  }

  update(dt: number, world: World, metas: Map<string, SpriteSheetMeta>): void {
    const lead = this.leader;
    let slot = 0;
    for (const h of this.heroes) {
      if (h !== lead) {
        const d = Math.hypot(lead.x - h.x, lead.y - h.y);
        const want = 34 + slot * 26;
        h.input.x = h.input.y = 0;
        h.target = d > want ? { x: lead.x, y: lead.y } : null;
        slot++;
      }
      h.update(dt, world, metas.get(h.sheet)!);
    }
  }
}
