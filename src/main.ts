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
import { GAME_TRACKS, MoviePlayer, showTitle, WorldMapUI } from './ui/overlays';
import { Party } from './game/party';
import { applyStory, makeSave, parseSave, SAVE_KEY } from './game/save';
import { TILE_H, TILE_W, World } from './game/world';
import { loadItemStats, loadLang, loadMonsters, loadMap, loadMapIndex, loadSpriteMeta, loadText, loadTilesets } from './data/loaders';
import { MapIndexEntry, SpriteSheetMeta, TilesetTable } from './data/types';
import { GameRenderer, SpriteActor, VIEW_H, VIEW_W } from './render/renderer';
import { Arg, EvtBlock, EvtFile, parseEvt } from './script/parser';
import { EvtInterpreter } from './script/interpreter';
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
    Promise.all(['sam.evt', 'under.evt'].map(async (f) => parseEvt(await loadText(`scripts/${f}`)))),
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
  interface Npc { name: string; x: number; y: number; record: number | null; actor: SpriteActor | null; blocks: { fi: number; block: EvtBlock }[]; t: number }
  const npcs: Npc[] = [];
  let pendingMonsters: { o: MapObject; done: boolean }[] = [];
  interface Prop { x: number; y: number; meta: SpriteSheetMeta; record: number; actor: SpriteActor; t: number }
  const props: Prop[] = [];

  async function buildMapObjects(mapNo: number, objs: MapObject[]): Promise<void> {
    for (const n of npcs) if (n.actor) renderer.removeSprite(n.actor);
    npcs.length = 0;
    for (const p of props) renderer.removeSprite(p.actor);
    props.length = 0;
    const scripted = new Set<number>();
    scriptFiles.forEach((sf) => sf.file.blocks.forEach((b) => b.map === mapNo && scripted.add(b.object)));
    const free = objs.filter((o) => !scripted.has(o.index));
    // villages (t1-t6) list class 1-47 entries too (a Satan in the Western Village), so those are not monsters there
    pendingMonsters = mapEntry.id.startsWith('t') ? [] : monsterSpawns(free).map((o) => ({ o, done: false }));
    for (const o of free) {
      const role = objectRole(o);
      if (role !== 'prop' && role !== 'scenery') continue;
      const meta = role === 'prop' ? spriteMeta : backMeta;
      if (!meta.records[o.kind]?.frames.length) continue;
      props.push({ x: o.x * TILE_W + TILE_W / 2, y: o.y * TILE_H + TILE_H - 2, meta, record: o.kind, actor: await renderer.createSprite(meta), t: Math.random() * 2 });
    }
    const byObject = new Map<number, { fi: number; block: EvtBlock }[]>();
    scriptFiles.forEach((sf, fi) =>
      sf.file.blocks.forEach((block) => {
        if (block.map !== mapNo) return;
        const list = byObject.get(block.object) ?? [];
        list.push({ fi, block });
        byObject.set(block.object, list);
      }),
    );
    for (const [objectId, blocks] of byObject) {
      const o = objs.find((x) => x.index === objectId);
      if (!o) continue;
      const record = npcSpriteRecord(blocks[0].block.name);
      const actor = record === null ? null : await renderer.createSprite(spriteMeta);
      npcs.push({ name: blocks[0].block.name.trim() || `object ${objectId}`, x: o.x * TILE_W + TILE_W / 2, y: o.y * TILE_H + TILE_H - 2, record, actor, blocks, t: Math.random() });
    }
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
        await spawnEnemy(sheetForKind(Number(args[3])), p.x, p.y, Number(args[3]), Number(args[4]), Number(args[5] ?? 0));
      }
      if (name === 'LOCATE_ITEM' && args.length >= 4 && Number(args[0]) === index.findIndex((m) => m.id === mapEntry.id) + 1) {
        await dropItem(Number(args[3]), Number(args[1]) * TILE_W + TILE_W / 2, Number(args[2]) * TILE_H + TILE_H - 2);
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
  hud.append(mapSelect, npcSelect, spawnSelect, ...leaderBtns, markerBtn, musicBtn);

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
  const worldUI = new WorldMapUI(document.getElementById('world')!, index, (id) => void enterMap(id));
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
  hud.append(worldBtn, movieSelect);
  const invBtn = document.createElement('button');
  invBtn.textContent = 'Items (I)';
  invBtn.onclick = () => inv.toggle();
  hud.append(invBtn);
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
        const pick = pickBlock(tapped.blocks);
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
    const pick = pickBlock(n.blocks);
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
          const id = dead.drop > 0 ? dead.drop : Math.random() < 0.35 ? 200 : 0; // 200 = money; drop rates are placeholders
          if (id) void dropItem(id, dead.x, dead.y);
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
          void spawnEnemy(sheetForKind(pm.o.kind), px, py, pm.o.kind, 6 + pm.o.kind * 3, pm.o.extra);
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
  (window as unknown as Record<string, unknown>).akuma = { story, party, renderer, enterMap, index, db, dropItem, spawnEnemy, castSpell, selectSpell: (k: number) => { spellSel = k; }, enemies };
}

boot().catch((e) => {
  document.getElementById('status')!.textContent = 'error: ' + (e as Error).message;
  console.error(e);
});
