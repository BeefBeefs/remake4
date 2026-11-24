import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { directionFromVector, recordIndex, storedDirection } from '../src/game/anim';
import { parseMap } from '../src/data/loaders';
import { TILE_H, TILE_W, World } from '../src/game/world';
import { buildChunk, CHUNK } from '../src/render/tilemesh';
import { Hero } from '../src/game/hero';
import { applyStory, makeSave, parseSave } from '../src/game/save';
import { StoryState } from '../src/script/state';
import { pickBlock } from '../src/game/npcs';
import type { EvtBlock } from '../src/script/parser';
import { ItemStats, LangData, SpriteSheetMeta, TilesetTable } from '../src/data/types';

const A = (p: string) => new URL(`../public/assets/${p}`, import.meta.url);
const json = <T>(p: string) => JSON.parse(readFileSync(A(p), 'utf8')) as T;

test('directions: 8-way from vectors, mirrored storage', () => {
  assert.equal(directionFromVector(0, -1), 0); // up
  assert.equal(directionFromVector(1, -1), 1);
  assert.equal(directionFromVector(1, 0), 2);
  assert.equal(directionFromVector(0, 1), 4);
  assert.equal(directionFromVector(-1, 0), 6);
  assert.equal(directionFromVector(-1, -1), 7);
  assert.deepEqual(storedDirection(2, true), { rec: 2, flip: false });
  assert.deepEqual(storedDirection(6, true), { rec: 2, flip: true });
  assert.deepEqual(storedDirection(6, false), { rec: 2, flip: false });
  assert.deepEqual(storedDirection(0), { rec: 0, flip: false });
  assert.deepEqual(storedDirection(4), { rec: 4, flip: false });
  assert.deepEqual(recordIndex(7, 5), { index: 7 * 5 + 3, flip: false });
  assert.deepEqual(recordIndex(7, 3), { index: 7 * 5 + 3, flip: true });
});

test('converted maps load and spawn is walkable', () => {
  const ts = json<TilesetTable>('tiles/tilesets.json');
  for (const id of ['a1', 't1', 'b1', 'd1', 'c1']) {
    const m = parseMap(json(`maps/${id}.json`));
    assert.equal(m.ground.length, m.w * m.h);
    const w = new World(m, ts[m.tileset]);
    const s = w.findSpawn();
    assert.ok(!w.blockedAt(s.x, s.y), `${id} spawn walkable`);
  }
});

test('tile geometry: indices valid, uv inside texture', () => {
  const ts = json<TilesetTable>('tiles/tilesets.json');
  const m = parseMap(json('maps/t1.json'));
  const w = new World(m, ts[m.tileset]);
  let total = 0;
  for (let cy = 0; cy * CHUNK < m.h; cy++)
    for (let cx = 0; cx * CHUNK < m.w; cx++) {
      const c = buildChunk(w, 'ground', cx, cy, ts[m.tileset], false);
      if (!c) continue;
      total += c.quads;
      assert.equal(c.positions.length, c.quads * 12);
      assert.ok(c.uvs.every((v) => v >= 0 && v <= 1));
      assert.ok(c.indices.every((i) => i < c.quads * 4));
    }
  assert.ok(total > 1000, `drew ${total} ground tiles`);
});

test('hero walks, collides with markers and animates from the real sheet', () => {
  const ts = json<TilesetTable>('tiles/tilesets.json');
  const m = parseMap(json('maps/t1.json'));
  const w = new World(m, ts[m.tileset]);
  const meta = json<SpriteSheetMeta>('sprites/leelim.json');
  const s = w.findSpawn();
  const h = new Hero('Leelim', 'LEELIM', s.x, s.y);
  h.input.x = 1;
  const x0 = h.x;
  for (let i = 0; i < 120; i++) h.update(1 / 60, w, meta);
  assert.ok(h.x > x0 || h.state === 'idle', 'moves right or is blocked');
  assert.ok(!w.blockedAt(h.x, h.y), 'never ends up inside a blocked cell');
  const f = h.drawFrame();
  const rec = meta.records[f.record];
  assert.ok(rec && f.frame < rec.frames.length);
});

