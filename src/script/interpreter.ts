import { Arg, EvtBlock, EvtFile, Op } from './parser';
import { StatName, StoryState } from './state';

export type RGB = [number, number, number];

export type FaceSpec = { kind: 'npc'; id: number; name: string; color: RGB } | { kind: 'hero'; color: RGB } | null;

export type ShopKind = 'BUY_WEAPON' | 'BUY_ITEM' | 'SELL_WEAPON' | 'SELL_ITEM' | 'REPAIR_WEAPON' | 'LEARN_MAGIC';

/** What the interpreter needs from the game: UI for dialogue and hooks for world side effects. */
export interface ScriptHost {
  clear(): void;
  talk(text: string): void;
  setBox(style: 'BLUE' | 'RED', lines: number): void;
  setColor(color: RGB): void;
  setFace(face: FaceSpec): void;
  /** wait for the player to continue */
  waitKey(): Promise<void>;
  /** show a menu; returns the index into `choices` (entries with empty text are spacers) */
  select(choices: { text: string }[], color: RGB): Promise<number>;
  shop(kind: ShopKind, prompt: string, list: number[]): Promise<void>;
  play(sound: string): void;
  /** world side effects: WARP, LOCATE_ENEMY, LOCATE_ITEM, NEW_OBJECT, REMOVE_OBJECT, CHANGE, CHANGE_GOS, UNSEAL, STONE, FULL_LIFE, FULL_MANA, GO_END1, GO_END2 */
  effect(name: string, args: Arg[]): void | Promise<void>;
  /** whether the party can learn a spell right now (`IF LEARN_MAGIC`) */
  canLearnMagic?(): boolean;
  warn?(msg: string): void;
}

export type RunResult = { reason: 'END' | 'EOF' | 'BASIC' | 'ERROR'; message?: string };

type Signal = { kind: 'jump'; to: number } | { kind: 'end'; reason: RunResult['reason'] } | void;

const STAT_NAMES = new Set(['HEALTH', 'STRENGTH', 'MAGIC', 'DEXTERITY', 'BRAIN', 'SKILL']);
const SHOP_END: Partial<Record<ShopKind, string>> = {
  BUY_WEAPON: 'BUY_WEAPON_END',
  BUY_ITEM: 'BUY_ITEM_END',
  LEARN_MAGIC: 'LEARN_MAGIC_END',
};
const WORLD_EFFECTS = new Set([
  'WARP', 'LOCATE_ENEMY', 'LOCATE_ITEM', 'NEW_OBJECT', 'REMOVE_OBJECT', 'CHANGE', 'CHANGE_GOS', 'UNSEAL', 'STONE',
  // the Witch's "give up magic training" answer: there is no training period here (spells are learnt on the spot)
  'CANCEL_MAGIC',
]);

/** normalise odd spellings like "N-UM" or lower case to the keyword the engine knows */
function kw(a: Arg | undefined): string {
  return String(a ?? '').toUpperCase().replace(/[^A-Z_]/g, '');
}
function num(a: Arg | undefined): number {
  return typeof a === 'number' ? a : parseInt(String(a), 10);
}

export class EvtInterpreter {
  private pc: number;
  steps = 0;
  private color: RGB = [255, 255, 255];
  private ops: Op[];

  constructor(
    private file: EvtFile,
    private block: EvtBlock,
    private state: StoryState,
    private host: ScriptHost,
    private maxSteps = 200000,
  ) {
    this.ops = file.ops;
    this.pc = block.start;
  }

  async run(): Promise<RunResult> {
    const ops = this.ops;
    try {
      while (this.pc < ops.length) {
        if (++this.steps > this.maxSteps) return { reason: 'ERROR', message: 'step limit exceeded' };
        const op = ops[this.pc];
        const sig = await this.step(op);
        if (sig && sig.kind === 'end') return { reason: sig.reason };
        if (sig && sig.kind === 'jump') this.pc = sig.to;
        else this.pc++;
      }
      return { reason: 'EOF' };
    } catch (e) {
      return { reason: 'ERROR', message: (e as Error).message };
    }
  }

  private warn(msg: string): void {
    this.host.warn?.(`${this.block.name}#${this.block.id}: ${msg}`);
  }

  private findLabel(name: string, dir: 'down' | 'up'): number {
    const idxs = this.file.labels.get(name);
    if (idxs) {
      if (dir === 'down') {
        const hit = idxs.find((i) => i > this.pc);
        if (hit !== undefined) return hit;
      } else {
        for (let k = idxs.length - 1; k >= 0; k--) if (idxs[k] < this.pc) return idxs[k];
      }
      // the original data sometimes jumps the "wrong" way: take the nearest label anyway
      return idxs.reduce((a, b) => (Math.abs(b - this.pc) < Math.abs(a - this.pc) ? b : a));
    }
    return -1;
  }

