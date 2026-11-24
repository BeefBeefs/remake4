/**
 * Parser for the game's .EVT dialogue / quest scripts (converted to UTF-8 by tools/build_assets.py).
 *
 * The file is ONE flat instruction stream. Six `#` header lines mark an NPC / event entry point
 * (a "block"), but execution simply continues downward and `GO_DOWN` / `GO_UP` search the whole
 * file, which is how every NPC reaches the shared shop routines defined further down.
 *
 * A block starts with:
 *   # <event id>   # <map number, 1-based in world order>   # <object id>
 *   # "<NPC name>"  # BASIC | FLOW   # 100
 * followed by body lines:
 *   @ COMMAND args      command
 *   * label             jump target
 *   CASE "text" GO_DOWN label ... SELECT_END   menu entries (after `@ SELECT r g b`)
 *   LIST n / MENT "text" / 200 0 150 ...       data lines that belong to the preceding shop / quest command
 *   / anything          comment (Korean developer notes)
 */

export type Arg = string | number;

export type Op =
  | { t: 'cmd'; name: string; args: Arg[]; line: number }
  | { t: 'label'; name: string; line: number }
  | { t: 'case'; text: string; action: Arg[]; line: number }
  | { t: 'end'; name: string; line: number } // SELECT_END, ORDER_END, BUY_WEAPON_END, ...
  | { t: 'list'; n: number; line: number }
  | { t: 'ment'; text: string; line: number }
  | { t: 'nums'; values: number[]; line: number };

export interface EvtBlock {
  id: number;
  map: number;
  object: number;
  name: string;
  kind: 'BASIC' | 'FLOW';
  extra: number;
  line: number;
  /** index into EvtFile.ops of this entry point's first instruction */
  start: number;
}

export interface EvtFile {
  blocks: EvtBlock[];
  ops: Op[];
  /** label -> op indexes, in file order (names repeat) */
  labels: Map<string, number[]>;
  warnings: string[];
}

/** typos found in the original scripts */
const ALIASES: Record<string, string> = {
  WATI: 'WAIT',
  CLEAR_BUFFFER: 'CLEAR_BUFFER',
  CLEAR_BUFER: 'CLEAR_BUFFER',
  CLEAR_BUFFER2: 'CLEAR_BUFFER',
  COLKLOR: 'COLOR',
};

const END_WORDS = new Set(['SELECT_END', 'ORDER_END', 'BUY_WEAPON_END', 'BUY_ITEM_END', 'LEARN_MAGIC_END']);

function toArg(tok: string): Arg {
  return /^-?\d+$/.test(tok) ? parseInt(tok, 10) : tok;
}

/** text between the first and the last double quote, or the rest of the line if unquoted */
export function quotedText(s: string): string {
  const a = s.indexOf('"');
  if (a < 0) return s.trim();
  const b = s.lastIndexOf('"');
  return b > a ? s.slice(a + 1, b) : s.slice(a + 1);
}

function tokens(s: string): Arg[] {
  const out: Arg[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1] : toArg(m[2]));
  return out;
}

function parseHeader(lines: string[]): Omit<EvtBlock, 'line' | 'start'> | null {
  const v = lines.map((l) => l.replace(/^#\s*/, '').trim());
  if (v.length < 5) return null;
  const kind = v[4].toUpperCase();
  if (kind !== 'BASIC' && kind !== 'FLOW') return null;
  return {
    id: parseInt(v[0], 10),
    map: parseInt(v[1], 10),
    object: parseInt(v[2], 10),
    name: quotedText(v[3]),
    kind,
    extra: v[5] !== undefined ? parseInt(v[5], 10) : 0,
  };
}

export function parseEvt(text: string): EvtFile {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: EvtBlock[] = [];
  const warnings: string[] = [];
  const ops: Op[] = [];
  const labels = new Map<string, number[]>();
  let cur: EvtBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const s = raw.trim();
    if (!s) continue;

    if (s[0] === '#') {
      const group: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith('#')) group.push(lines[j++].trim());
      const h = parseHeader(group);
      if (h) {
        cur = { ...h, line: i + 1, start: ops.length };
        blocks.push(cur);
      } else warnings.push(`line ${i + 1}: bad header`);
      i = j - 1;
      continue;
    }
    if (!cur) continue; // preamble
    const line = i + 1;

    if (s[0] === '/') continue; // comment
    if (s[0] === '*') {
      const name = s.slice(1).trim();
      const idx = ops.length;
      ops.push({ t: 'label', name, line });
      const arr = labels.get(name);
      if (arr) arr.push(idx);
      else labels.set(name, [idx]);
      continue;
    }
    if (s[0] === '@') {
      const m = /^@\s*(\S+)\s*(.*)$/.exec(s);
      if (!m) continue;
      let name = m[1].toUpperCase();
      name = ALIASES[name] ?? name;
      const rest = m[2];
      ops.push({ t: 'cmd', name, args: name === 'TALK' ? [quotedText(rest)] : tokens(rest), line });
      continue;
    }
    const word = s.split(/\s+/)[0].toUpperCase();
    if (word === 'CASE') {
      const m = /^CASE\s+"(.*)"\s*(.*)$/.exec(s);
      if (m) ops.push({ t: 'case', text: m[1], action: tokens(m[2]), line });
      else {
        const t = tokens(s.slice(4));
        ops.push({ t: 'case', text: String(t[0] ?? ''), action: t.slice(1), line });
      }
    } else if (END_WORDS.has(word)) {
      ops.push({ t: 'end', name: word, line });
    } else if (word === 'LIST') {
      ops.push({ t: 'list', n: parseInt(s.split(/\s+/)[1], 10), line });
    } else if (word === 'MENT') {
      ops.push({ t: 'ment', text: quotedText(s.slice(4)), line });
    } else if (/^\d+(\s+\d+)*$/.test(s)) {
      ops.push({ t: 'nums', values: s.split(/\s+/).map((x) => parseInt(x, 10)), line });
    } else if (/^[=\-\s]+$/.test(s)) {
      // separator art
    } else {
      warnings.push(`line ${line}: unrecognised "${s.slice(0, 40)}"`);
    }
  }
  return { blocks, ops, labels, warnings };
}
