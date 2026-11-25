import { packExplored, unpackExplored } from './explored';
import { StatName, StoryState } from '../script/state';
import { Loadout, START_STATS } from './stats';

/** Everything needed to carry on: story state, the party's condition and where it stands. Plain JSON. */
export interface SaveData {
  v: 1;
  map: string;
  x: number;
  y: number;
  leader: number;
  story: {
    flags: number[];
    items: [number, number][];
    orders: [number, { title: string; ment: string[] }][];
    money: number;
    year?: number;
    level: number;
    xp: number;
    stats: Record<StatName, number>;
    lifeBonus?: number;
    wear?: [number, number][];
    heroStats?: Record<string, Record<StatName, number>>;
    points?: Record<string, number>;
    magic: [number, number][];
    removed?: string[];
    gos?: [string, number][];
    entry?: [string, number][];
    sealed?: number[];
    placed?: [string, { x: number; y: number; rec: number }][];
    explored?: [string, string][];
  };
  heroes: { hp: number; mana: number; gear: Loadout }[];
}

export const SAVE_KEY = 'akuma.save.v1';

export interface SaveHero {
  hp: number;
  mana: number;
  gear: Loadout;
}

export function makeSave(
  story: StoryState,
  heroes: SaveHero[],
  leader: number,
  map: string,
  x: number,
  y: number,
): SaveData {
  return {
    v: 1,
    map,
    x: Math.round(x),
    y: Math.round(y),
    leader,
    story: {
      flags: [...story.flags],
      items: [...story.items],
      orders: [...story.orders],
      money: story.money,
      year: story.year,
      level: story.level,
      xp: story.xp,
      stats: { ...story.stats },
      lifeBonus: story.lifeBonus,
      wear: [...story.wear],
      heroStats: JSON.parse(JSON.stringify(story.heroStats)),
      points: { ...story.points },
      magic: [...story.magic],
      removed: [...story.removed],
      gos: [...story.gos],
      entry: [...story.entry],
      placed: [...story.placed],
      sealed: [...story.sealed],
      explored: [...story.explored].map(([id, bits]) => [id, packExplored(bits)] as [string, string]),
    },
    heroes: heroes.map((h) => ({ hp: Math.ceil(h.hp), mana: Math.floor(h.mana), gear: { ...h.gear } })),
  };
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Validates untrusted text from storage; returns null for anything that is not a usable v1 save. */
export function parseSave(text: string | null, heroCount: number): SaveData | null {
  if (!text) return null;
  try {
    const d = JSON.parse(text) as SaveData;
    if (d.v !== 1 || typeof d.map !== 'string' || !isNum(d.x) || !isNum(d.y) || !isNum(d.leader)) return null;
    const s = d.story;
    if (!s || !Array.isArray(s.flags) || !Array.isArray(s.items) || !Array.isArray(s.orders) || !Array.isArray(s.magic)) return null;
    if (!isNum(s.money) || !isNum(s.level) || !isNum(s.xp) || !s.stats) return null;
    if (!Array.isArray(d.heroes) || d.heroes.length !== heroCount) return null;
    for (const h of d.heroes) if (!isNum(h.hp) || !isNum(h.mana) || typeof h.gear !== 'object' || !h.gear) return null;
    return d;
  } catch {
    return null;
  }
}

/** Copies the saved story fields into a live StoryState (hero numbers are applied by the game). */
export function applyStory(story: StoryState, d: SaveData): void {
  story.flags = new Set(d.story.flags);
  story.items = new Map(d.story.items);
  story.orders = new Map(d.story.orders);
  story.money = d.story.money;
  story.year = isNum(d.story.year) ? d.story.year : 123; // a save from before the clock existed keeps every quest open
  story.level = d.story.level;
  story.xp = d.story.xp;
  story.stats = { ...story.stats, ...d.story.stats };
  if (!d.story.heroStats) {
    // an older save had one shared pool: every hero keeps his own start plus the gains Elim made
    for (const st of Object.values(story.heroStats)) for (const k of Object.keys(st) as StatName[]) st[k] += story.stats[k] - START_STATS.Elim[k];
  }
  for (const [name, st] of Object.entries(d.story.heroStats ?? {})) if (story.heroStats[name]) story.heroStats[name] = { ...story.heroStats[name], ...st };
  for (const [name, n] of Object.entries(d.story.points ?? {})) if (isNum(n)) story.points[name] = n;
  story.lifeBonus = isNum(d.story.lifeBonus) ? d.story.lifeBonus : 0;
  story.wear = new Map((d.story.wear ?? []).filter((w) => isNum(w[0]) && isNum(w[1])));
  story.magic = new Map(d.story.magic);
  story.removed = new Set(d.story.removed ?? []);
  story.gos = new Map(d.story.gos ?? []);
  story.entry = new Map(d.story.entry ?? []);
  story.placed = new Map(d.story.placed ?? []);
  story.sealed = new Set(d.story.sealed ?? []);
  story.explored = new Map((d.story.explored ?? []).map(([id, t]) => [id, unpackExplored(t)] as [string, Uint8Array]));
}