  /** a jump to a label that does not exist (a few such bugs ship in the original data) ends the script */
  private jump(label: string, dir: 'down' | 'up'): Signal {
    // Shopkeeper#103 ships a "Yes! I can do it for you" answer with no label at all; the quest accept block is OK1
    if (label === 'undefined' && this.file.labels.has('OK1')) label = 'OK1';
    const to = this.findLabel(label, dir);
    if (to < 0) {
      this.warn(`label not found: ${label}`);
      return { kind: 'end', reason: 'END' };
    }
    return { kind: 'jump', to };
  }

  private async step(op: Op): Promise<Signal> {
    switch (op.t) {
      case 'cmd':
        return this.command(op.name, op.args, true);
      default:
        return; // labels and stray data lines do nothing when reached
    }
  }

  // ------------------------------------------------------------------ conditions

  private cond(t: Arg[]): boolean {
    const k = kw(t[0]);
    const op = kw(t[1]);
    const n = num(t[2]);
    const s = this.state;
    switch (k) {
      case 'NUM':
        return op === 'NOTHAVE' ? !s.flags.has(n) : s.flags.has(n);
      case 'ITEM':
        return op === 'NOTHAVE' ? s.itemCount(n) === 0 : s.itemCount(n) > 0;
      case 'ORDER':
        return op === 'NOTHAVE' ? !s.orders.has(n) : s.orders.has(n);
      case 'ORDER_SPACE':
        return op === 'NOTHAVE' ? !s.hasOrderSpace() : s.hasOrderSpace();
      case 'LEVEL':
        return op === 'LE' ? s.level <= n : s.level >= n;
      case 'MONEY':
        return op === 'LE' ? s.money <= n : s.money >= n;
      case 'LEARN_MAGIC':
        return this.host.canLearnMagic?.() ?? false;
      default:
        if (STAT_NAMES.has(k)) {
          const v = s.stats[k as StatName];
          return op === 'LE' ? v <= n : v >= n;
        }
        this.warn(`unknown condition ${t.join(' ')}`);
        return false;
    }
  }

  private async ifCommand(args: Arg[]): Promise<Signal> {
    const then = args.findIndex((a) => kw(a) === 'THEN');
    if (then < 0) {
      this.warn('IF without THEN');
      return;
    }
    const groups: Arg[][] = [[]];
    for (const a of args.slice(0, then)) {
      if (a === '&&') groups.push([]);
      else groups[groups.length - 1].push(a);
    }
    if (!groups.every((g) => this.cond(g))) return;
    const act = args.slice(then + 1);
    return this.command(kw(act[0]), act.slice(1), false, act);
  }

  // ------------------------------------------------------------------ commands