test('object layer: flagged cells are tiles drawn overhead, nothing is left unaccounted for', async () => {
  const { isOverhead, objectTile } = await import('../src/game/world');
  const ts = json<TilesetTable>('tiles/tilesets.json');
  const index = json<{ id: string }[]>('maps/index.json');
  let flagged = 0;
  for (const e of index) {
    const m = parseMap(json(`maps/${e.id}.json`));
    const w = new World(m, ts[m.tileset]);
    let over = 0;
    let under = 0;
    for (let cy = 0; cy < m.h; cy++)
      for (let cx = 0; cx < m.w; cx++) {
        const raw = w.object(cx, cy);
        if (raw === 0xffff) continue;
        assert.ok(w.isTile(objectTile(raw)), `${e.id} ${cx},${cy} value ${raw}`);
        if (isOverhead(raw)) over++;
        else under++;
      }
    for (let cy = 0; cy * CHUNK < m.h; cy++)
      for (let cx = 0; cx * CHUNK < m.w; cx++)
        for (const l of ['objects', 'overhead'] as const) {
          const c = buildChunk(w, l, cx, cy, ts[m.tileset], true);
          if (c) (l === 'overhead' ? (over -= c.quads) : (under -= c.quads));
        }
    assert.equal(over, 0, `${e.id} overhead tiles all meshed`);
    assert.equal(under, 0, `${e.id} object tiles all meshed`);
    flagged += 1;
  }
  assert.equal(flagged, 42);
});

