import { AudioPlayer } from './game/audio';
import { collectArrivals } from './game/arrivals';
import { Enemy } from './game/enemy';
import { ENEMY_SHEETS, sheetForKind } from './game/enemies';
import { Hero } from './game/hero';
import { MapObject, monsterSpawns, objectRole, parseMapObjects } from './data/mapobjects';
import { basicBlockFor, npcSpriteRecord, pickBlock } from './game/npcs';
import { findPickup, GroundItem } from './game/ground';
import { ItemDb } from './game/itemdb';
import { directionFromVector } from './game/anim';
import { arrow, aura, Effect, effectFrame, fireBall, fireWall, ghostBolt, lightning, rain, shell, updateEffect, visual } from './game/effects';
import { derive, LEVEL_GAIN, mitigate, Slot, slotOf, xpToNext } from './game/stats';
import { InventoryUI } from './ui/inventory';
import { QuestLog } from './ui/quests';
import { GAME_TRACKS, MoviePlayer, showTitle, WorldMapUI } from './ui/overlays';
import { Party } from './game/party';
import { applyStory, makeSave, parseSave, SAVE_KEY } from './game/save';
import { TILE_H, TILE_W, World } from './game/world';
import { loadItemStats, loadLang, loadMonsters, loadMap, loadMapIndex, loadSpriteMeta, loadText, loadTilesets } from './data/loaders';
import { MapIndexEntry, SpriteSheetMeta, TilesetTable } from './data/types';
import { GameRenderer, SpriteActor, VIEW_H, VIEW_W } from './render/renderer';
import { Arg, EvtBlock, EvtFile, parseEvt } from './script/parser';
import { EvtInterpreter } from './script/interpreter';
import { shiftMapNumbers, UNDERWORLD_OFFSET } from './script/mapnumbers';
import { StatName, StoryState } from './script/state';
import { DialogueUI } from './ui/dialogue';

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
  const renderer = new GameRenderer(canvas);
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
  interface Prop { object: number; x: number; y: number; meta: SpriteSheetMeta; record: number; actor: SpriteActor; t: number }
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
    scriptFiles.forEach((sf) => sf.file.blocks.forEach((b) => b.map === mapNo && scripted.add(b.object)));
    objs = objs.filter((o) => !story.removed.has(`${mapNo}:${o.index}`)); // removed by a script earlier
    const free = objs.filter((o) => !scripted.has(o.index));
    // villages (t1-t6) list class 1-47 entries too (a Satan in the Western Village), so those are not monsters there
    pendingMonsters = mapEntry.id.startsWith('t') ? [] : monsterSpawns(free).map((o) => ({ o, done: false }));
    for (const o of free) {
      const role = objectRole(o);
      if (role !== 'prop' && role !== 'scenery') continue;
      const meta = role === 'prop' ? spriteMeta : backMeta;
      if (!meta.records[o.kind]?.frames.length) continue;
      props.push({ object: o.index, x: o.x * TILE_W + TILE_W / 2, y: o.y * TILE_H + TILE_H - 2, meta, record: o.kind, actor: await renderer.createSprite(meta), t: Math.random() * 2 });
    }
    const objectIds = new Set<number>();
    scriptFiles.forEach((sf) => sf.file.blocks.forEach((b) => b.map === mapNo && objectIds.add(b.object)));
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
    await renderer.setWorld(world, meta, map.tileset);
    mapEntry = entry;
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

  // ---------------------------------------------------------------- save / load
  let restoring = false;
  function saveGame(): void {
    if (devMode || restoring || party.allDead) return;
    try {
      const l = party.leader;
      localStorage.setItem(SAVE_KEY, JSON.stringify(makeSave(story, heroes, party.leaderIndex, mapEntry.id, l.x, l.y)));
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
        toast('The hellgate has opened...');
        story.flags.add(9001);
        await enterMap('b1');
      }
      if (name === 'GO_END2') {
        toast('The End - thank you for playing');
        story.flags.add(9002);
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
        // this object answers with entry n from now on (0 = its first entry again)
        const n = Number(args[0]);
        const key = `${mapNoNow}:${curNpc.object}`;
        if (n > 0) story.entry.set(key, n);
        else story.entry.delete(key);
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
  async function runBlock(file: EvtFile, block: EvtBlock): Promise<void> {
    if (running) return;
    running = true;
    curNpc = npcs.find((n) => n.blocks.some((b) => b.block === block)) ?? null;
    party.leader.input.x = party.leader.input.y = 0;
    let cur = block;
    for (let hops = 0; hops < 3; hops++) {
      const res = await new EvtInterpreter(file, cur, story, dlg).run();
      if (res.reason === 'ERROR') console.error('[script]', res.message);
      if (res.reason !== 'BASIC') break;
      // GO_BASIC_EVENT: fall back to the object's default (BASIC) entry - the shop / plain talk
      const basic = basicBlockFor(file.blocks, cur.name, mapEntry.id);
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
  function castSpell(): void {
    const h = party.leader;
    const k = knownSpells().includes(spellSel) ? spellSel : knownSpells()[0];
    if (!k || h.dead || running || dlg.open) return;
    const cost = manaCost(k);
    if (h.mana < cost) {
      toast('Not enough mana');
      return;
    }
    const d = derive(db, story.stats, story.level, h.gear);
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
  function refreshHeroStats(): void {
    for (const h of heroes) {
      const d = derive(db, story.stats, story.level, h.gear);
      const frac = h.maxHp ? h.hp / h.maxHp : 1;
      h.maxHp = d.maxHp;
      h.hp = h.dead ? 0 : Math.max(1, Math.round(d.maxHp * frac));
      const mf = h.maxMana ? h.mana / h.maxMana : 1;
      h.maxMana = d.maxMana;
      h.mana = Math.round(d.maxMana * mf);
      h.attackPower = d.attack;
      h.defense = d.defense;
      h.speedMul = d.speedMul;
    }
  }
  refreshHeroStats();
  function addXp(n: number): void {
    story.xp += n;
    let up = false;
    while (story.xp >= xpToNext(story.level)) {
      story.xp -= xpToNext(story.level);
      story.level++;
      for (const k of Object.keys(LEVEL_GAIN) as StatName[]) story.stats[k] += LEVEL_GAIN[k];
      up = true;
    }
    if (up) {
      refreshHeroStats();
      for (const h of heroes) if (!h.dead) h.hp = h.maxHp;
      toast(`Level ${story.level}!`);
    }
  }

  const inv = new InventoryUI(
    document.getElementById('inv')!,
    db,
    story,
    (fraction) => {
      // heal the most wounded living hero
      const h = heroes.filter((x) => !x.dead).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (!h || h.hp >= h.maxHp) return false;
      h.hp = Math.min(h.maxHp, h.hp + Math.round(h.maxHp * fraction));
      return true;
    },
    toast,
    {
      names: HERO_DEFS.map((d) => d.name),
      gear: (i) => heroes[i].gear,
      derived: (i) => derive(db, story.stats, story.level, heroes[i].gear),
      hp: (i) => [Math.ceil(heroes[i].hp), heroes[i].maxHp],
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
  const helpEl = document.getElementById('help')!;
  helpEl.innerHTML = `<h3>How to play</h3>
    <b>Touch</b><ul><li>Tap the ground to walk, tap a monster to attack it, tap a villager next to you to talk.</li>
    <li>Bottom buttons: change spell (the arrow), cast it, attack.</li><li>1 / 2 / 3 buttons pick who you lead.</li></ul>
    <b>Keyboard</b><ul><li>Arrows / WASD move, Space attacks, E or Enter talks, F casts, Q changes spell.</li>
    <li>1-3 or Z / X / C pick the leader, I items, J quests, M world map.</li></ul>
    <b>Good to know</b><ul><li>The game saves itself; Continue appears on the title screen.</li>
    <li>Some places on the world map stay locked until villagers tell you about them.</li>
    <li>The gear button holds debug tools (jump to any map, spawn monsters).</li></ul>
    <button>Close</button>`;
  helpEl.addEventListener('click', (e) => e.stopPropagation());
  helpEl.querySelector('button')!.addEventListener('click', () => (helpEl.style.display = 'none'));
  const helpBtn = document.createElement('button');
  helpBtn.textContent = '?';
  helpBtn.onclick = () => (helpEl.style.display = helpEl.style.display === 'block' ? 'none' : 'block');
  hud.append(questBtn, helpBtn, gearBtn, devBox);
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
    row.append(name, bar, mbar);
    partyEl.appendChild(row);
    return { row, fill, mfill };
  });
  const lvEl = document.createElement('div');
  lvEl.style.textAlign = 'right';
  partyEl.prepend(lvEl);
  let respawnT = 0;

  // ---------------------------------------------------------------- input
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (dlg.open) return;
    audio.unlock();
    keys.add(e.key.toLowerCase());
    if (e.key >= '1' && e.key <= '3' && !heroes[Number(e.key) - 1].dead) party.setLeader(Number(e.key) - 1);
    const zxc = 'zxc'.indexOf(e.key.toLowerCase());
    if (zxc >= 0 && !heroes[zxc].dead) party.setLeader(zxc); // the manual's Z / X / C hot keys
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
        const pick = pickBlock(tapped.blocks, story.entry.get(`${mapEntryNo()}:${tapped.object}`));
        if (!running) void runBlock(scriptFiles[pick.fi].file, pick.block);
        return;
      }
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

  function talkToNearest(): void {
    const n = nearestNpc(party.leader.x, party.leader.y, 70);
    if (!n || running) return;
    const pick = pickBlock(n.blocks, story.entry.get(`${mapEntryNo()}:${n.object}`));
    audio.unlock();
    void runBlock(scriptFiles[pick.fi].file, pick.block);
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
  if (saved) {
    restoring = true;
    applyStory(story, saved);
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
      party.update(dt, world, metas);
      party.ensureLeaderAlive();
      const lead = party.leader;
      if (lead.swung && isBow(lead)) {
        const w = lead.gear.weapon!;
        void addEffect(arrow(lead.x, lead.y, lead.dir, lead.attackPower, (db.stat(w).range ?? 6) * 32));
        void audio.play('arrow1.wav', 0.5);
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
        if (lead.swung && !isBow(lead) && !e.dead && Math.hypot(e.x - lead.x, (e.y - lead.y) / 0.625) < 64) e.damage(lead.attackPower);
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
          if (best) void audio.play('attack1.wav', 0.5);
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
          void spawnEnemy(sheetForKind(pm.o.kind, monsterTable), px, py, pm.o.kind, 6 + pm.o.kind * 3, pm.o.extra);
        }
      }
      for (const p of props) {
        p.t += dt;
        const cnt = p.meta.records[p.record].frames.length;
        p.actor.set(p.record, Math.floor(p.t * 8) % cnt, p.x, p.y, false);
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
      heroes.forEach((h, i) => {
        lvEl.textContent = `Lv ${story.level} · xp ${story.xp}/${xpToNext(story.level)}`;
        bars[i].mfill.style.width = `${(100 * h.mana) / Math.max(1, h.maxMana)}%`;
        bars[i].fill.style.width = `${(100 * h.hp) / h.maxHp}%`;
        bars[i].row.className = 'row' + (h === party.leader ? ' lead' : '');
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
          void enterMap(mapEntry.id);
        }
      }
      renderer.render(party.leader.x, party.leader.y - 20);
      saveT += dt;
      questT += dt;
      if (questT > 0.5) {
        questT = 0;
        watchQuests();
      }
      if (saveT > 5) {
        saveT = 0;
        saveGame();
      }
      statusT += dt;
      if (statusT > 0.25) {
        statusT = 0;
        const l = party.leader;
        const near = dlg.open ? null : nearestNpc(lead.x, lead.y, 70);
        status.textContent = (near ? `[E / tap] talk to ${near.name} · ` : '') + `${mapEntry.id.toUpperCase()} ${mapEntry.name} · ${l.name} cell ${Math.floor(l.x / TILE_W)},${Math.floor(l.y / TILE_H)} · tiles ${renderer.stats.drawnTiles}${lastEffect ? ' · fx: ' + lastEffect : ''}`;
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
  (window as unknown as Record<string, unknown>).akuma = { story, party, renderer, enterMap, index, db, dropItem, spawnEnemy, castSpell, npcs, scriptFiles, runBlock, dlg, selectSpell: (k: number) => { spellSel = k; }, enemies };
}

boot().catch((e) => {
  document.getElementById('status')!.textContent = 'error: ' + (e as Error).message;
  console.error(e);
});