  /** `top` = executed as a body line (can consume following data lines); false = inline action of IF / CASE */
  private async command(name: string, args: Arg[], top: boolean, rawAction?: Arg[]): Promise<Signal> {
    const h = this.host;
    switch (name) {
      case 'IF':
        return this.ifCommand(args);
      case 'END':
        return { kind: 'end', reason: 'END' };
      case 'GO_BASIC_EVENT':
        await h.effect('GO_BASIC_EVENT', []);
        return { kind: 'end', reason: 'BASIC' };
      case 'GO_DOWN':
      case 'GO_UP':
      case 'GO':
        return this.jump(String(args[0]), name === 'GO_UP' ? 'up' : 'down');
      case 'GO_END1':
      case 'GO_END2':
        // chapter ends: 1 = the hellgate opens (overworld done), 2 = Satan's riddle (the game's end)
        await h.effect(name, []);
        return { kind: 'end', reason: 'END' };
      case 'CLEAR_BUFFER':
        return h.clear();
      case 'TALK':
        return h.talk(String(args[0] ?? ''));
      case 'WAIT':
        return h.waitKey();
      case 'COLOR':
        this.color = [num(args[0]), num(args[1]), num(args[2])];
        return h.setColor(this.color);
      case 'BOX':
        return h.setBox(kw(args[0]) === 'RED' ? 'RED' : 'BLUE', num(args[1]) || 6);
      case 'FACE': {
        const first = kw(args[0]);
        if (first === 'NO') return h.setFace(null);
        if (first === 'HERO') return h.setFace({ kind: 'hero', color: [num(args[1]), num(args[2]), num(args[3])] });
        return h.setFace({ kind: 'npc', id: num(args[0]), name: String(args[1] ?? ''), color: [num(args[2]), num(args[3]), num(args[4])] });
      }
      case 'SELECT':
        return top ? this.select(args) : undefined;
      case 'GIVE':
      case 'REMOVE': {
        const what = kw(args[0]);
        const sign = name === 'GIVE' ? 1 : -1;
        const s = this.state;
        if (what === 'NUM' || what === 'NUM_TO_ALL') {
          if (sign > 0) s.flags.add(num(args[1]));
          else s.flags.delete(num(args[1]));
        } else if (what === 'ITEM') {
          if (sign > 0) s.giveItem(num(args[1]), args[2] !== undefined ? num(args[2]) : 1);
          else s.removeItem(num(args[1]));
        } else if (what === 'MONEY') s.money = Math.max(0, s.money + sign * num(args[1]));
        else if (what === 'MAGIC' && sign > 0) s.magic.set(num(args[1]), num(args[2]) || 1);
        else this.warn(`${name} ${args.join(' ')}`);
        return;
      }
      case 'REMOVE_ORDER':
        this.state.orders.delete(num(args[0]));
        return;
      case 'ORDER':
        return top ? this.order(args) : undefined;
      case 'INCREASE':
      case 'DECREASE': {
        const stat = kw(args[0]) as StatName;
        if (STAT_NAMES.has(stat)) this.state.addStat(stat, (name === 'INCREASE' ? 1 : -1) * num(args[1]));
        return;
      }
      case 'FULL_LIFE':
      case 'FULL_MANA':
        return void (await h.effect(name, []));
      case 'PLAY':
        return h.play(String(args[0]));
      case 'BUY_WEAPON':
      case 'BUY_ITEM':
      case 'SELL_WEAPON':
      case 'SELL_ITEM':
      case 'REPAIR_WEAPON':
      case 'LEARN_MAGIC':
        return top ? this.shop(name, args) : undefined;
      default:
        if (WORLD_EFFECTS.has(name)) return void (await h.effect(name, args));
        // `THEN STEP1` style: a bare word is a label to jump to
        if (rawAction && !top && this.file.labels.has(String(rawAction[0]))) {
          return this.jump(String(rawAction[0]), 'down');
        }
        this.warn(`unknown command ${name} ${args.join(' ')}`);
    }
  }

  private async select(args: Arg[]): Promise<Signal> {
    const ops = this.ops;
    const color: RGB = [num(args[0]) || 255, num(args[1]) || 255, num(args[2]) || 255];
    const cases: Extract<Op, { t: 'case' }>[] = [];
    let i = this.pc + 1;
    while (i < ops.length) {
      const o = ops[i];
      if (o.t === 'end' && o.name === 'SELECT_END') break;
      if (o.t === 'case') cases.push(o);
      i++;
    }
    const after = i; // index of SELECT_END (pc++ then moves past it)
    const picked = await this.host.select(cases.map((c) => ({ text: c.text })), color);
    const c = cases[picked];
    this.pc = after;
    if (!c || c.action.length === 0) return;
    const act = c.action;
    return this.command(kw(act[0]), act.slice(1), false, act);
  }

  private async order(args: Arg[]): Promise<Signal> {
    const ops = this.ops;
    const ment: string[] = [];
    let i = this.pc + 1;
    while (i < ops.length) {
      const o = ops[i];
      if (o.t === 'ment') ment.push(o.text);
      else if (o.t === 'end' && o.name === 'ORDER_END') break;
      else break; // unterminated: stop at the first non-quest line
      i++;
    }
    this.state.orders.set(num(args[0]), { title: String(args[1] ?? ''), ment });
    this.pc = i < ops.length && ops[i].t === 'end' ? i : i - 1;
  }

  private async shop(name: string, args: Arg[]): Promise<Signal> {
    const ops = this.ops;
    const list: number[] = [];
    const endName = SHOP_END[name as ShopKind];
    let i = this.pc + 1;
    while (i < ops.length) {
      const o = ops[i];
      if (o.t === 'list') list.push(o.n);
      else if (o.t === 'nums') {
        // colour triples; not needed by the UI
      } else if (o.t === 'end' && o.name === endName) break;
      else {
        i--; // body continues here
        break;
      }
      i++;
    }
    this.pc = Math.min(i, ops.length - 1);
    await this.host.shop(name as ShopKind, String(args[0] ?? ''), list);
  }
}
