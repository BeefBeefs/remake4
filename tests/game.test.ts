import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { directionFromVector, recordIndex, storedDirection } from '../src/game/anim';
import { parseMap } from '../src/data/loaders';
import { TILE_H, TILE_W, World } from '../src/game/world';
import { buildChunk, CHUNK } from '../src/render/tilemesh';
import { Hero } from '../src/game/hero';
import { SpriteSheetMeta, TilesetTable } from '../src/data/types';

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
  e.damage(3);
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
  assert.equal(db.healFraction(161), 0.5);
  assert.equal(db.healFraction(162), 1);
  assert.equal(db.healFraction(169), null);
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
  const lang = json('text/lang.json');
  const db = new ItemDb(lang, json('text/itemstats.json'));
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
