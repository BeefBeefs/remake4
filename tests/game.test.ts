import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { directionFromVector, recordIndex, storedDirection } from '../src/game/anim';
import { parseMap } from '../src/data/loaders';
import { World } from '../src/game/world';
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
  assert.deepEqual(recordIndex(7, 5), { index: 7 * 5 + 3, flip: true });
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
