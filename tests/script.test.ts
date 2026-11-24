import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEvt } from '../src/script/parser';
import { EvtInterpreter, ScriptHost } from '../src/script/interpreter';
import { StoryState } from '../src/script/state';

const read = (f: string) => readFileSync(new URL(`../public/assets/scripts/${f}`, import.meta.url), 'utf8');

test('all four scripts parse; leftovers are developer notes, never commands', () => {
  for (const f of ['sam.evt', 'under.evt', 'multi1.evt', 'multi2.evt']) {
    const evt = parseEvt(read(f));
    assert.ok(evt.blocks.length > 20, `${f} has blocks`);
    assert.ok(evt.warnings.length < 150, `${f}: ${evt.warnings.length} stray lines`);
    assert.ok(!evt.warnings.some((w) => /"@|"CASE|"LIST|"MENT/.test(w)), `${f}: command-looking line skipped`);
  }
});

function mockHost(choices: number[]) {
  const log: string[] = [];
  let ci = 0;
  const host: ScriptHost = {
    clear: () => void log.push('clear'),
    talk: (t) => void log.push('talk:' + t),
    setBox: () => {},
    setColor: () => {},
    setFace: () => {},
    waitKey: async () => void log.push('wait'),
    select: async (cs) => {
      log.push('select:' + cs.map((c) => c.text).join('|'));
      return Math.min(choices[ci++] ?? cs.length - 1, cs.length - 1); // then keep choosing the last entry (usually "Exit")
    },
    shop: async (k, p, l) => void log.push(`shop:${k}:${l.length}`),
    play: (s) => void log.push('play:' + s),
    effect: (n, a) => void log.push(`fx:${n}:${a.join(',')}`),
    warn: (m) => void log.push('WARN ' + m),
  };
  return { host, log };
}

test('blacksmith: greeting, menu, leave', async () => {
  const evt = parseEvt(read('sam.evt'));
  const smith = evt.blocks.find((b) => b.name === 'Blacksmith')!;
  const st = new StoryState();
  const { host, log } = mockHost([4]); // "Exit"
  const res = await new EvtInterpreter(evt, smith, st, host).run();
  assert.equal(res.reason, 'END');
  assert.ok(log.some((l) => l.startsWith('talk:Do you need any Weapons')));
  assert.ok(log.some((l) => l.startsWith('select:Select weapon|Sell weapon|Repair weapon|Talk|Exit')));
  assert.ok(!log.some((l) => l.startsWith('WARN')), log.filter((l) => l.startsWith('WARN')).join('\n'));
});

test('every block runs to completion on first-choice and last-choice walks without errors', async () => {
  for (const f of ['sam.evt', 'under.evt', 'multi1.evt', 'multi2.evt']) {
    const evt = parseEvt(read(f));
    for (const b of evt.blocks) {
      for (const pick of [0, 1, 3]) {
        const st = new StoryState();
        st.money = 100000;
        const { host, log: warns } = mockHost(new Array(40).fill(pick));
        const res = await new EvtInterpreter(evt, b, st, host, 20000).run();
        void warns;
        assert.notEqual(res.reason, 'ERROR', `${f} ${b.name}#${b.id} @${b.line} pick ${pick}: ${res.message}`);
      }
    }
  }
});

test('conditions, flags, items and quests', async () => {
  const evt = parseEvt(
    [
      '# 1', '# 1', '# 1', '# "T"', '# FLOW', '# 100',
      '@ IF ITEM HAVE 5 && NUM NOTHAVE 9 THEN GO_DOWN YES',
      '@ TALK "no"', '@ END',
      '* YES', '@ GIVE NUM 9', '@ REMOVE ITEM 5', '@ GIVE MONEY 50',
      '@ ORDER 7 "Fetch"', 'MENT "a"', 'MENT "b"', 'ORDER_END', '@ TALK "yes"', '@ END',
    ].join('\n'),
  );
  const st = new StoryState();
  st.giveItem(5);
  const { host, log } = mockHost([]);
  await new EvtInterpreter(evt, evt.blocks[0], st, host).run();
  assert.deepEqual(log, ['talk:yes']);
  assert.ok(st.flags.has(9) && st.itemCount(5) === 0 && st.money === 50);
  assert.deepEqual(st.orders.get(7), { title: 'Fetch', ment: ['a', 'b'] });
});
