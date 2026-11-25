import { AudioPlayer } from './game/audio';
import { collectArrivals } from './game/arrivals';
import { Enemy } from './game/enemy';
import { ENEMY_SHEETS, sheetForKind } from './game/enemies';
import { Hero } from './game/hero';
import { isEditorFiller, MapObject, monsterSpawns, objectRole, parseMapObjects } from './data/mapobjects';
import { basicBlockFor, npcSpriteRecord, pickBlock } from './game/npcs';
import { findPickup, GroundItem } from './game/ground';
import { ItemDb } from './game/itemdb';
import { directionFromVector } from './game/anim';
import { arrow, aura, Effect, effectFrame, fireBall, fireWall, ghostBolt, lightning, rain, shell, updateEffect, visual } from './game/effects';
import { parseCheat } from './game/cheats';
import { encumbrance, partyLoad } from './game/weight';
import { repair as repairItem, repairCost, wearChance, wearOut, workingGear, durabilityLeft, maxDurability } from './game/durability';
import { autoSpread, carryCapacity, derive, ignoreChance, mitigate, POINTS_PER_LEVEL, Slot, slotOf, traitOf, xpToNext } from './game/stats';
import { InventoryUI } from './ui/inventory';
import { advanceYear } from './game/clock';
import { Buff, BUFF_SECONDS, ItemEffect, itemEffect } from './game/consumables';
import { QuestLog } from './ui/quests';
import { GameMenu } from './ui/menu';
import { Minimap } from './ui/minimap';
import { setMenuArt } from './ui/artbutton';
import { GAME_TRACKS, MoviePlayer, showSlides, showTitle, WorldMapUI } from './ui/overlays';
import { Party } from './game/party';
import { applyStory, makeSave, parseSave, SAVE_KEY, SaveData } from './game/save';
import { TILE_H, TILE_W, World } from './game/world';
import { assetUrl, loadItemStats, loadLang, loadMonsters, loadMap, loadMapIndex, loadSpriteMeta, loadText, loadTilesets } from './data/loaders';
import { MapIndexEntry, SpriteSheetMeta, TilesetTable } from './data/types';
import { GameRenderer, SpriteActor, VIEW_H, VIEW_W } from './render/renderer';
import { Arg, EvtBlock, EvtFile, parseEvt } from './script/parser';
import { EvtInterpreter } from './script/interpreter';
import { SHARED_QUEST_FLAGS, shiftMapNumbers, UNDERWORLD_OFFSET } from './script/mapnumbers';
import { breakableFrame, containerDrop, isBreakable } from './game/breakables';
import { INSTANT_UNDER_MAP, InstantKind, instantBlocks, instantKindOfSprite } from './game/instant';
import { StatName, StoryState } from './script/state';
import { DialogueUI } from './ui/dialogue';

/** copper sword, dagger, wooden bow (LANG.GOS weapon ids 1, 4, 41) */
const START_WEAPONS = [1, 4, 41];

const HERO_DEFS = [
  { name: 'Elim', sheet: 'LEELIM' },
  { name: 'Kusa', sheet: 'KUSA' },
  { name: 'Raening', sheet: 'RINING' },
];