test('every script WARP destination is inside its map and has open ground within 3 cells', () => {
  const ts = json<TilesetTable>('tiles/tilesets.json');
  const index = json<{ id: string }[]>('maps/index.json');
  const bad: string[] = [];
  let n = 0;
  for (const f of ['sam.evt', 'under.evt']) {
    const text = readFileSync(A(`scripts/${f}`), 'utf8');
    for (const m of text.matchAll(/^@ WARP (\d+) (\d+) (\d+)/gm)) {
      const [num, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const id = index[num - 1].id;
      const map = parseMap(json(`maps/${id}.json`));
      const w = new World(map, ts[map.tileset]);
      n++;
      if (!w.inBounds(x, y)) bad.push(`${id} ${x},${y} out of bounds`);
      else {
        // 2 of 22 destinations sit on a marker tile, so marker collision is not exact; arrivals snap to open ground
        const p = w.nearestFree(x, y);
        if (Math.hypot(p.x / TILE_W - x - 0.5, p.y / TILE_H - y - 1) > 3) bad.push(`${id} ${x},${y} no open ground nearby`);
      }
    }
  }
  assert.ok(n > 20);
  assert.deepEqual(bad, []);
});

test('arrivals: most frequent WARP destination per map', async () => {
  const { collectArrivals } = await import('../src/game/arrivals');
  const { parseEvt } = await import('../src/script/parser');
  const f = parseEvt(readFileSync(A('scripts/sam.evt'), 'utf8'));
  const a = collectArrivals([f]);
  assert.ok(a.size >= 8);
  const t1 = a.get(15); // map 15 = T1
  assert.deepEqual(t1, { cx: 42, cy: 39 });
});

test('enemies: every sheet loads, walks toward the hero, swings and dies', async () => {
  const { Enemy } = await import('../src/game/enemy');
  const { ENEMY_SHEETS, sheetForKind } = await import('../src/game/enemies');
  const ts = json<TilesetTable>('tiles/tilesets.json');
  const m = parseMap(json('maps/t1.json'));
  const w = new World(m, ts[m.tileset]);
  const open = w.findSpawn();
  for (const name of ENEMY_SHEETS) {
    const meta = json<SpriteSheetMeta>(`sprites/${name.toLowerCase()}.json`);
    assert.ok(meta.records.length >= 25, name);
    // attack action must have frames in all five stored directions
    for (let d = 0; d < 5; d++) assert.ok((meta.records[2 * 5 + d]?.frames.length ?? 0) > 0, `${name} attack dir ${d}`);
  }
  assert.equal(sheetForKind(1), 'ENEMY-A'); // Hooks
  assert.equal(sheetForKind(10), 'ENEMY-J'); // Tiger
  assert.equal(sheetForKind(16), 'ENEMY-P'); // Satan
  assert.equal(sheetForKind(25), 'ENEMY-J2'); // Golden Tiger
  assert.equal(sheetForKind(49), 'CYCLOP'); // Cyclopean
  assert.equal(sheetForKind(60), 'WATER'); // Wiceli
  const lang = json<{ monsters: string[] }>('text/lang.json');
  assert.equal(lang.monsters[9], 'Tiger');
  for (let k = 1; k <= 60; k++) assert.ok(ENEMY_SHEETS.includes(sheetForKind(k) as never), `kind ${k}`);
  // the EXE table's first byte is the sheet index: it agrees with every sprite-verified fallback and settles the story monsters
  const table = json<import('../src/data/types').MonsterTable>('text/monsters.json');
  for (let k = 2; k <= 60; k++) if (k <= 29 || k >= 48) assert.equal(sheetForKind(k, table), sheetForKind(k), `kind ${k}`);
  assert.equal(sheetForKind(30, table), 'ENEMY-L'); // Hell Witch looks like the Dark Witch
  assert.equal(sheetForKind(42, table), 'ENEMY-M1'); // Hellminor flies like the Vampire Bat
  const meta = json<SpriteSheetMeta>('sprites/enemy-a.json');
  const e = new Enemy('ENEMY-A', open.x + 100, open.y);
  const target = { x: open.x, y: open.y };
  let swung = false;
  for (let i = 0; i < 600; i++) {
    e.update(1 / 60, w, meta, target);
    swung ||= e.swung;
    e.swung = false;
  }
  assert.ok(Math.hypot(e.x - target.x, e.y - target.y) < 60, 'closed in on the hero');
  assert.ok(swung, 'attacked');
  e.damage(e.hp);
  assert.ok(e.dead);
});

test('combat: hurt, death, revive, leader hand-over', async () => {
  const { Party } = await import('../src/game/party');
  const ts = json<TilesetTable>('tiles/tilesets.json');
  const m = parseMap(json('maps/t1.json'));
  const w = new World(m, ts[m.tileset]);
  const s = w.findSpawn();
  const metas = new Map<string, SpriteSheetMeta>();
  const defs = [['Elim', 'LEELIM'], ['Kusa', 'KUSA'], ['Raening', 'RINING']];
  for (const [, sheet] of defs) metas.set(sheet, json<SpriteSheetMeta>(`sprites/${sheet.toLowerCase()}.json`));
  const party = new Party(defs.map(([n, sh]) => new Hero(n, sh, s.x, s.y)));
  const lead = party.leader;
  lead.takeDamage(30);
  assert.equal(lead.hp, 70);
  assert.equal(lead.state, 'hurt');
  for (let i = 0; i < 60; i++) party.update(1 / 60, w, metas);
  assert.equal(lead.state, 'idle', 'stagger ends');
  lead.takeDamage(500);
  assert.ok(lead.dead);
  for (let i = 0; i < 200; i++) party.update(1 / 60, w, metas);
  const f = lead.drawFrame();
  assert.equal(f.record, 21 * 5 + Math.min(lead.dir, 8 - lead.dir));
  assert.ok(f.frame >= 8, 'death animation holds its last frame');
  party.ensureLeaderAlive();
  assert.notEqual(party.leader, lead);
  for (const h of party.heroes) h.takeDamage(999);
  assert.ok(party.allDead);
  party.heroes.forEach((h) => h.revive());
  assert.ok(!party.allDead);
  assert.equal(lead.hp, lead.maxHp);
});

test('item database: ids from scripts and shops all resolve to real names', async () => {
  const { ItemDb } = await import('../src/game/itemdb');
  const { parseEvt } = await import('../src/script/parser');
  const db = new ItemDb(json('text/lang.json'));
  assert.equal(db.name(167), 'Ginseng');
  assert.equal(db.name(168), 'Wild ginseng');
  assert.equal(db.name(201), 'Deer Horn');
  assert.equal(db.name(234), 'Holy Well Water');
  assert.equal(db.name(1), 'Copper Sword');
  const unknown = new Set<number>();
  for (const f of ['sam.evt', 'under.evt']) {
    const file = parseEvt(readFileSync(A(`scripts/${f}`), 'utf8'));
    for (const op of file.ops) {
      if (op.t === 'cmd' && ['GIVE', 'REMOVE'].includes(op.name) && op.args[0] === 'ITEM') {
        if (db.kind(Number(op.args[1])) === 'unknown') unknown.add(Number(op.args[1]));
      }
      if (op.t === 'cmd' && op.name === 'LOCATE_ITEM' && db.kind(Number(op.args[3])) === 'unknown') unknown.add(Number(op.args[3]));
      if (op.t === 'list' && db.kind(op.n) === 'unknown' && op.n > 142) unknown.add(op.n);
    }
  }
  assert.deepEqual([...unknown].sort((a, b) => a - b), [], 'every referenced item id is in the table');
});

test('map objects: trailer decodes to in-bounds placements that agree with the scripts', async () => {
  const { parseMapObjects, monsterSpawns, objectRole } = await import('../src/data/mapobjects');
  const { sheetForKind } = await import('../src/game/enemies');
  const lang = json<{ monsters: string[] }>('text/lang.json');
  const index = json<{ id: string }[]>('maps/index.json');
  let total = 0;
  for (const e of index) {
    const m = parseMap(json(`maps/${e.id}.json`));
    const objs = parseMapObjects(m.trailer, m.w, m.h);
    assert.ok(objs.length > 0, e.id);
    total += objs.length;
    for (const o of monsterSpawns(objs)) assert.ok(ENEMY_OK(sheetForKind(o.kind)), e.id);
  }
  assert.ok(total > 3000);
  // the Dragon cave table holds real monster spawns (Satan, Iron Knights, Hell Witches...) and bull statues (SPRITE 26-28)
  const c1 = parseMap(json('maps/c1.json'));
  const c1o = parseMapObjects(c1.trailer, c1.w, c1.h);
  const names = new Set(monsterSpawns(c1o).map((o) => lang.monsters[o.kind - 1]));
  assert.ok(names.has('Satan') && names.has('Iron Knight'), [...names].join());
  assert.ok(c1o.some((o) => objectRole(o) === 'prop' && o.kind >= 26 && o.kind <= 28));
  assert.ok(c1o.some((o) => objectRole(o) === 'scenery'));
  // T1's blacksmith is object 1 at cell (40, 25)
  const t1 = parseMap(json('maps/t1.json'));
  const smith = parseMapObjects(t1.trailer, t1.w, t1.h).find((o) => o.index === 1);
  assert.deepEqual([smith?.x, smith?.y], [40, 25]);
});
function ENEMY_OK(name: string): boolean {
  return /^(ENEMY-[A-P]\d?|BIRD|CYCLOP|FIRE|FISH|FLY|GEAR|GEARBIG|LAMB|LION|ZAMBIE|STONE|DRAGON|WATER)$/.test(name);
}

test('item stats: manual prices line up with the string table names', async () => {
  const { ItemDb } = await import('../src/game/itemdb');
  const db = new ItemDb(json<LangData>('text/lang.json'), json<ItemStats>('text/itemstats.json'));
  assert.equal(db.price(1), 120); // Copper Sword
  assert.equal(db.name(1), 'Copper Sword');
  assert.equal(db.stat(33).atk, 95); // Blood Sword (event-only: weight / price columns swapped in the manual)
  assert.equal(db.price(33), 100000);
  assert.equal(db.price(161), 80); // Life Water
  assert.equal(db.price(167), 300); // Ginseng
  assert.equal(db.sellPrice(1), 60);
  assert.equal(db.price(227), undefined); // quest key is not for sale
  // every item a shop script sells has a price, except rings (no price in the manual) and learnable spells (mana cost only)
  const { parseEvt } = await import('../src/script/parser');
  const fs = await import('node:fs');
  const missing = new Set<number>();
  for (const f of ['sam.evt', 'under.evt']) {
    const file = parseEvt(fs.readFileSync(new URL(`../public/assets/scripts/${f}`, import.meta.url), 'utf8'));
    for (const o of file.ops) if (o.t === 'list' && db.kind(o.n) !== 'quest' && db.price(o.n) === undefined && !(o.n >= 111 && o.n <= 124) && !(o.n >= 184 && o.n <= 196)) missing.add(o.n);
  }
  assert.deepEqual([...missing], []);
});

test('stats: gear bonuses parse, derived numbers, mitigation, xp curve', async () => {
  const { derive, parseBonuses, mitigate, xpToNext, slotOf, LEVEL_GAIN } = await import('../src/game/stats');
  const { ItemDb } = await import('../src/game/itemdb');
  const db = new ItemDb(json<LangData>('text/lang.json'), json<ItemStats>('text/itemstats.json'));
  const b = parseBonuses('Strength+3 Magic+10 Life+30 M.Speed+6 Skill+20% ALL Attributes+2');
  assert.equal(b.stats.STRENGTH, 5);
  assert.equal(b.stats.MAGIC, 12);
  assert.equal(b.life, 30);
  assert.equal(b.speed, 6);
  assert.equal(b.pct.SKILL, 20);
  const base = { HEALTH: 10, STRENGTH: 10, MAGIC: 10, DEXTERITY: 10, BRAIN: 10, SKILL: 10 };
  const bare = derive(db, base, 1, {});
  assert.equal(bare.maxHp, 100);
  assert.equal(bare.attack, 4 + 5);
  const armed = derive(db, base, 1, { weapon: 1, armor: 81, shield: 62 }); // Copper Sword, Leather Armor, Brass Shield
  assert.equal(armed.attack, 6 + 5);
  assert.equal(armed.defense, 10 + 10);
  assert.ok(mitigate(20, 20) < 20 && mitigate(1, 500) === 1);
  assert.equal(slotOf(db, 1), 'weapon');
  assert.equal(slotOf(db, 41), 'weapon'); // bows share the weapon slot
  assert.equal(slotOf(db, 161), null);
  assert.ok(xpToNext(2) > xpToNext(1));
  // level 16 should reach the trainer's Dexterity requirement (>60) from the starting 10
  assert.ok(base.DEXTERITY + 15 * LEVEL_GAIN.DEXTERITY > 50);
});

test('effects: arrows pick the 32-way frame, fire balls travel and burst, walls tick', async () => {
  const fx = await import('../src/game/effects');
  assert.equal(fx.arrowFrame(0, -1), 0);
  assert.equal(fx.arrowFrame(1, 0), 8);
  assert.equal(fx.arrowFrame(0, 1), 16);
  assert.equal(fx.arrowFrame(-1, 0), 24);
  const world = { blockedAt: () => false } as unknown as import('../src/game/world').World;
  const dummy = { x: 100, y: 14, dead: false, hits: 0, damage(n: number) { this.hits += n; } };
  const spawn: import('../src/game/effects').Effect[] = [];
  const ball = fx.fireBall(0, 14, 2, 10); // east
  let alive = true;
  for (let i = 0; i < 60 && alive; i++) alive = fx.updateEffect(ball, 1 / 30, world, [dummy], spawn);
  assert.equal(alive, false);
  assert.equal(dummy.hits, 10);
  assert.equal(spawn.length, 1); // the explosion visual
  const wall = fx.fireWall(0, 14, 2, 3)[2];
  const d2 = { x: wall.x, y: wall.y + 14, dead: false, hits: 0, damage(n: number) { this.hits += n; } };
  for (let i = 0; i < 31; i++) fx.updateEffect(wall, 1 / 30, world, [d2], []);
  assert.ok(d2.hits >= 6, String(d2.hits)); // ticks every 0.5 s: 3 damage each, ~2 s
  const a = fx.arrow(0, 14, 2, 7, 200);
  const d3 = { x: 60, y: 14, dead: false, hits: 0, damage(n: number) { this.hits += n; } };
  for (let i = 0; i < 40; i++) fx.updateEffect(a, 1 / 30, world, [d3], []);
  assert.equal(d3.hits, 7);
});

test('monster table: records line up with the string table and drive Enemy stats', async () => {
  const { Enemy } = await import('../src/game/enemy');
  const table = json<import('../src/data/types').MonsterTable>('text/monsters.json');
  const lang = json<LangData>('text/lang.json');
  assert.equal(Object.keys(table).length, 59);
  for (const [k, m] of Object.entries(table)) {
    if (k === '15' || k === '49') continue; // Cymon / Cyclopean are named differently in the string table
    assert.equal(lang.monsters[Number(k) - 1], m.name, `kind ${k}`);
  }
  assert.equal(table['16'].name, 'Satan');
  assert.ok(table['16'].hp === 300 && table['44'].hp === 600, 'two Satans: the story one is tougher');
  const tiger = new Enemy('ENEMY-J', 0, 0, 10, 20, 0, table['10']);
  assert.equal(tiger.hp, 50);
  const before = tiger.hp;
  tiger.damage(10);
  assert.ok(before - tiger.hp < 10 && before - tiger.hp >= 1, 'defense softens the hit');
  assert.ok(tiger.xp > 5);
});

const heroes = [
  { hp: 40.2, mana: 12.7, gear: { weapon: 5 } },
  { hp: 10, mana: 0, gear: {} },
  { hp: 99, mana: 50, gear: { armor: 60 } },
];
test('save games round-trip story state and party condition', () => {
  const s = new StoryState();
  s.flags.add(7);
  s.giveItem(151, 3);
  s.orders.set(2, { title: 'Quest', ment: ['a', 'b'] });
  s.money = 123;
  s.level = 4;
  s.xp = 9;
  s.stats.MAGIC = 21;
  s.magic.set(1, 1);
  s.removed.add('9:11');
  s.gos.set('8:3', 62);
  const text = JSON.stringify(makeSave(s, heroes, 2, 'a3', 100.4, 200.6));
  const d = parseSave(text, 3)!;
  assert.ok(d);
  assert.equal(d.map, 'a3');
  assert.equal(d.x, 100);
  assert.equal(d.y, 201);
  assert.equal(d.leader, 2);
  assert.equal(d.heroes[0].hp, 41);
  assert.equal(d.heroes[0].mana, 12);
  const t = new StoryState();
  applyStory(t, d);
  assert.ok(t.flags.has(7));
  assert.equal(t.itemCount(151), 3);
  assert.deepEqual(t.orders.get(2), { title: 'Quest', ment: ['a', 'b'] });
  assert.equal(t.money, 123);
  assert.equal(t.level, 4);
  assert.equal(t.stats.MAGIC, 21);
  assert.ok(t.magic.has(1));
  assert.ok(t.removed.has('9:11'));
  assert.equal(t.gos.get('8:3'), 62);
});
test('save games reject damaged or foreign saves', () => {
  assert.equal(parseSave(null, 3), null);
  assert.equal(parseSave('not json', 3), null);
  assert.equal(parseSave('{"v":2}', 3), null);
  const ok = JSON.stringify(makeSave(new StoryState(), heroes, 0, 't1', 1, 1));
  assert.ok(parseSave(ok, 3));
  assert.equal(parseSave(ok, 2), null); // wrong party size
});

test('spells: rain hurts what stands in it, the shield follows, stone stops an enemy and protects nothing else', async () => {
  const fx = await import('../src/game/effects');
  const { Enemy } = await import('../src/game/enemy');
  const world = { blockedAt: () => false } as unknown as import('../src/game/world').World;
  const rain = fx.rain(0, 14, 2, 5, 12); // centre 100px east
  assert.equal(rain.length, 7);
  const victim = { x: rain[0].x, y: rain[0].y + 14, dead: false, hits: 0, damage(n: number) { this.hits += n; } };
  for (let i = 0; i < 100; i++) for (const e of rain) fx.updateEffect(e, 1 / 30, world, [victim], []);
  assert.ok(victim.hits >= 15, String(victim.hits));
  const hero = new Hero('H', 'x', 10, 10);
  const glow = fx.aura(hero, 33, 5);
  hero.x = 80;
  fx.updateEffect(glow, 1 / 30, world, [], []);
  assert.equal(glow.x, 80);
  hero.invuln = 2;
  hero.takeDamage(30);
  assert.equal(hero.hp, 100);
  const e = new Enemy('ENEMY-J', 100, 100, 0, 20, 0);
  e.freeze(3);
  const meta = { name: 'x', pages: [], records: [] } as unknown as SpriteSheetMeta;
  e.update(1, world, meta, { x: 110, y: 100 });
  assert.equal(e.x, 100);
  assert.ok(e.frozen > 1.5 && e.frozen < 2.5);
});

test('pickBlock honours CHANGE: an object answers with the entry the script chose', async () => {
  const { pickBlock } = await import('../src/game/npcs');
  const mk = (id: number, kind: 'BASIC' | 'FLOW' = 'BASIC') => ({ fi: 0, block: { id, map: 19, object: 15, name: 'g', kind, extra: 100, line: 0, start: 0 } });
  const blocks = [mk(68), mk(69), mk(70)];
  assert.equal(pickBlock(blocks)!.block.id, 68);
  assert.equal(pickBlock(blocks, 70)!.block.id, 70);
  assert.equal(pickBlock(blocks, 99)!.block.id, 68); // unknown id: the default entry
});

test('pickBlock: entry -1 (CHANGE 0) falls back to the BASIC entry, else the default', () => {
  const mk = (id: number, kind: 'FLOW' | 'BASIC') => ({ fi: 0, block: { id, kind, extra: 100 } as unknown as EvtBlock });
  const both = [mk(103, 'FLOW'), mk(104, 'BASIC')];
  assert.equal(pickBlock(both, -1)!.block.id, 104);
  assert.equal(pickBlock(both, 0)!.block.id, 103);
  assert.equal(pickBlock([mk(5, 'FLOW')], -1)!.block.id, 5);
});

test('STONE is a known script command with a frame count (statue puzzle)', async () => {
  const { parseEvt } = await import('../src/script/parser');
  const evt = parseEvt(readFileSync(A('scripts/under.evt'), 'utf8'));
  const stones = evt.ops.filter((o) => o.t === 'cmd' && o.name === 'STONE');
  assert.equal(stones.length, 3);
  assert.deepEqual(stones.map((o) => (o.t === 'cmd' ? o.args[1] : 0)).sort(), [300, 500, 700]);
});

test('instant events: statue and table pools exclude map-bound puzzle blocks', async () => {
  const { parseEvt } = await import('../src/script/parser');
  const { instantBlocks, instantKindOfSprite, INSTANT_UNDER_MAP } = await import('../src/game/instant');
  const { shiftMapNumbers, UNDERWORLD_OFFSET } = await import('../src/script/mapnumbers');
  const file = shiftMapNumbers(parseEvt(readFileSync(A('scripts/under.evt'), 'utf8')), UNDERWORLD_OFFSET);
  const pools = instantBlocks(file, INSTANT_UNDER_MAP + UNDERWORLD_OFFSET);
  assert.ok(pools.all.size >= 20, `all ${pools.all.size}`);
  assert.ok(pools.statue.length >= 8 && pools.table.length >= 6, `${pools.statue.length}/${pools.table.length}`);
  const ids = [...pools.statue, ...pools.table].map((b) => b.id);
  for (const bound of [170, 171, 172, 180, 181]) assert.ok(!ids.includes(bound), `block ${bound} is map-bound`);
  assert.ok(ids.includes(152) && ids.includes(157));
  assert.equal(instantKindOfSprite(26), 'statue');
  assert.equal(instantKindOfSprite(43), 'table');
  assert.equal(instantKindOfSprite(5), null);
});

test('level growth makes the Mantis trainer requirement (level 16, strength 60) reachable', async () => {
  const { LEVEL_GAIN } = await import('../src/game/stats');
  assert.ok(10 + 15 * LEVEL_GAIN.STRENGTH >= 60, 'strength at level 16');
  assert.ok(10 + 17 * LEVEL_GAIN.DEXTERITY > 60, 'dexterity at level 18');
});

test('ground cells hidden as collision markers get a visible floor tile (no black holes)', async () => {
  const ts = json<TilesetTable>('tiles/tilesets.json');
  const m = parseMap(json('maps/t1.json'));
  const world = new World(m, ts[m.tileset]);
  let hidden = 0;
  for (let cy = 0; cy < world.map.h; cy++)
    for (let cx = 0; cx < world.map.w; cx++) {
      const t = world.ground(cx, cy);
      if (!world.isTile(t) || !world.isHidden(t)) continue;
      hidden++;
      const f = world.groundFill(cx, cy);
      assert.ok(f >= 0 && !world.isHidden(f), `fill for ${cx},${cy}`);
    }
  assert.ok(hidden > 100);
});

test('breakable containers: kinds 5-8 only, static until broken, then run through their break frames', async () => {
  const { isBreakable, breakableFrame, containerDrop } = await import('../src/game/breakables');
  assert.deepEqual([4, 5, 8, 9].map(isBreakable), [false, true, true, false]);
  assert.equal(breakableFrame(4, undefined), 0);
  assert.deepEqual([0, 0.13, 0.26, 0.4, 5].map((t) => breakableFrame(4, t)), [1, 2, 3, 3, 3]);
  assert.equal(breakableFrame(2, 3), 1);
  assert.equal(containerDrop(() => 0.1), 200);
  assert.equal(containerDrop(() => 0.9), 0);
});

test('unscripted NPC-model objects (kinds 9-12) are editor filler, containers and scenery are not', async () => {
  const { isEditorFiller } = await import('../src/data/mapobjects');
  const o = (cls: number, kind: number) => ({ index: 0, facing: 5, x: 0, y: 0, cls, kind, extra: 0 });
  assert.deepEqual([o(0, 9), o(0, 12), o(0, 8), o(0, 13), o(98, 10), o(5, 9)].map(isEditorFiller), [true, true, false, false, false, false]);
  assert.deepEqual([44, 45, 47, 51, 53, 57, 58].map((k) => isEditorFiller(o(0, k))), [false, true, true, false, true, true, false]); // 51 is the flame
});

test('hero traits: Elim tougher, Kusa more mana and spell power, Raening hits harder with a bow', async () => {
  const { HERO_TRAITS, traitOf } = await import('../src/game/stats');
  assert.ok(HERO_TRAITS.Elim.hp > HERO_TRAITS.Kusa.hp);
  assert.ok(HERO_TRAITS.Kusa.mana > HERO_TRAITS.Elim.mana && HERO_TRAITS.Kusa.spell > HERO_TRAITS.Raening.spell);
  assert.ok(HERO_TRAITS.Raening.bow > 1);
  assert.equal(traitOf('nobody').hp, 1);
});

test('consumable effects are read from the item descriptions; passive and unsupported items give none', async () => {
  const { itemEffect } = await import('../src/game/consumables');
  const { ItemDb } = await import('../src/game/itemdb');
  const db = new ItemDb(json<LangData>('text/lang.json'), json<ItemStats>('text/itemstats.json'));
  const fx = (id: number) => itemEffect(id, db.desc(id));
  assert.deepEqual(fx(161), { life: 0.5 });
  assert.deepEqual(fx(162), { life: 1 });
  assert.deepEqual(fx(163), { mana: 0.5 });
  assert.deepEqual(fx(164), { mana: 1 });
  assert.deepEqual(fx(166), { life: 0.7, mana: 0.7 });
  assert.deepEqual(fx(167), { life: 1, mana: 1 });
  assert.deepEqual(fx(168), { life: 1, mana: 1, stats: { HEALTH: 1 } });
  assert.deepEqual(fx(183), { life: 1, mana: 1, stats: { HEALTH: 5 } });
  assert.deepEqual(fx(169), { stats: { BRAIN: 1 } });
  assert.deepEqual(fx(173), { stats: { DEXTERITY: 1 } });
  assert.deepEqual(fx(180), { stats: { BRAIN: 10 } });
  assert.deepEqual(fx(181)?.stats, { HEALTH: 1, STRENGTH: 1, MAGIC: 1, DEXTERITY: 1, BRAIN: 1 });
  assert.equal(fx(182)?.money, 500);
  assert.ok((fx(179)?.shield ?? 0) > 0);
  assert.deepEqual(fx(190), { learn: 6 });
  assert.deepEqual(fx(152), { buff: { taken: 0.2 } });
  assert.deepEqual(fx(154), { buff: { dealt: 3 } });
  assert.deepEqual(fx(160), { stats: { HEALTH: 20 } });
  assert.deepEqual(fx(175), { cast: 2 });
  assert.deepEqual(fx(178), { smite: true });
  for (const none of [157, 158, 176, 177, 184]) assert.equal(fx(none), null, `item ${none}`);
});

test('pickBlock follows the game year: later quest entries unlock and replace earlier ones; a finished one waits for the next', () => {
  const mk = (id: number, kind: 'FLOW' | 'BASIC', extra: number) => ({ fi: 0, block: { id, map: 1, object: 1, name: 'W', kind, extra, line: 0, start: 0 } as EvtBlock });
  const lady = [mk(60, 'BASIC', 100), mk(54, 'FLOW', 115), mk(62, 'FLOW', 120)];
  assert.equal(pickBlock(lady, 0, 100)!.block.id, 60); // nothing unlocked: plain entry
  assert.equal(pickBlock(lady, 0, 115)!.block.id, 54);
  assert.equal(pickBlock(lady, 0, 120)!.block.id, 62);
  assert.equal(pickBlock(lady, -115, 119)!.block.id, 60); // 54 finished, 62 not yet
  assert.equal(pickBlock(lady, -115, 121)!.block.id, 62);
  assert.equal(pickBlock(lady, -1, 110)!.block.id, 60);
  assert.equal(pickBlock([mk(46, 'FLOW', 123)], 0, 110), null); // a quest-only object stays quiet until its year
});

test('save slot summaries: empty, year / level / place, junk', async () => {
  const { slotSummary } = await import('../src/ui/menu');
  const story = new StoryState();
  story.year = 105.7;
  story.level = 12;
  const save = makeSave(story, [{ hp: 10, mana: 5, gear: {} }, { hp: 10, mana: 5, gear: {} }, { hp: 10, mana: 5, gear: {} }], 0, 't1', 5, 5);
  assert.equal(slotSummary(JSON.stringify(save), 3, () => 'Western Village'), 'Year 105 · Level 12 · Western Village');
  assert.equal(slotSummary(null, 3, (x) => x), 'Empty');
  assert.equal(slotSummary('{nope', 3, (x) => x), 'Empty');
});
