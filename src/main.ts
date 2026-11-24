import { AudioPlayer } from './game/audio';
import { collectArrivals } from './game/arrivals';
import { Enemy } from './game/enemy';
import { ENEMY_SHEETS, sheetForKind } from './game/enemies';
import { Hero } from './game/hero';
import { Party } from './game/party';
import { TILE_H, TILE_W, World } from './game/world';
import { loadMap, loadMapIndex, loadSpriteMeta, loadText, loadTilesets } from './data/loaders';
import { MapIndexEntry, SpriteSheetMeta, TilesetTable } from './data/types';
import { GameRenderer, SpriteActor, VIEW_H, VIEW_W } from './render/renderer';
import { Arg, EvtBlock, EvtFile, parseEvt } from './script/parser';
import { EvtInterpreter } from './script/interpreter';
import { StoryState } from './script/state';
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

  const [index, tilesets, files] = await Promise.all([
    loadMapIndex(),
    loadTilesets() as Promise<TilesetTable>,
    Promise.all(['sam.evt', 'under.evt'].map(async (f) => parseEvt(await loadText(`scripts/${f}`)))),
  ]);
  const scriptFiles: { tag: string; file: EvtFile }[] = [
    { tag: '1', file: files[0] },
    { tag: '2', file: files[1] },
  ];

  const arrivals = collectArrivals(files);
  const renderer = new GameRenderer(canvas);
  const audio = new AudioPlayer();
  const story = new StoryState();
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
  const enemies: { e: Enemy; actor: SpriteActor }[] = [];

  async function spawnEnemy(sheet: string, x: number, y: number, kind = 0, power = 20): Promise<void> {
    if (!metas.has(sheet)) metas.set(sheet, await loadSpriteMeta(sheet));
    const actor = await renderer.createSprite(metas.get(sheet)!);
    enemies.push({ e: new Enemy(sheet, x, y, kind, power), actor });
  }
  function clearEnemies(): void {
    for (const en of enemies) renderer.removeSprite(en.actor);
    enemies.length = 0;
  }

  let world: World | null = null;
  let mapEntry: MapIndexEntry = index[0];
  let lastEffect = '';

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
    party.placeAt(spawn.x, spawn.y);
    audio.setMusic(2 + (entry.order % 14));
    history.replaceState(null, '', `#${entry.id}`);
    mapSelect.value = entry.id;
    refreshNpcList();
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
        await spawnEnemy(sheetForKind(Number(args[3])), p.x, p.y, Number(args[3]), Number(args[4]));
      }
      lastEffect = `${name} ${args.join(' ')}`;
      console.info('[script effect]', lastEffect);
    },
    (s) => void audio.play(s),
    (m) => console.warn('[script]', m),
  );
  let running = false;
  async function runBlock(file: EvtFile, block: EvtBlock): Promise<void> {
    if (running) return;
    running = true;
    party.leader.input.x = party.leader.input.y = 0;
    const res = await new EvtInterpreter(file, block, story, dlg).run();
    if (res.reason === 'ERROR') console.error('[script]', res.message);
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
    row.append(name, bar);
    partyEl.appendChild(row);
    return { row, fill };
  });
  let respawnT = 0;

  // ---------------------------------------------------------------- input
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (dlg.open) return;
    audio.unlock();
    keys.add(e.key.toLowerCase());
    if (e.key >= '1' && e.key <= '3' && !heroes[Number(e.key) - 1].dead) party.setLeader(Number(e.key) - 1);
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
    party.leader.target = { x: wx, y: wy };
    party.leader.input.x = party.leader.input.y = 0;
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    party.leader.attack();
  });

  function readKeys(): void {
    const l = party.leader;
    l.input.x = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
    l.input.y = (keys.has('arrowdown') || keys.has('s') ? 1 : 0) - (keys.has('arrowup') || keys.has('w') ? 1 : 0);
  }

  // ---------------------------------------------------------------- loop
  await enterMap((location.hash.slice(1) || params.get('map') || 't1').toLowerCase());

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
      for (const en of enemies) {
        const e = en.e;
        e.update(dt, world, metas.get(e.sheet)!, lead);
        if (lead.swung && !e.dead && Math.hypot(e.x - lead.x, (e.y - lead.y) / 0.625) < 64) e.damage(1);
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
          best?.takeDamage(e.damageOut);
          if (best) void audio.play('attack1.wav', 0.5);
        }
      }
      for (let i = enemies.length - 1; i >= 0; i--)
        if (enemies[i].e.dead) {
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
      heroes.forEach((h, i) => {
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
          heroes.forEach((h) => h.revive());
          party.setLeader(0);
          void enterMap(mapEntry.id);
        }
      }
      renderer.render(party.leader.x, party.leader.y - 20);
      statusT += dt;
      if (statusT > 0.25) {
        statusT = 0;
        const l = party.leader;
        status.textContent = `${mapEntry.id.toUpperCase()} ${mapEntry.name} · ${l.name} cell ${Math.floor(l.x / TILE_W)},${Math.floor(l.y / TILE_H)} · tiles ${renderer.stats.drawnTiles}${lastEffect ? ' · fx: ' + lastEffect : ''}`;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // handy for poking around in the browser console
  (window as unknown as Record<string, unknown>).akuma = { story, party, renderer, enterMap, index };
}

boot().catch((e) => {
  document.getElementById('status')!.textContent = 'error: ' + (e as Error).message;
  console.error(e);
});