const params = new URLSearchParams(location.search);
const FLIP_SIDES = params.get('flip') === '1';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const status = document.getElementById('status')!;
  const dlgEl = document.getElementById('dialogue')!;
  status.textContent = 'loading…';

  const [index, tilesets, files, lang, itemStats, monsterTable] = await Promise.all([
    loadMapIndex(),
    loadTilesets() as Promise<TilesetTable>,
    Promise.all(['sam.evt', 'under.evt'].map(async (f, i) => {
      const file = parseEvt(await loadText(`scripts/${f}`));
      return i === 1 ? shiftMapNumbers(file, UNDERWORLD_OFFSET) : file; // under.evt counts maps from the first underworld place
    })),
    loadLang(),
    loadItemStats(),
    loadMonsters(),
  ]);
  const db = new ItemDb(lang, itemStats);
  const scriptFiles: { tag: string; file: EvtFile }[] = [
    { tag: '1', file: files[0] },
    { tag: '2', file: files[1] },
  ];

  const arrivals = collectArrivals(files);
  // statue / table events of the underworld script: a shared pool, not an NPC on one map object (see game/instant.ts)
  const instant = instantBlocks(files[1], INSTANT_UNDER_MAP + UNDERWORLD_OFFSET);
  const renderer = new GameRenderer(canvas);
  const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement);
  const audio = new AudioPlayer();
  const story = new StoryState();
  // a #map or ?map= link is a debugging jump: it neither loads nor writes the save
  const devMode = !!location.hash || params.has('map');
  const metas = new Map<string, SpriteSheetMeta>();
  const actors: SpriteActor[] = [];
  const heroes: Hero[] = [];
  for (const d of HERO_DEFS) {
    const meta = await loadSpriteMeta(d.sheet);
    metas.set(d.sheet, meta);
    actors.push(await renderer.createSprite(meta));
    heroes.push(new Hero(d.name, d.sheet, 0, 0));
  }
  const party = new Party(heroes);
  const itemMeta = await loadSpriteMeta('ITEM');
  const iconMeta = await loadSpriteMeta('ICON1');
  setMenuArt(await loadSpriteMeta('MENUICON'));
  const spriteMeta = await loadSpriteMeta('SPRITE');
  const backMeta = await loadSpriteMeta('BACK');
  const ground: GroundItem[] = [];
  const toastEl = document.getElementById('toast')!;
  let toastT = 0;
  function toast(msg: string): void {
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    toastT = 2.2;
  }
  async function dropItem(id: number, x: number, y: number): Promise<void> {
    const actor = await renderer.createSprite(itemMeta);
    ground.push({ id, x, y, actor, record: db.groundRecord(id), t: Math.random() });
  }
  function clearGround(): void {
    for (const g of ground) renderer.removeSprite(g.actor);
    ground.length = 0;
  }
  const enemies: { e: Enemy; actor: SpriteActor }[] = [];

  async function spawnEnemy(sheet: string, x: number, y: number, kind = 0, power = 20, drop = 0): Promise<void> {
    if (!metas.has(sheet)) metas.set(sheet, await loadSpriteMeta(sheet));
    const actor = await renderer.createSprite(metas.get(sheet)!);
    enemies.push({ e: new Enemy(sheet, x, y, kind, power, drop, monsterTable[String(kind)]), actor });
  }
  function clearEnemies(): void {
    for (const en of enemies) renderer.removeSprite(en.actor);
    enemies.length = 0;
  }

  let world: World | null = null;
  let mapEntry: MapIndexEntry = index[0];
  let lastEffect = '';
  interface Npc { object: number; name: string; x: number; y: number; record: number | null; actor: SpriteActor | null; blocks: { fi: number; block: EvtBlock }[]; t: number }
  const npcs: Npc[] = [];
  /** the script object whose entry is running (what THIS means in REMOVE_OBJECT / CHANGE_GOS) */
  let curNpc: Npc | null = null;
  let pendingMonsters: { o: MapObject; done: boolean }[] = [];
  interface Prop { object: number; x: number; y: number; meta: SpriteSheetMeta; record: number; actor: SpriteActor; t: number; instant?: InstantKind; broke?: number }
  const props: Prop[] = [];

  // Places a script can UNSEAL start out sealed (shop keepers and quest givers tell you about new places one by one;
  // the block that unseals all 22 at once is the late-game guardian). Which places the original really starts with is a guess.
  const initialSeals = new Set<number>();
  for (const sf of scriptFiles) {
    const starts = sf.file.blocks.map((b) => b.start).sort((a, b) => a - b);
    for (const b of sf.file.blocks) {
      const end = starts.find((x) => x > b.start) ?? sf.file.ops.length;
      const n = sf.file.ops.slice(b.start, end).filter((o) => o.t === 'cmd' && o.name === 'UNSEAL');
      if (n.length > 0 && n.length < 10) for (const o of n) if (o.t === 'cmd' && Number.isFinite(Number(o.args[0])) && Number(o.args[0]) !== 0 && !index[Number(o.args[0]) - 1]?.id.startsWith('t')) initialSeals.add(Number(o.args[0])); // villages never start sealed
    }
  }
  const devModeOn = () => devBox.style.display !== 'none';
  // objects that only appear once a script's NEW_OBJECT puts them on the map (Ompherjo, Patewoos, the sealed sword...)
  const newTargets = new Set<string>();
  for (const sf of scriptFiles)
    for (const op of sf.file.ops) if (op.t === 'cmd' && op.name === 'NEW_OBJECT') newTargets.add(`${Number(op.args[0])}:${Number(op.args[3])}`);
  function blocksOf(mapNo: number, objectId: number): { fi: number; block: EvtBlock }[] {
    const list: { fi: number; block: EvtBlock }[] = [];
    scriptFiles.forEach((sf, fi) => sf.file.blocks.forEach((block) => block.map === mapNo && block.object === objectId && list.push({ fi, block })));
    return list;
  }
  async function addNpc(mapNo: number, objectId: number, x: number, y: number, placedRec?: number): Promise<void> {
    const blocks = blocksOf(mapNo, objectId);
    if (!blocks.length) return;
    let record: number | null = story.gos.get(`${mapNo}:${objectId}`) ?? placedRec ?? npcSpriteRecord(blocks[0].block.name);
    if (record !== null && !spriteMeta.records[record]?.frames.length) record = npcSpriteRecord(blocks[0].block.name);
    const actor = record === null ? null : await renderer.createSprite(spriteMeta);
    npcs.push({ object: objectId, name: blocks[0].block.name.trim() || `object ${objectId}`, x, y, record, actor, blocks, t: Math.random() });
  }

  async function buildMapObjects(mapNo: number, objs: MapObject[]): Promise<void> {
    for (const n of npcs) if (n.actor) renderer.removeSprite(n.actor);
    npcs.length = 0;
    for (const p of props) renderer.removeSprite(p.actor);
    props.length = 0;
    const scripted = new Set<number>();
    scriptFiles.forEach((sf) => sf.file.blocks.forEach((b) => b.map === mapNo && !instant.all.has(b) && scripted.add(b.object)));
    objs = objs.filter((o) => !story.removed.has(`${mapNo}:${o.index}`)); // removed by a script earlier
    const free = objs.filter((o) => !scripted.has(o.index));
    // villages (t1-t6) list class 1-47 entries too (a Satan in the Western Village), so those are not monsters there
    pendingMonsters = mapEntry.id.startsWith('t') ? [] : monsterSpawns(free).map((o) => ({ o, done: false }));
    for (const o of free) {
      const role = objectRole(o);
      if (role !== 'prop' && role !== 'scenery') continue;
      if (isEditorFiller(o)) continue;
      const meta = role === 'prop' ? spriteMeta : backMeta;
      if (!meta.records[o.kind]?.frames.length) continue;
      const inst = role === 'prop' && o.cls === 0 && mapNo > UNDERWORLD_OFFSET ? instantKindOfSprite(o.kind) : null;
      props.push({ object: o.index, x: o.x * TILE_W + TILE_W / 2, y: o.y * TILE_H + TILE_H - 2, meta, record: o.kind, actor: await renderer.createSprite(meta), t: Math.random() * 2, instant: inst ?? undefined });
    }
    const objectIds = new Set<number>();
    scriptFiles.forEach((sf) => sf.file.blocks.forEach((b) => b.map === mapNo && !instant.all.has(b) && objectIds.add(b.object)));
    for (const objectId of objectIds) {
      const key = `${mapNo}:${objectId}`;
      if (story.removed.has(key)) continue;
      const placed = story.placed.get(key);
      if (placed) {
        await addNpc(mapNo, objectId, placed.x * TILE_W + TILE_W / 2, placed.y * TILE_H + TILE_H - 2, placed.rec);
        continue;
      }
      if (newTargets.has(key)) continue; // not on the map yet
      const o = objs.find((x) => x.index === objectId);
      if (!o) continue;
      await addNpc(mapNo, objectId, o.x * TILE_W + TILE_W / 2, o.y * TILE_H + TILE_H - 2);
    }
  }
  /** the script entry with this id on the current map, if there is one (death events of bosses) */
  function eventBlock(id: number): { fi: number; block: EvtBlock } | null {
    const mapNo = mapEntryNo();
    for (let fi = 0; fi < scriptFiles.length; fi++) {
      const block = scriptFiles[fi].file.blocks.find((b) => b.id === id && b.map === mapNo && b.name.trim() === '');
      if (block) return { fi, block };
    }
    return null;
  }
  /** the entry this object answers with now: the one a script chose, else by game year (see pickBlock), else its plain entry */
  function chooseBlock(n: Npc): { fi: number; block: EvtBlock } | null {
    const pick = pickBlock(n.blocks, story.entry.get(`${mapEntryNo()}:${n.object}`), story.year);
    if (pick) return pick;
    const first = n.blocks[0];
    const basic = first && basicBlockFor(scriptFiles[first.fi].file.blocks, first.block.name, mapEntry.id, story.year);
    return basic ? { fi: first.fi, block: basic } : null;
  }
  function nearestNpc(x: number, y: number, reach: number): Npc | null {
    let best: Npc | null = null;
    let bd = reach;
    for (const n of npcs) {
      const d = Math.hypot(n.x - x, (n.y - y) / 0.625);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  const mapEntryNo = () => index.findIndex((m) => m.id === mapEntry.id) + 1;

  async function enterMap(id: string, cellX?: number, cellY?: number): Promise<void> {
    const entry = index.find((m) => m.id === id) ?? index[0];
    const map = await loadMap(entry.id);
    const meta = tilesets[map.tileset];
    world = new World(map, meta);
    let seen = story.explored.get(entry.id);
    if (!seen || seen.length < map.w * map.h) {
      const fresh = new Uint8Array(map.w * map.h);
      if (seen) fresh.set(seen.subarray(0, fresh.length));
      seen = fresh;
      story.explored.set(entry.id, seen);
    }
    minimap.setWorld(world, seen);
    await renderer.setWorld(world, meta, map.tileset);
    mapEntry = entry;
    if (/^t\d$/.test(entry.id)) lastTown = entry.id;
    // explicit cell (script WARP) > the cell the scripts usually send you to > map centre
    const mapNo = index.findIndex((m) => m.id === entry.id) + 1;
    const dest = cellX !== undefined && cellY !== undefined ? { cx: cellX, cy: cellY } : arrivals.get(mapNo);
    const spawn = dest ? world.nearestFree(dest.cx, dest.cy) : world.findSpawn();
    clearEnemies();
    clearGround();
    clearEffects();
    await buildMapObjects(index.findIndex((m) => m.id === entry.id) + 1, parseMapObjects(map.trailer, map.w, map.h));
    party.placeAt(spawn.x, spawn.y);
    audio.setPlaylist(GAME_TRACKS);
    if (devMode) history.replaceState(null, '', `#${entry.id}`);
    mapSelect.value = entry.id;
    refreshNpcList();
    if (!restoring) saveGame();
  }

  /** the village the party wakes up in after a defeat: the last one it stood in, else the first of this world */
  let lastTown = '';
  function restTown(): string {
    const underworld = index.findIndex((m) => m.id === mapEntry.id) >= UNDERWORLD_OFFSET;
    const town = lastTown && (index.findIndex((m) => m.id === lastTown) >= UNDERWORLD_OFFSET) === underworld ? lastTown : '';
    return town || (underworld ? 't5' : 't1');
  }

  // ---------------------------------------------------------------- save / load
  let restoring = false;
  function snapshotSave(): SaveData {
    const l = party.leader;
    return makeSave(story, heroes, party.leaderIndex, mapEntry.id, l.x, l.y);
  }
  function saveGame(): void {
    if (devMode || restoring || party.allDead) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(snapshotSave()));
    } catch {
      /* storage full or blocked: playing on without saving is better than a crash */
    }
  }

  // ---------------------------------------------------------------- scripts
  const dlg = new DialogueUI(
    dlgEl,
    async (name: string, args: Arg[]) => {
      if (name === 'WARP') {
        const target = index[Number(args[0]) - 1];
        if (target) await enterMap(target.id, Number(args[1]), Number(args[2]));
      }
      if (name === 'LOCATE_ENEMY' && args.length >= 5 && Number(args[0]) === index.findIndex((m) => m.id === mapEntry.id) + 1) {
        // map x y kind power drop; kind -> sheet is a guess (see game/enemies.ts)
        const p = world!.nearestFree(Number(args[1]), Number(args[2]));
        await spawnEnemy(sheetForKind(Number(args[3]), monsterTable), p.x, p.y, Number(args[3]), Number(args[4]), Number(args[5] ?? 0));
      }
      if (name === 'LOCATE_ITEM' && args.length >= 4 && Number(args[0]) === index.findIndex((m) => m.id === mapEntry.id) + 1) {
        await dropItem(Number(args[3]), Number(args[1]) * TILE_W + TILE_W / 2, Number(args[2]) * TILE_H + TILE_H - 2);
      }
      const mapNoNow = index.findIndex((m) => m.id === mapEntry.id) + 1;
      if (name === 'STONE') {
        // a statue turns every enemy on the map to stone for n frames (the script notes say 300 / 500 / 700; ~20 frames a second)
        const secs = (Number(args[1]) || 300) / 20;
        for (const en of enemies) {
          if (en.e.dead) continue;
          en.e.freeze(secs);
          void addEffect(shell(en.e, secs));
        }
        toast('Every demon here turns to stone');
      }
      if (name === 'FULL_LIFE' || name === 'FULL_MANA') {
        for (const h of heroes) {
          if (name === 'FULL_LIFE') {
            if (h.dead) h.revive();
            h.hp = h.maxHp;
          } else h.mana = h.maxMana;
        }
        toast(name === 'FULL_LIFE' ? 'Life restored' : 'Mana restored');
      }
      if (name === 'REMOVE_OBJECT') {
        // THIS | CURMAP n | map n
        const a0 = String(args[0] ?? '').toUpperCase();
        const target = a0 === 'THIS' ? (curNpc ? { map: mapNoNow, obj: curNpc.object } : null) : { map: a0 === 'CURMAP' ? mapNoNow : Number(args[0]), obj: Number(args[1]) };
        if (target && Number.isFinite(target.map) && Number.isFinite(target.obj)) {
          story.removed.add(`${target.map}:${target.obj}`);
          if (target.map === mapNoNow) {
            for (let i = npcs.length - 1; i >= 0; i--)
              if (npcs[i].object === target.obj) {
                if (npcs[i].actor) renderer.removeSprite(npcs[i].actor!);
                npcs.splice(i, 1);
              }
            for (let i = props.length - 1; i >= 0; i--)
              if (props[i].object === target.obj) {
                renderer.removeSprite(props[i].actor);
                props.splice(i, 1);
              }
            refreshNpcList();
          }
        }
      }
      if (name === 'GO_END1') {
        // the hellgate opens: on to the underworld (its first place on the map table is Death Rock; the real entry is a guess)
        story.flags.add(9001);
        for (const f of SHARED_QUEST_FLAGS) story.flags.delete(f);
        await showSlides(document.getElementById('movie')!, [{ image: 'end1.webp', text: 'The hellgate has opened...\nThe heroes descend into the underworld.' }]);
        await enterMap('b1');
      }
      if (name === 'GO_END2') {
        story.flags.add(9002);
        await showSlides(document.getElementById('movie')!, [
          { image: 'end2.webp', text: 'Satan is defeated, and the world is at peace again.' },
          { image: 'staff.webp', text: 'THE END\nAkuma - Demon Spawn (JC Research / Triger Soft, 1999)\nWeb port: thank you for playing' },
        ]);
        location.reload(); // back to the title; the save keeps the finished game
      }
      if (name === 'UNSEAL') {
        const n = Number(args[0]);
        if (story.sealed.delete(n)) toast(`${index[n - 1]?.name ?? 'A place'} is open`);
      }
      if (name === 'NEW_OBJECT' && args.length >= 5) {
        // map x y object sprite extra: the script object appears at that cell, drawn as SPRITE.GOS record `sprite`
        const [m, x, y, obj, rec] = args.map(Number);
        story.placed.set(`${m}:${obj}`, { x, y, rec });
        if (m === mapNoNow) {
          for (let i = npcs.length - 1; i >= 0; i--)
            if (npcs[i].object === obj) {
              if (npcs[i].actor) renderer.removeSprite(npcs[i].actor!);
              npcs.splice(i, 1);
            }
          await addNpc(m, obj, x * TILE_W + TILE_W / 2, y * TILE_H + TILE_H - 2, rec);
          refreshNpcList();
        }
      }
      if (name === 'CHANGE' && curNpc) {
        // this object answers with entry n from now on (0 = back to its plain BASIC entry, stored as -1)
        const n = Number(args[0]);
        const key = `${mapNoNow}:${curNpc.object}`;
        if (n > 0) story.entry.set(key, n);
        else story.entry.set(key, -Math.max(100, runningExtra)); // finished: plain entry until a later year's quest unlocks
      }
      if (name === 'CHANGE_GOS' && curNpc && Number.isFinite(Number(args[0]))) {
        // the speaking object turns into SPRITE.GOS record n (a shattered door, a revealed demon...)
        const rec = Number(args[0]);
        if (spriteMeta.records[rec]?.frames.length) {
          curNpc.record = rec;
          story.gos.set(`${mapNoNow}:${curNpc.object}`, rec);
          if (!curNpc.actor) curNpc.actor = await renderer.createSprite(spriteMeta);
        }
      }
      lastEffect = `${name} ${args.join(' ')}`;
      console.info('[script effect]', lastEffect);
    },
    (s) => void audio.play(s),
    (m) => console.warn('[script]', m),
  );
  dlg.trade = {
    get money() {
      return story.money;
    },
    price: (id) => db.price(id),
    sellPrice: (id) => db.sellPrice(id),
    count: (id) => story.itemCount(id),
    nameOf: (id) => db.name(id),
    buy(id) {
      const p = db.price(id);
      if (p === undefined || story.money < p) return false;
      story.money -= p;
      story.giveItem(id);
      return true;
    },
    sell(id) {
      const p = db.sellPrice(id);
      if (p === undefined || story.itemCount(id) < 1) return false;
      story.removeItem(id);
      story.money += p;
      return true;
    },
    repairable: () => {
      const ids = new Set<number>([...story.items.keys(), ...heroes.flatMap((h) => Object.values(h.gear) as number[])]);
      return [...ids].filter((id) => story.wear.get(id)).sort((a, b) => a - b);
    },
    repairCost: (id) => repairCost(db, story.wear, id),
    repair(id) {
      const c = repairCost(db, story.wear, id);
      if (!c || story.money < c) return false;
      story.money -= c;
      repairItem(story.wear, id);
      refreshHeroStats();
      return true;
    },
    durability: (id) => (maxDurability(db, id) ? `${durabilityLeft(db, story.wear, id)}/${maxDurability(db, id)}` : ''),
    spellLabel: (k) => `${lang.magic[String(k)]?.name ?? 'Spell ' + k} (mana ${itemStats[String(184 + k)]?.mana ?? '?'})${SPELL_IMPL.has(k) ? '' : ' - not playable yet'}`,
    learned: (k) => story.magic.has(k),
    learn: (k) => {
      story.magic.set(k, 1);
      if (!SPELL_IMPL.has(k)) return;
      if (!knownSpells().includes(spellSel)) spellSel = k;
    },
    owned: (equipment) => [...story.items.keys()].filter((id) => (equipment ? db.kind(id) === 'equipment' : db.kind(id) === 'consumable')).sort((a, b) => a - b),
  };
  dlg.itemLabel = (id) => {
    const st = db.summary(id);
    return `${db.name(id)}${st ? ' (' + st + ')' : ''}`;
  };
  let running = false;
  let runningExtra = 100;
  async function runBlock(file: EvtFile, block: EvtBlock): Promise<void> {
    if (running) return;
    running = true;
    curNpc = npcs.find((n) => n.blocks.some((b) => b.block === block)) ?? null;
    party.leader.input.x = party.leader.input.y = 0;
    let cur = block;
    for (let hops = 0; hops < 3; hops++) {
      runningExtra = cur.extra;
      const res = await new EvtInterpreter(file, cur, story, dlg).run();
      if (res.reason === 'ERROR') console.error('[script]', res.message);
      if (res.reason !== 'BASIC') break;
      // GO_BASIC_EVENT: fall back to the object's default (BASIC) entry - the shop / plain talk
      const basic = basicBlockFor(file.blocks, cur.name, mapEntry.id, story.year);
      if (!basic) break;
      cur = basic;
    }
    dlg.hide();
    running = false;
  }

  // ---------------------------------------------------------------- HUD
  const mapSelect = document.createElement('select');
  for (const m of index) mapSelect.add(new Option(`${m.id.toUpperCase()} · ${m.name}`, m.id));
  mapSelect.onchange = () => void enterMap(mapSelect.value);

  const npcSelect = document.createElement('select');
  function refreshNpcList(): void {
    const n = index.findIndex((m) => m.id === mapEntry.id) + 1;
    npcSelect.innerHTML = '';
    npcSelect.add(new Option('Talk to… (script entries on this map)', ''));
    scriptFiles.forEach((sf, fi) =>
      sf.file.blocks.forEach((b, bi) => {
        if (b.map === n) npcSelect.add(new Option(`[${sf.tag}] #${b.id} ${b.name} (${b.kind})`, `${fi}:${bi}`));
      }),
    );
  }
  npcSelect.onchange = () => {
    if (!npcSelect.value) return;
    const [fi, bi] = npcSelect.value.split(':').map(Number);
    npcSelect.value = '';
    audio.unlock();
    void runBlock(scriptFiles[fi].file, scriptFiles[fi].file.blocks[bi]);
  };

  const spawnSelect = document.createElement('select');
  spawnSelect.add(new Option('Spawn enemy…', ''));
  for (const n of ENEMY_SHEETS) spawnSelect.add(new Option(n, n));
  spawnSelect.onchange = () => {
    if (!spawnSelect.value) return;
    const l = party.leader;
    void spawnEnemy(spawnSelect.value, l.x + 90, l.y);
    spawnSelect.value = '';
  };

  const markerBtn = document.createElement('button');
  markerBtn.textContent = 'collision markers: off';
  let showMarkers = false;
  markerBtn.onclick = () => {
    showMarkers = !showMarkers;
    renderer.setShowMarkers(showMarkers);
    markerBtn.textContent = `collision markers: ${showMarkers ? 'on' : 'off'}`;
  };

  const musicBtn = document.createElement('button');
  musicBtn.textContent = '♪ music: off';
  musicBtn.onclick = () => {
    audio.unlock();
    musicBtn.textContent = `♪ music: ${audio.toggleMusic() ? 'on' : 'off'}`;
  };

  const leaderBtns = HERO_DEFS.map((d, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1} ${d.name}`;
    b.onclick = () => {
      if (!heroes[i].dead) party.setLeader(i);
    };
    return b;
  });
  // the debugging tools live behind a gear button so the phone HUD stays small
  const devBox = document.createElement('div');
  devBox.className = 'dev';
  devBox.style.display = devMode ? 'flex' : 'none';
  devBox.append(mapSelect, npcSelect, spawnSelect, markerBtn);
  const gearBtn = document.createElement('button');
  gearBtn.textContent = '\u2699';
  gearBtn.title = 'debug tools';
  gearBtn.onclick = () => (devBox.style.display = devBox.style.display === 'none' ? 'flex' : 'none');
  hud.append(...leaderBtns, musicBtn);

  // ---------------------------------------------------------------- magic and projectiles
  const SPELL_IMPL = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  story.magic.set(1, 1); // the strategy guide says Kusa starts with Fire Wall and Fire Ball
  story.magic.set(2, 1);
  let spellSel = 2;
  const knownSpells = () => [...story.magic.keys()].filter((k) => SPELL_IMPL.has(k)).sort((a, b) => a - b);
  const manaCost = (k: number) => itemStats[String(184 + k)]?.mana ?? 30;
  const effectMetas = new Map<string, SpriteSheetMeta>([
    ['MGC-EFF', await loadSpriteMeta('MGC-EFF')],
    ['ARROW', await loadSpriteMeta('ARROW')],
  ]);
  const fx: { e: Effect; actor: SpriteActor }[] = [];
  const effectSheets = new Map<string, SpriteSheetMeta>(effectMetas);
  async function addEffect(e: Effect): Promise<void> {
    const actor = await renderer.createSprite(effectSheets.get(e.sheet)!);
    fx.push({ e, actor });
  }
  function clearEffects(): void {
    for (const f of fx) renderer.removeSprite(f.actor);
    fx.length = 0;
  }
  const HERO_SFX: Record<string, string> = { LEELIM: 'lee', KUSA: 'kusa', RINING: 'ren' };
  /** `who` is a follower casting on his own (see the party AI); by default the leader casts what the player picked */
  function castSpell(free?: number, who?: Hero, pick?: number): void {
    const h = who ?? party.leader;
    const k = pick ?? free ?? (knownSpells().includes(spellSel) ? spellSel : knownSpells()[0]);
    if (!k || h.dead || running || dlg.open) return;
    const cost = free ? 0 : manaCost(k);
    if (h.mana < cost) {
      if (!who) toast('Not enough mana');
      return;
    }
    const d = derive(db, story.statsOf(h.name), story.level, workingGear(db, story.wear, h.gear), traitOf(h.name), story.lifeBonus);
    const m = d.magic;
    h.mana -= cost;
    h.attack(); // cast with the attack animation
    void audio.play(`${HERO_SFX[h.sheet] ?? 'kusa'}-m${Math.min(k, 13)}.wav`, 0.6);
    const add = (e: Effect | Effect[]) => (Array.isArray(e) ? e : [e]).forEach((x) => void addEffect(x));
    switch (k) {
      case 1: add(fireWall(h.x, h.y, h.dir, 4 + Math.round(m * 0.5))); break;
      case 2: add(fireBall(h.x, h.y, h.dir, 10 + Math.round(m * 1.5))); break;
      case 3: add(ghostBolt(h.x, h.y, h.dir, 14 + Math.round(m * 1.8))); break;
      case 4: { const e = ghostBolt(h.x, h.y, h.dir, 24 + Math.round(m * 2.4)); e.record = 33; e.radius = 40; add(e); break; }
      case 5: add(lightning(h.x, h.y, 6 + Math.round(m * 0.8))); break;
      case 6: { const e = lightning(h.x, h.y, 8 + Math.round(m)); e[0].record = 41; add(e); break; }
      case 7: {
        // Stone Curse: everything near the caster turns to stone for a while
        const secs = 6 + m * 0.3;
        for (const en of enemies) {
          if (en.e.dead || Math.hypot(en.e.x - h.x, (en.e.y - h.y) / 0.625) > 220) continue;
          en.e.freeze(secs);
          add(shell(en.e, secs));
        }
        break;
      }
      case 8: {
        // Buddha Shield: the whole party is untouchable for a while
        const secs = 10 + m * 0.3;
        for (const x of heroes) {
          if (x.dead) continue;
          x.invuln = secs;
          add(aura(x, 33, secs));
        }
        break;
      }
      case 10: add(rain(h.x, h.y, h.dir, 6 + Math.round(m * 0.9), 12)); break;
      case 11: add(rain(h.x, h.y, h.dir, 12 + Math.round(m * 1.6), 27)); break;
      case 9: {
        const w = heroes.filter((x) => !x.dead).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        if (w) {
          w.hp = Math.min(w.maxHp, w.hp + Math.round(w.maxHp * 0.4));
          add(visual('MGC-EFF', 33, 7, w.x, w.y));
        }
        break;
      }
      case 12: {
        const dead = heroes.find((x) => x.dead);
        if (dead) {
          dead.revive();
          dead.hp = Math.round(dead.maxHp / 2);
          add(visual('MGC-EFF', 1, 10, dead.x, dead.y));
        } else h.mana += cost;
        break;
      }
    }
  }
  function cycleSpell(): void {
    const ks = knownSpells();
    if (!ks.length) return;
    spellSel = ks[(ks.indexOf(spellSel) + 1) % ks.length];
    refreshActButtons();
  }

  /** recompute every hero's numbers from stats, level and gear; keeps each hero's life fraction */
  let buff: Buff = {};
  let buffT = 0;
  /** the base stats with the running potion-like buff applied */
  function buffedStats(name: string): typeof story.stats {
    const s = { ...story.statsOf(name) };
    s.STRENGTH = Math.round(s.STRENGTH * (buff.strength ?? 1));
    s.DEXTERITY = Math.round(s.DEXTERITY * (buff.dexterity ?? 1));
    s.SKILL = Math.round(s.SKILL * (buff.skill ?? 1));
    return s;
  }
  /** a swing or a blow costs the gear in `slots` a point of durability now and then; broken pieces stop counting */
  function wearGear(h: Hero, slots: Slot[]): void {
    const chance = wearChance(story.statsOf(h.name).BRAIN);
    let broke = false;
    for (const s of slots) {
      const id = h.gear[s];
      if (!id || Math.random() > chance) continue;
      if (wearOut(db, story.wear, id)) {
        toast(`${db.name(id)} broke - a blacksmith can repair it`);
        broke = true;
      }
    }
    if (broke) refreshHeroStats();
  }
  let encumb = 1;
  const fightCd = new Map<Hero, number>();
  const spellCd = new Map<Hero, number>();
  function refreshHeroStats(): void {
    for (const h of heroes) {
      const d = derive(db, buffedStats(h.name), story.level, workingGear(db, story.wear, h.gear), traitOf(h.name), story.lifeBonus);
      h.guard = buff.taken ?? 1;
      const frac = h.maxHp ? h.hp / h.maxHp : 1;
      h.maxHp = d.maxHp;
      h.hp = h.dead ? 0 : Math.max(1, Math.round(d.maxHp * frac));
      const mf = h.maxMana ? h.mana / h.maxMana : 1;
      h.maxMana = d.maxMana;
      h.mana = Math.round(d.maxMana * mf);
      h.attackPower = Math.round(d.attack * (buff.dealt ?? 1));
      h.defense = d.defense;
      h.speedMul = d.speedMul * encumb;
      h.attackRate = d.attackRate;
      h.ignore = ignoreChance(d.skill);
    }
  }
  refreshHeroStats();
  /** what the party carries against what it can carry (all three heroes' limits together) */
  const capacityNow = () => HERO_DEFS.reduce((n, d) => n + carryCapacity(story.statsOf(d.name)), 0);
  const loadNow = () => partyLoad(db, story.items, heroes.map((x) => x.gear));
  function addXp(n: number): void {
    story.xp += n;
    let up = false;
    while (story.xp >= xpToNext(story.level)) {
      story.xp -= xpToNext(story.level);
      story.level++;
      for (const h of HERO_DEFS) story.points[h.name] = (story.points[h.name] ?? 0) + POINTS_PER_LEVEL;
      up = true;
    }
    if (up) {
      refreshHeroStats();
      for (const h of heroes) if (!h.dead) h.hp = h.maxHp;
      toast(`Level ${story.level}!`);
    }
  }

  dlg.heroName = () => party.leader.name;
  const faceRec = iconMeta.records[24];
  if (faceRec)
    dlg.setPortraits(assetUrl(`sprites/${iconMeta.pages[0].file}`), faceRec.frames, () => ({ Elim: 0, Raening: 1, Kusa: 2 })[party.leader.name as 'Elim'] ?? 0);

  /** apply a consumable's effect; false when it would change nothing (the item is then kept) */
  async function applyItemEffect(fx: ItemEffect): Promise<boolean> {
      const alive = heroes.filter((x) => !x.dead);
      let used = false;
      if (fx.life !== undefined) {
        // heal the most wounded living hero
        const h = [...alive].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        if (h && h.hp < h.maxHp) {
          h.hp = Math.min(h.maxHp, h.hp + Math.round(h.maxHp * fx.life));
          used = true;
        }
      }
      if (fx.mana !== undefined) {
        const h = [...alive].sort((a, b) => a.mana / a.maxMana - b.mana / b.maxMana)[0];
        if (h && h.mana < h.maxMana) {
          h.mana = Math.min(h.maxMana, h.mana + Math.round(h.maxMana * fx.mana));
          used = true;
        }
      }
      if (fx.stats) {
        for (const [k, v] of Object.entries(fx.stats)) story.addStat(k as StatName, v);
        refreshHeroStats();
        used = true;
      }
      if (fx.maxLife) {
        story.lifeBonus += fx.maxLife;
        refreshHeroStats();
        used = true;
      }
      if (fx.money) {
        story.money += fx.money;
        used = true;
      }
      if (fx.learn !== undefined && !story.magic.has(fx.learn)) {
        dlg.trade?.learn(fx.learn);
        used = true;
      }
      if (fx.reveal) {
        minimap.revealAll();
        toast('The whole area lights up');
        used = true;
      }
      if (fx.buff) {
        buff = { ...buff, ...fx.buff };
        buffT = BUFF_SECONDS;
        refreshHeroStats();
        used = true;
      }
      if (fx.cast) {
        inv.toggle();
        castSpell(fx.cast);
        used = true;
      }
      if (fx.smite) {
        const lead = party.leader;
        const under = index.indexOf(mapEntry) >= UNDERWORLD_OFFSET;
        let n = 0;
        for (const en of enemies) {
          // devils live below; an event boss ("drop" names an event) is left to its own story
          const boss = en.e.drop > 0 && en.e.drop < 150;
          if (!under || boss || en.e.dead || Math.hypot(en.e.x - lead.x, (en.e.y - lead.y) / 0.625) > 320) continue;
          en.e.damage(99999);
          n++;
        }
        used = n > 0;
      }
      if (fx.gate) {
        // "The Teleport Gate linking with <World>": travel to a village of this world that is not sealed
        const here = index.findIndex((m) => m.id === mapEntry.id);
        const under = here >= UNDERWORLD_OFFSET;
        const towns = index.filter((m, i) => /^t\d$/.test(m.id) && i >= UNDERWORLD_OFFSET === under && !story.sealed.has(i + 1));
        const pick = await menu.choose(`The Teleport Gate linking with ${lang.ui[under ? 18 : 17]}`, towns.map((m) => `${lang.ui[9]} ${m.name}`));
        if (pick < 0) return false;
        inv.toggle();
        await enterMap(towns[pick].id);
        used = true;
      }
      if (fx.shield) {
        for (const h of alive) h.invuln = Math.max(h.invuln, fx.shield);
        used = true;
      }
      return used;
  }

  const inv = new InventoryUI(
    document.getElementById('inv')!,
    db,
    story,
    applyItemEffect,
    toast,
    {
      names: HERO_DEFS.map((d) => d.name),
      gear: (i) => heroes[i].gear,
      derived: (i) => derive(db, story.statsOf(heroes[i].name), story.level, workingGear(db, story.wear, heroes[i].gear), traitOf(heroes[i].name), story.lifeBonus),
      hp: (i) => [Math.ceil(heroes[i].hp), heroes[i].maxHp],
      stats: (i) => story.statsOf(heroes[i].name),
      points: (i) => story.points[heroes[i].name] ?? 0,
      spend(i, stat) {
        const name = heroes[i].name;
        if ((story.points[name] ?? 0) < 1) return;
        story.points[name]--;
        story.statsOf(name)[stat]++;
        refreshHeroStats();
      },
      autoSpend(i) {
        const name = heroes[i].name;
        const n = story.points[name] ?? 0;
        if (n < 1) return;
        for (const [k, v] of Object.entries(autoSpread(name, n))) story.statsOf(name)[k as StatName] += v ?? 0;
        story.points[name] = 0;
        refreshHeroStats();
      },
      capacity: () => capacityNow(),
      durability: (id) => (maxDurability(db, id) ? `${durabilityLeft(db, story.wear, id)}/${maxDurability(db, id)}` : ''),
      equip(i, id) {
        const slot = slotOf(db, id);
        if (!slot || story.itemCount(id) < 1) return;
        const h = heroes[i];
        const old = h.gear[slot];
        story.removeItem(id);
        if (old) story.giveItem(old);
        h.gear[slot] = id;
        refreshHeroStats();
      },
      unequip(i, slot) {
        const h = heroes[i];
        const id = h.gear[slot as Slot];
        if (!id) return;
        delete h.gear[slot as Slot];
        story.giveItem(id);
        refreshHeroStats();
      },
    },
  );
  const worldUI = new WorldMapUI(
    document.getElementById('world')!,
    index,
    (id) => void enterMap(id),
    (m) => !devModeOn() && story.sealed.has(index.indexOf(m) + 1),
  );
  const movies = new MoviePlayer(document.getElementById('movie')!);
  const movieSelect = document.createElement('select');
  movieSelect.add(new Option('Movies…', ''));
  for (const [file, label] of [['soft', 'JC Research logo'], ['trigger', 'Triger Soft logo'], ['visual1', 'Visual 1'], ['visual2', 'Visual 2']]) movieSelect.add(new Option(label, file));
  movieSelect.onchange = () => {
    if (!movieSelect.value) return;
    audio.unlock();
    movies.play(movieSelect.value);
    movieSelect.value = '';
  };
  const worldBtn = document.createElement('button');
  worldBtn.textContent = 'World map (M)';
  worldBtn.onclick = () => worldUI.toggle(mapEntry.id);
  hud.append(worldBtn);
  devBox.append(movieSelect);
  const invBtn = document.createElement('button');
  invBtn.textContent = 'Items (I)';
  invBtn.onclick = () => inv.toggle();
  hud.append(invBtn);
  const quests = new QuestLog(document.getElementById('quests')!, story);
  const questBtn = document.createElement('button');
  questBtn.textContent = 'Quests (J)';
  questBtn.onclick = () => quests.toggle();
  const menu = new GameMenu(document.getElementById('menu')!, {
    heroCount: heroes.length,
    mapName: (id) => index.find((m) => m.id === id)?.name ?? id,
    snapshot: () => (devMode || party.allDead ? null : snapshotSave()),
    load(text) {
      localStorage.setItem(SAVE_KEY, text);
      restoring = true; // the page unload must not overwrite it with the current game
      location.href = location.pathname;
    },
    musicOn: () => audio.isMusicOn(),
    toggleMusic: () => {
      audio.unlock();
      musicBtn.textContent = `\u266a music: ${audio.toggleMusic() ? 'on' : 'off'}`;
    },
    sfxOn: () => audio.isSfxOn(),
    toggleSfx: () => void audio.toggleSfx(),
    cheat() {
      const text = window.prompt('Code:');
      if (!text) return;
      const c = parseCheat(text, lang.ui);
      if (!c) {
        toast('Nothing happened');
        return;
      }
      if (c.kind === 'years') {
        story.year += c.n;
        toast(`Year ${Math.floor(story.year)}`);
      } else if (c.kind === 'reveal') {
        minimap.revealAll();
        toast('The map is shown');
      } else if (c.kind === 'levels') {
        for (let i = 0; i < c.n; i++) addXp(xpToNext(story.level));
      } else if (lang.items[String(c.id)] || lang.weapons[String(c.id)]) {
        const l = party.leader;
        for (let i = 0; i < Math.min(c.count, 8); i++) void dropItem(c.id, l.x + 30 + i * 14, l.y + 10);
        toast(`Item ${c.id} dropped`);
      } else toast('No such item');
    },
    exitToTitle() {
      saveGame();
      restoring = true;
      location.href = location.pathname;
    },
    toast,
  });
  const menuBtn = document.createElement('button');
  menuBtn.textContent = 'Menu (Esc)';
  menuBtn.onclick = () => menu.toggle();
  const helpEl = document.getElementById('help')!;
  helpEl.innerHTML = `<h3>How to play</h3>
    <b>Touch</b><ul><li>Tap the ground to walk, tap a monster to attack it, tap a villager next to you to talk.</li>
    <li>Bottom buttons: change spell (the arrow), cast it, attack.</li><li>1 / 2 / 3 buttons pick who you lead.</li></ul>
    <b>Keyboard</b><ul><li>Arrows / WASD move, Space attacks, E or Enter talks, F casts, Q changes spell.</li>
    <li>1-3 or Z / X / C pick the leader, I items, J quests, M world map, Esc menu (save slots, sound).</li></ul>
    <b>Good to know</b><ul><li>The game saves itself; Continue appears on the title screen. The menu has five extra save slots.</li>
    <li>Some places on the world map stay locked until villagers tell you about them.</li>
    <li>The gear button holds debug tools (jump to any map, spawn monsters).</li></ul>
    <button>Close</button>`;
  helpEl.addEventListener('click', (e) => e.stopPropagation());
  helpEl.querySelector('button')!.addEventListener('click', () => (helpEl.style.display = 'none'));
  const helpBtn = document.createElement('button');
  helpBtn.textContent = '?';
  helpBtn.onclick = () => (helpEl.style.display = helpEl.style.display === 'block' ? 'none' : 'block');
  hud.append(questBtn, menuBtn, helpBtn, gearBtn, devBox);
  // announce quests as the scripts add / finish them
  let knownOrders = new Map(story.orders);
  function watchQuests(): void {
    for (const [id, q] of story.orders) if (!knownOrders.has(id)) toast(`New quest: ${q.title || id}`);
    for (const [id, q] of knownOrders) if (!story.orders.has(id)) toast(`Quest done: ${q.title || id}`);
    knownOrders = new Map(story.orders);
    if (quests.open) quests.render();
  }
  const act = document.getElementById('act')!;
  const atkBtn = document.createElement('button');
  atkBtn.textContent = '⚔';
  atkBtn.title = 'Attack (space)';
  const castBtn = document.createElement('button');
  const cycBtn = document.createElement('button');
  cycBtn.textContent = '↻';
  cycBtn.title = 'Next spell (Q)';
  for (const b of [atkBtn, castBtn, cycBtn]) {
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      audio.unlock();
      if (dlg.open) return;
      if (b === atkBtn) party.leader.attack();
      else if (b === castBtn) castSpell();
      else cycleSpell();
    });
  }
  act.append(cycBtn, castBtn, atkBtn);
  function refreshActButtons(): void {
    const k = knownSpells().includes(spellSel) ? spellSel : knownSpells()[0];
    castBtn.textContent = k ? `✦ ${lang.magic[String(k)]?.name ?? k} ${manaCost(k)}` : '✦ no magic';
  }
  refreshActButtons();
  // quick slots (keys 4-9 and 0; 1-3 pick the leader): known spells first, then usable consumables
  const quickEl = document.getElementById('quick')!;
  const yearNum = document.querySelector('#year span')!;
  const yearOrb = document.querySelector<HTMLElement>('#year b')!;
  // ICON1 record 12: 40 frames of a spinning globe (15x15) - the Year panel orb is just that animation
  const iconUrl = assetUrl(`sprites/${iconMeta.pages[0].file}`);
  const orbFrames = (iconMeta.records[12]?.frames ?? []).filter((f) => f !== null);
  let orbN = 0;
  // ICON1 records 17 (overworld, 22 labels) and 18 (underworld, 20): the area name picture drawn over the corner of the play field
  const placeEl = document.getElementById('place')!;
  let placeId = '';
  const updatePlace = (): void => {
    const r = canvas.getBoundingClientRect();
    placeEl.style.left = `${r.left + 6}px`;
    placeEl.style.top = `${r.top + 4}px`;
    if (placeId === mapEntry.id) return;
    placeId = mapEntry.id;
    const fr = iconMeta.records[mapEntry.world === 2 ? 18 : 17]?.frames[mapEntry.world === 2 ? mapEntry.order - 22 : mapEntry.order];
    placeEl.style.display = fr ? 'block' : 'none';
    if (fr) placeEl.style.cssText += `;width:${fr.w}px;height:${fr.h}px;background:url(${iconUrl}) -${fr.x}px -${fr.y}px`;
  };
  if (orbFrames.length) yearOrb.classList.add('globe');
  interface Quick { label: string; run: () => void | Promise<void> }
  let quickList: Quick[] = [];
  let quickSig = '';
  function quickEntries(): Quick[] {
    const out: Quick[] = [];
    for (const k of knownSpells())
      out.push({ label: lang.magic[String(k)]?.name ?? `Spell ${k}`, run: () => { spellSel = k; castSpell(); refreshActButtons(); } });
    for (const [id, n] of [...story.items].sort((a, b) => a[0] - b[0])) {
      const fx = db.kind(id) === 'consumable' ? itemEffect(id, db.desc(id)) : null;
      if (!fx || fx.learn !== undefined) continue;
      out.push({
        label: `${db.name(id)} ×${n}`,
        run: async () => {
          if (await applyItemEffect(fx)) {
            story.removeItem(id);
            toast(`Used ${db.name(id)}`);
          } else toast('No effect right now');
        },
      });
    }
    return out.slice(0, 7);
  }
  function refreshQuick(): void {
    quickList = quickEntries();
    const sig = quickList.map((q) => q.label).join('|');
    if (sig === quickSig) return;
    quickSig = sig;
    quickEl.innerHTML = '';
    quickList.forEach((q, i) => {
      const b = document.createElement('button');
      b.textContent = `${'4567890'[i]} ${q.label}`;
      b.onclick = (e) => {
        e.stopPropagation();
        void q.run();
      };
      quickEl.appendChild(b);
    });
  }
  const partyEl = document.getElementById('party')!;
  const overEl = document.getElementById('over')!;
  const bars = heroes.map((h) => {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = h.name;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    bar.appendChild(fill);
    const mbar = document.createElement('div');
    mbar.className = 'bar mana';
    const mfill = document.createElement('i');
    mbar.appendChild(mfill);
    const fr = faceRec?.frames[({ Elim: 0, Raening: 1, Kusa: 2 } as Record<string, number>)[h.name] ?? 0];
    const face = document.createElement('div');
    face.className = 'pface';
    if (fr) {
      const k = 36 / fr.w; // the 80x78 portrait, scaled down
      face.style.cssText = `width:36px;height:${Math.round(fr.h * k)}px;background:url(${assetUrl(`sprites/${iconMeta.pages[0].file}`)}) -${fr.x * k}px -${fr.y * k}px / ${iconMeta.pages[0].w * k}px auto`;
    }
    const plus = document.createElement('button');
    plus.className = 'plus';
    plus.textContent = '+';
    plus.title = 'Spend stat points';
    plus.style.display = 'none';
    plus.onclick = (e) => {
      e.stopPropagation();
      if (!inv.open) inv.toggle();
      else inv.render();
    };
    row.append(name, bar, mbar, face, plus);
    partyEl.appendChild(row);
    return { row, fill, mfill, face, plus };
  });
  const lvEl = document.createElement('div');
  lvEl.style.textAlign = 'right';
  partyEl.prepend(lvEl);
  let respawnT = 0;
  const helpT = new Map<Hero, number>(); // seconds a living hero has stood next to a fallen one

  // ---------------------------------------------------------------- input
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (dlg.open) return;
    audio.unlock();
    keys.add(e.key.toLowerCase());
    if (e.key >= '1' && e.key <= '3' && !heroes[Number(e.key) - 1].dead) party.setLeader(Number(e.key) - 1);
    const zxc = 'zxc'.indexOf(e.key.toLowerCase());
    if (zxc >= 0 && !heroes[zxc].dead) party.setLeader(zxc); // the manual's Z / X / C hot keys
    if (e.key === 'Escape') menu.toggle();
    const qi = '4567890'.indexOf(e.key);
    if (qi >= 0 && !e.repeat && !dlg.open) void quickList[qi]?.run();
    if (e.key.toLowerCase() === 'i') inv.toggle();
    if (e.key.toLowerCase() === 'j') quests.toggle();
    if (e.key.toLowerCase() === 'f') castSpell();
    if (e.key.toLowerCase() === 'q') cycleSpell();
    if (e.key.toLowerCase() === 'm') worldUI.toggle(mapEntry.id);
    if (e.key.toLowerCase() === 'e' || e.key === 'Enter') talkToNearest();
    if (e.key === ' ') {
      party.leader.attack();
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('pointerdown', (e) => {
    if (dlg.open) return;
    audio.unlock();
    const r = canvas.getBoundingClientRect();
    const cx = renderer.camera.position.x;
    const cy = -renderer.camera.position.y;
    const wx = cx - VIEW_W / 2 + ((e.clientX - r.left) / r.width) * VIEW_W;
    const wy = cy - VIEW_H / 2 + ((e.clientY - r.top) / r.height) * VIEW_H;
    const tapped = nearestNpc(wx, wy - 16, 30);
    if (tapped) {
      if (Math.hypot(tapped.x - party.leader.x, (tapped.y - party.leader.y) / 0.625) < 80) {
        const pick = chooseBlock(tapped);
        if (pick && !running) void runBlock(scriptFiles[pick.fi].file, pick.block);
        return;
      }
    }
    const tappedInstant = nearestInstant(wx, wy - 16, 36);
    if (tappedInstant && Math.hypot(tappedInstant.x - party.leader.x, (tappedInstant.y - party.leader.y) / 0.625) < 80) {
      if (!running) useInstant(tappedInstant);
      return;
    }
    const foe = enemies.find((en) => !en.e.dead && Math.hypot(en.e.x - wx, en.e.y - 14 - wy) < 34);
    attackTarget = foe ? foe.e : null;
    party.leader.target = foe ? { x: foe.e.x, y: foe.e.y } : { x: wx, y: wy };
    party.leader.input.x = party.leader.input.y = 0;
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    party.leader.attack();
  });

  let attackTarget: Enemy | null = null;
  const isBow = (h: Hero) => !!h.gear.weapon && db.lang.weapons[String(h.gear.weapon)]?.category === 'bow';

  /** a dungeon statue or table within reach: touching it runs one random event of its kind, once */
  function nearestInstant(x: number, y: number, reach: number): Prop | null {
    let best: Prop | null = null;
    let bd = reach;
    for (const p of props) {
      if (!p.instant || !instant[p.instant].length) continue;
      const d = Math.hypot(p.x - x, (p.y - y) / 0.625);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }
  function useInstant(p: Prop): void {
    const pool = instant[p.instant!];
    const block = pool[Math.floor(Math.random() * pool.length)];
    story.removed.add(`${mapEntryNo()}:${p.object}`); // each statue / table works once
    const i = props.indexOf(p);
    if (i >= 0) props.splice(i, 1);
    renderer.removeSprite(p.actor);
    audio.unlock();
    void runBlock(files[1], block);
  }

  function talkToNearest(): void {
    if (running) return;
    const n = nearestNpc(party.leader.x, party.leader.y, 70);
    const ip = nearestInstant(party.leader.x, party.leader.y, 70);
    if (ip && (!n || Math.hypot(ip.x - party.leader.x, (ip.y - party.leader.y) / 0.625) < Math.hypot(n.x - party.leader.x, (n.y - party.leader.y) / 0.625))) {
      useInstant(ip);
      return;
    }
    if (!n) return;
    const pick = chooseBlock(n);
    audio.unlock();
    if (pick) void runBlock(scriptFiles[pick.fi].file, pick.block);
  }

  function readKeys(): void {
    const l = party.leader;
    l.input.x = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
    l.input.y = (keys.has('arrowdown') || keys.has('s') ? 1 : 0) - (keys.has('arrowup') || keys.has('w') ? 1 : 0);
  }

  // ---------------------------------------------------------------- loop
  let saved: ReturnType<typeof parseSave> = null;
  if (!devMode) {
    try {
      saved = parseSave(localStorage.getItem(SAVE_KEY), heroes.length);
    } catch {
      saved = null;
    }
  }
  if (!saved) for (const n of initialSeals) story.sealed.add(n);
  // "the heroes start out with only a single weapon each" (manual): a plain sword for Elim, a dagger for Kusa, a bow for Raening
  if (!saved) {
    START_WEAPONS.forEach((id, i) => (heroes[i].gear.weapon = id));
    refreshHeroStats();
  }
  // the scripts test NUM 1/2/3 for "hero 1/2/3 is in the party" ("Kusa or me"); nothing grants them, so the engine does
  heroes.forEach((_, i) => story.flags.add(i + 1));
  if (saved) {
    restoring = true;
    applyStory(story, saved);
    heroes.forEach((_, i) => story.flags.add(i + 1)); // saves from before the party flags existed lack them
    if (params.has('year')) story.year = Number(params.get('year'));
    heroes.forEach((h, i) => {
      h.gear = { ...saved!.heroes[i].gear };
    });
    refreshHeroStats();
    await enterMap(saved.map);
    party.placeAt(saved.x - (saved.leader - 1) * 22, saved.y); // placeAt spreads the heroes around the given point
    heroes.forEach((h, i) => {
      h.hp = Math.min(h.maxHp, Math.max(1, saved!.heroes[i].hp));
      h.mana = Math.min(h.maxMana, saved!.heroes[i].mana);
    });
    party.setLeader(saved.leader);
    refreshActButtons();
    restoring = false;
  } else {
    if (params.has('year')) story.year = Number(params.get('year')); // debugging: ?year=123 unlocks every quest entry
    await enterMap((location.hash.slice(1) || params.get('map') || 't1').toLowerCase());
  }
  window.addEventListener('pagehide', saveGame);
  document.addEventListener('visibilitychange', () => document.hidden && saveGame());
  let saveT = 0;
  let questT = 0;
  knownOrders = new Map(story.orders); // a loaded game's quests are not news

  let last = performance.now();
  let statusT = 0;
  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (world) {
      if (!dlg.open) readKeys();
      else party.leader.input.x = party.leader.input.y = 0;
      if (!dlg.open && !running) {
        const before = Math.floor(story.year);
        story.year = advanceYear(story.year, dt);
        if (Math.floor(story.year) > before && story.year < 124) toast(`Year ${Math.floor(story.year)} - people may have news`);
      }
      if (buffT > 0 && (buffT -= dt) <= 0) {
        buff = {};
        refreshHeroStats();
        toast('The effect wears off');
      }
      party.update(dt, world, metas);
      party.ensureLeaderAlive();
      const lead = party.leader;
      if (lead.swung && !isBow(lead)) {
        // a swing smashes the crates, chests, barrels and jars in reach
        for (const p of props) {
          if (p.broke !== undefined || p.meta !== spriteMeta || !isBreakable(p.record)) continue;
          if (Math.hypot(p.x - lead.x, (p.y - lead.y) / 0.625) > 56) continue;
          p.broke = 0;
          story.removed.add(`${mapEntryNo()}:${p.object}`); // gone for good once the debris has been left behind
          const drop = containerDrop();
          if (drop) void dropItem(drop, p.x, p.y + 6);
        }
      }
      for (const h of heroes) {
        if (!h.swung || !isBow(h)) continue;
        const w = h.gear.weapon!;
        void addEffect(arrow(h.x, h.y, h.dir, Math.round(h.attackPower * traitOf(h.name).bow), (db.stat(w).range ?? 6) * 32));
        void audio.play('arrow1.wav', 0.5);
        wearGear(h, ['weapon']);
      }
      // the heroes the player is not steering fight on their own: they step up to a foe near the leader and swing or shoot
      party.engage.clear();
      for (const h of heroes) {
        if (h === lead || h.dead || running || dlg.open) continue;
        fightCd.set(h, Math.max(0, (fightCd.get(h) ?? 0) - dt));
        spellCd.set(h, Math.max(0, (spellCd.get(h) ?? 0) - dt));
        const reach = isBow(h) ? 170 : 44;
        if ((spellCd.get(h) ?? 0) <= 0 && h.state !== 'attack' && h.state !== 'hurt') {
          const known = knownSpells();
          const fallen = heroes.some((x) => x.dead);
          const worst = heroes.filter((x) => !x.dead).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          // the support hero (Raening) raises the fallen and heals anyone below half; the mage (Kusa) casts at what is near
          let pick = 0;
          if (h.name === 'Raening') {
            if (fallen && known.includes(12) && h.mana >= manaCost(12) + 20) pick = 12;
            else if (worst && worst.hp < worst.maxHp * 0.5 && known.includes(9) && h.mana >= manaCost(9)) pick = 9;
          } else if (h.name === 'Kusa') {
            const near = enemies.filter((en) => !en.e.dead && Math.hypot(en.e.x - h.x, (en.e.y - h.y) / 0.625) < 190);
            if (near.length) {
              const foe0 = near.sort((a, b) => Math.hypot(a.e.x - h.x, a.e.y - h.y) - Math.hypot(b.e.x - h.x, b.e.y - h.y))[0].e;
              h.dir = directionFromVector(foe0.x - h.x, (foe0.y - h.y) / 0.625);
              const order = near.length >= 3 ? [11, 10, 6, 5, 3, 2] : [3, 2, 5, 6, 10];
              pick = order.find((s) => known.includes(s) && h.mana >= manaCost(s) + 10) ?? 0;
            }
          }
          if (pick) {
            castSpell(undefined, h, pick);
            spellCd.set(h, 3);
            continue;
          }
        }
        let foe: Enemy | null = null;
        let fd = Infinity;
        for (const en of enemies) {
          if (en.e.dead) continue;
          const ld = Math.hypot(en.e.x - lead.x, (en.e.y - lead.y) / 0.625);
          const d = Math.hypot(en.e.x - h.x, (en.e.y - h.y) / 0.625);
          if (ld < 240 && d < fd) {
            fd = d;
            foe = en.e;
          }
        }
        if (!foe) continue;
        if (fd < reach) {
          h.dir = directionFromVector(foe.x - h.x, (foe.y - h.y) / 0.625);
          if ((fightCd.get(h) ?? 0) <= 0 && h.state !== 'attack') {
            h.attack();
            fightCd.set(h, 0.5);
          }
        } else if (!isBow(h) || fd > 220) party.engage.set(h, { x: foe.x, y: foe.y });
      }
      if (attackTarget && !attackTarget.dead && !running) {
        const dx = attackTarget.x - lead.x;
        const dy = (attackTarget.y - lead.y) / 0.625;
        const dist = Math.hypot(dx, dy);
        const reach = isBow(lead) ? 170 : 44;
        if (dist < reach) {
          lead.target = null;
          lead.dir = directionFromVector(dx, dy);
          lead.attack();
        } else if (lead.target) lead.target = { x: attackTarget.x, y: attackTarget.y };
      } else attackTarget = null;
      for (const h of heroes) if (!h.dead) h.mana = Math.min(h.maxMana, h.mana + 1.5 * dt);
      {
        const born: Effect[] = [];
        for (let i = fx.length - 1; i >= 0; i--) {
          const f = fx[i];
          if (!updateEffect(f.e, dt, world, enemies.map((en) => en.e), born)) {
            renderer.removeSprite(f.actor);
            fx.splice(i, 1);
          } else {
            const meta = effectSheets.get(f.e.sheet)!;
            const n = meta.records[f.e.record]?.frames.length ?? 1;
            f.actor.set(f.e.record, effectFrame(f.e, n), f.e.x, f.e.y, false);
          }
        }
        for (const b of born) void addEffect(b);
      }
      for (const en of enemies) {
        const e = en.e;
        e.update(dt, world, metas.get(e.sheet)!, lead);
        for (const h of heroes) {
          if (!h.swung || isBow(h) || e.dead || Math.hypot(e.x - h.x, (e.y - h.y) / 0.625) >= 64) continue;
          e.damage(h.attackPower);
          wearGear(h, ['weapon']);
        }
        if (e.swung) {
          e.swung = false;
          // the swing hits the nearest living hero in reach
          let best: Hero | null = null;
          let bd = 46;
          for (const h of heroes) {
            if (h.dead) continue;
            const d = Math.hypot(e.x - h.x, (e.y - h.y) / 0.625);
            if (d < bd) {
              bd = d;
              best = h;
            }
          }
          best?.takeDamage(mitigate(e.damageOut, best.defense));
          if (best) {
            void audio.play('attack1.wav', 0.5);
            wearGear(best, ['shield', 'cap', 'armor', 'shoes']);
          }
        }
      }
      for (let i = enemies.length - 1; i >= 0; i--)
        if (enemies[i].e.dead) {
          const dead = enemies[i].e;
          addXp(dead.xp);
          // a boss's "drop" can name an event instead: Hellminor (drop 34) triggers the entry 34 of this map on death
          const evt = dead.drop > 0 && dead.drop < 150 ? eventBlock(dead.drop) : null;
          const id = dead.drop > 0 ? dead.drop : Math.random() < 0.35 ? 200 : 0; // 200 = money; drop rates are placeholders
          if (evt) void runBlock(scriptFiles[evt.fi].file, evt.block);
          else if (id) void dropItem(id, dead.x, dead.y);
          renderer.removeSprite(enemies[i].actor);
          enemies.splice(i, 1);
        }
      // draw
      for (let i = 0; i < heroes.length; i++) {
        const h = heroes[i];
        const f = h.drawFrame(FLIP_SIDES);
        actors[i].set(f.record, f.frame, h.x, h.y, f.flip);
      }
      for (const en of enemies) {
        const f = en.e.drawFrame(FLIP_SIDES);
        en.actor.set(f.record, f.frame, en.e.x, en.e.y, f.flip);
        en.actor.mesh.visible = en.actor.mesh.visible && !(en.e.hurt > 0 && Math.floor(en.e.hurt * 20) % 2 === 0);
      }
      for (const pm of pendingMonsters) {
        if (pm.done || enemies.length >= 40) continue;
        const px = pm.o.x * TILE_W + TILE_W / 2;
        const py = pm.o.y * TILE_H + TILE_H - 2;
        if (Math.hypot(px - lead.x, (py - lead.y) / 0.625) < 340) {
          pm.done = true;
          void spawnEnemy(sheetForKind(pm.o.kind, monsterTable), px, py, pm.o.kind, 6 + pm.o.kind * 3, pm.o.extra >= 8 ? pm.o.extra : 0); // extra 1-7 is on a thousand monsters: not an item or event
        }
      }
      for (const p of props) {
        p.t += dt;
        const cnt = p.meta.records[p.record].frames.length;
        if (p.meta === spriteMeta && isBreakable(p.record)) {
          if (p.broke !== undefined) p.broke += dt;
          p.actor.set(p.record, breakableFrame(cnt, p.broke), p.x, p.y, false);
        } else p.actor.set(p.record, Math.floor(p.t * 8) % cnt, p.x, p.y, false);
      }
      for (const n of npcs) {
        if (!n.actor || n.record === null) continue;
        n.t += dt;
        const cnt = spriteMeta.records[n.record]?.frames.length || 1;
        n.actor.set(n.record, Math.floor(n.t * 8) % cnt, n.x, n.y, false);
      }
      for (const g of ground) {
        g.t += dt;
        const n = itemMeta.records[g.record]?.frames.length || 1;
        g.actor.set(g.record, Math.floor(g.t * 10) % n, g.x, g.y, false);
      }
      const pk = lead.dead ? -1 : findPickup(ground, lead.x, lead.y);
      if (pk >= 0) {
        const g = ground[pk];
        if (db.isMoney(g.id)) {
          story.money += 25; // placeholder amount
          toast('+25 money');
        } else {
          story.giveItem(g.id);
          toast(`Picked up ${db.name(g.id)}`);
          if (inv.open) inv.render();
        }
        void audio.play('item.wav', 0.6);
        renderer.removeSprite(g.actor);
        ground.splice(pk, 1);
      }
      if (toastT > 0 && (toastT -= dt) <= 0) toastEl.style.display = 'none';
      // "if you are killed your companions can revive you": stand next to a fallen hero for two seconds
      for (const down of heroes) {
        if (!down.dead) {
          helpT.delete(down);
          continue;
        }
        const near = !running && heroes.some((h) => !h.dead && Math.hypot(h.x - down.x, (h.y - down.y) / 0.625) < 44);
        const t = near ? (helpT.get(down) ?? 0) + dt : 0;
        if (t > 2 && !party.allDead) {
          down.revive();
          down.hp = Math.max(1, Math.round(down.maxHp * 0.3));
          helpT.delete(down);
          void addEffect(visual('MGC-EFF', 1, 10, down.x, down.y));
          toast(`${down.name} is back on their feet`);
        } else helpT.set(down, t);
      }
      heroes.forEach((h, i) => {
        lvEl.textContent = `Lv ${story.level} · xp ${story.xp}/${xpToNext(story.level)}`;
        bars[i].mfill.style.width = `${(100 * h.mana) / Math.max(1, h.maxMana)}%`;
        bars[i].plus.style.display = (story.points[h.name] ?? 0) > 0 ? 'block' : 'none';
        bars[i].fill.style.width = `${(100 * h.hp) / h.maxHp}%`;
        bars[i].row.className = 'row' + (h === party.leader ? ' lead' : '') + (h.dead ? ' down' : '');
        bars[i].row.style.opacity = h.dead ? '0.4' : '1';
      });
      if (party.allDead) {
        overEl.style.display = 'flex';
        respawnT += dt;
        if (respawnT > 3) {
          respawnT = 0;
          overEl.style.display = 'none';
          clearEnemies();
          clearEffects();
          heroes.forEach((h) => {
            h.revive();
            h.mana = h.maxMana;
          });
          party.setLeader(0);
          void enterMap(restTown()); // "Now I'm going to have a rest at my place."
        }
      }
      renderer.render(party.leader.x, party.leader.y - 20);
      for (const h of heroes) if (!h.dead) minimap.reveal(h.x, h.y, 14 + 4 * (buff.sight ?? 0));
      minimap.draw(party.leader.x, party.leader.y - 20, VIEW_W, VIEW_H, [
        ...npcs.map((n) => ({ x: n.x, y: n.y, color: '#ffd84a' })),
        ...enemies.filter((en) => !en.e.dead).map((en) => ({ x: en.e.x, y: en.e.y, color: '#ff3a3a' })),
        ...heroes.map((h) => ({ x: h.x, y: h.y, color: h === party.leader ? '#fff' : '#6cf' })),
      ]);
      saveT += dt;
      questT += dt;
      if (questT > 0.5) {
        questT = 0;
        refreshQuick();
        watchQuests();
      }
      if (saveT > 5) {
        saveT = 0;
        saveGame();
      }
      statusT += dt;
      if (statusT > 0.25) {
        statusT = 0;
        quickEl.style.visibility = dlg.open || menu.open ? 'hidden' : 'visible';
        yearNum.textContent = String(Math.floor(story.year));
        const enc = encumbrance(loadNow(), capacityNow());
        if (Math.abs(enc - encumb) > 0.001) {
          encumb = enc;
          refreshHeroStats();
          if (enc < 1) toast('Too heavy: you walk slower');
        }
        updatePlace();
        yearOrb.style.left = `${(story.year % 1) * 100}%`;
        const of = orbFrames[(orbN = (orbN + 1) % orbFrames.length)];
        if (of) yearOrb.style.background = `url(${iconUrl}) -${of.x}px -${of.y}px`;
        const l = party.leader;
        const near = dlg.open ? null : nearestNpc(lead.x, lead.y, 70);
        status.textContent = (near ? `[E / tap] talk to ${near.name} · ` : '') + `Year ${Math.floor(story.year)} · ${mapEntry.id.toUpperCase()} ${mapEntry.name} · ${l.name} cell ${Math.floor(l.x / TILE_W)},${Math.floor(l.y / TILE_H)} · tiles ${renderer.stats.drawnTiles}${lastEffect ? ' · fx: ' + lastEffect : ''}`;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (!params.has('notitle') && !devMode) {
    showTitle(
      document.getElementById('title')!,
      !!saved,
      () => {
        audio.unlock();
        musicBtn.textContent = `♪ music: ${audio.isMusicOn() ? 'on' : (audio.toggleMusic(), 'on')}`;
      },
      () => {
        try {
          localStorage.removeItem(SAVE_KEY);
        } catch {
          /* ignore */
        }
        location.reload();
      },
    );
  }

  // handy for poking around in the browser console
  (window as unknown as Record<string, unknown>).akuma = { story, party, renderer, enterMap, index, db, dropItem, spawnEnemy, castSpell, npcs, scriptFiles, runBlock, dlg, props, selectSpell: (k: number) => { spellSel = k; }, enemies };
}

boot().catch((e) => {
  document.getElementById('status')!.textContent = 'error: ' + (e as Error).message;
  console.error(e);
});
