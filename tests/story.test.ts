import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEvt, EvtBlock, EvtFile } from '../src/script/parser';
import { EvtInterpreter, ScriptHost } from '../src/script/interpreter';
import { StoryState } from '../src/script/state';
import { SHARED_QUEST_FLAGS, shiftMapNumbers, UNDERWORLD_OFFSET } from '../src/script/mapnumbers';
import { basicBlockFor, pickBlock } from '../src/game/npcs';
import { parseMapObjects } from '../src/data/mapobjects';

const url = (p: string) => new URL(`../public/assets/${p}`, import.meta.url);
const index = JSON.parse(readFileSync(url('maps/index.json'), 'utf8')) as { id: string }[];

/**
 * A greedy story bot: it talks to every scripted object over and over with different menu answers, with unlimited
 * money, the three heroes and a strong party, and treats every monster a script spawns as killed on the spot (its drop
 * is handed over). If the chain of quests is sound, both endings become reachable. This does not prove the game is
 * winnable by hand (fighting, finding objects) but it catches scripts that can never advance.
 */
export async function runBot(): Promise<{ ends: Set<string>; rounds: number; story: StoryState; visited: Set<string>; files: EvtFile[] }> {
  const files: EvtFile[] = ['sam.evt', 'under.evt'].map((f, i) => {
    const file = parseEvt(readFileSync(url(`scripts/${f}`), 'utf8'));
    return i === 1 ? shiftMapNumbers(file, UNDERWORLD_OFFSET) : file;
  });
  const story = new StoryState();
  [1, 2, 3].forEach((n) => story.flags.add(n));
  story.level = 99;
  for (const k of Object.keys(story.stats) as (keyof typeof story.stats)[]) story.stats[k] = 99;
  for (let k = 1; k <= 12; k++) story.magic.set(k, 1);
  const ends = new Set<string>();
  const visited = new Set<string>();
  let policy = 0;
  let curObject = '';
  let fi = 0;
  let runningExtra = 100;
  const pending: { fi: number; block: EvtBlock }[] = [];
  // items that monsters placed in the map tables carry
  for (const f of index) {
    const raw = JSON.parse(readFileSync(url(`maps/${f.id}.json`), 'utf8')) as { w: number; h: number; trailer: string };
    for (const o of parseMapObjects(Uint8Array.from(Buffer.from(raw.trailer, 'base64')), raw.w, raw.h))
      if (o.cls >= 1 && o.cls <= 47 && o.extra >= 150) story.giveItem(o.extra);
  }
  const host: ScriptHost = {
    clear() {}, talk(t) { if (process.env.BOT_TRACE && curObject === process.env.BOT_TRACE) console.log('  say', t.slice(0, 50)); }, setBox() {}, setColor() {}, setFace() {}, play() {},
    waitKey: async () => {},
    select: async (choices) => {
      const real = choices.map((c, i) => ({ c, i })).filter((x) => x.c.text.trim());
      if (!real.length) return 0;
      return real[(policy === 99 ? real.length - 1 : policy) % real.length].i;
    },
    shop: async (kind, _p, list) => {
      if (kind === 'BUY_ITEM' || kind === 'BUY_WEAPON') for (const id of list) story.giveItem(id);
    },
    canLearnMagic: () => true,
    effect(name, args) {
      const n = args.map(Number);
      if (name === 'GO_END1' || name === 'GO_END2') ends.add(name);
      if (name === 'UNSEAL') story.sealed.delete(n[0]);
      if (name === 'REMOVE_OBJECT') story.removed.add(`${n[0]}:${n[1]}`);
      if (name === 'NEW_OBJECT') story.removed.delete(`${n[0]}:${n[3]}`);
      if (name === 'CHANGE') story.entry.set(curObject, n[0] > 0 ? n[0] : -Math.max(100, runningExtra));
      if (name === 'LOCATE_ITEM') story.giveItem(n[n.length - 1]);
      if (name === 'LOCATE_ENEMY') {
        const drop = n[n.length - 1];
        if (drop >= 150) story.giveItem(drop);
        else if (drop > 0) {
          const ev = files[fi].blocks.find((x) => x.id === drop && x.map === n[0] && x.name.trim() === '');
          if (ev) pending.push({ fi, block: ev });
          else story.giveItem(drop); // a weapon id (the Heaven Bow)
        }
      }
    },
  };
  const run = async (f: number, block: EvtBlock): Promise<void> => {
    fi = f;
    curObject = `${block.map}:${block.object}`;
    if (process.env.BOT_TRACE && curObject === process.env.BOT_TRACE) console.log(`run #${block.id} policy ${policy} flags104=${story.flags.has(104)} 230=${story.itemCount(230)} 249=${story.itemCount(249)}`);
    story.money = 999999;
    let cur = block;
    for (let hops = 0; hops < 3; hops++) {
      visited.add(`${f}:${cur.id}:${cur.map}`);
      runningExtra = cur.extra;
      const res = await new EvtInterpreter(files[f], cur, story, host, 20000).run();
      if (res.reason !== 'BASIC') break;
      const basic = basicBlockFor(files[f].blocks, cur.name, index[cur.map - 1]?.id ?? '', story.year);
      if (!basic) break;
      cur = basic;
    }
  };
  const signature = () =>
    JSON.stringify([[...story.flags].sort(), [...story.items.keys()].sort(), [...story.removed].sort(), ends.size]);
  // group the entries by object
  const objects = new Map<string, { fi: number; block: EvtBlock }[]>();
  files.forEach((file, f) => file.blocks.forEach((block) => block.name.trim() && block.kind && objects.set(`${f}|${block.map}:${block.object}`, [...(objects.get(`${f}|${block.map}:${block.object}`) ?? []), { fi: f, block }])));
  let rounds = 0;
  // the overworld first (sam.evt); after the hellgate the underworld (under.evt) with the shared quest flags cleared
  for (const phase of [0, 1]) {
  if (phase === 1) for (const f of SHARED_QUEST_FLAGS) story.flags.delete(f);
  // the clock runs from the start; the bot lets a year pass whenever nothing more happens
  for (let year = phase === 0 ? 100 : 125; year <= 125; year++) {
  story.year = year;
  let last = '';
  while (rounds < 400 && signature() !== last) {
    last = signature();
    rounds++;
    for (const [key, blocks] of objects) {
      const f = Number(key.split('|')[0]);
      if (f !== phase) continue;
      const o = key.split('|')[1];
      // answer "first choice" repeatedly (accept, then hand in) with the other answers mixed in
      for (const p of [0, 0, 0, 1, 0, 2, 0, 3, 0, 99, 0]) {
        policy = p;
        if (story.removed.has(o)) break;
        const pick = pickBlock(blocks, story.entry.get(o) ?? 0, story.year);
        const block = pick?.block ?? basicBlockFor(files[f].blocks, blocks[0].block.name, index[blocks[0].block.map - 1]?.id ?? '', story.year);
        if (!block) break;
        await run(f, block);
        while (pending.length) {
          const q = pending.shift()!;
          await run(q.fi, q.block);
        }
      }
    }
  }
  }
  }
  return { ends, rounds, story, visited, files };
}

test('story bot: talking to every scripted object repeatedly reaches both endings', async () => {
  const { ends, rounds, story } = await runBot();
  console.log(`rounds ${rounds}, flags ${story.flags.size}, items ${story.items.size}, orders ${story.orders.size}, ends ${[...ends]}`);
  assert.ok(ends.has('GO_END1'), 'the hellgate (GO_END1) is never reached');
  assert.ok(ends.has('GO_END2'), 'the final scene (GO_END2) is never reached');
});
