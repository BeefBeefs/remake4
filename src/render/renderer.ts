import * as THREE from 'three';
import { SpriteFrame, SpriteSheetMeta, TilesetMeta } from '../data/types';
import { World } from '../game/world';
import { assetUrl } from '../data/loaders';
import { buildChunk, CHUNK } from './tilemesh';

export const VIEW_W = 640;
export const VIEW_H = 480;

const loader = new THREE.TextureLoader();

async function pixelTexture(url: string): Promise<THREE.Texture> {
  const t = await loader.loadAsync(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** One animated sprite (a hero, an enemy...) drawn from a packed GOS atlas. */
export class SpriteActor {
  readonly mesh: THREE.Mesh;
  private uv: THREE.BufferAttribute;

  constructor(
    readonly meta: SpriteSheetMeta,
    _pages: THREE.Texture[],
    private materials: THREE.MeshBasicMaterial[],
  ) {
    const g = new THREE.PlaneGeometry(1, 1);
    this.uv = g.getAttribute('uv') as THREE.BufferAttribute;
    this.mesh = new THREE.Mesh(g, materials[0]);
    this.mesh.visible = false;
  }

  /** place frame `frame` of record `record` with its hotspot at world (x, y) */
  set(record: number, frame: number, x: number, y: number, flip: boolean): void {
    const f: SpriteFrame | null | undefined = this.meta.records[record]?.frames[frame];
    if (!f) {
      this.mesh.visible = false;
      return;
    }
    const pg = this.meta.pages[f.page];
    const left = flip ? -(f.ox + f.w) : f.ox;
    const px = Math.round(x);
    const py = Math.round(y);
    this.mesh.visible = true;
    this.mesh.material = this.materials[f.page];
    this.mesh.scale.set(f.w, f.h, 1);
    this.mesh.position.set(px + left + f.w / 2, -(py + f.oy + f.h / 2), 2 + py / 10000);
    const u0 = f.x / pg.w;
    const u1 = (f.x + f.w) / pg.w;
    const vTop = 1 - f.y / pg.h;
    const vBot = 1 - (f.y + f.h) / pg.h;
    const a = flip ? u1 : u0;
    const b = flip ? u0 : u1;
    // PlaneGeometry uv order: top-left, top-right, bottom-left, bottom-right
    this.uv.setXY(0, a, vTop);
    this.uv.setXY(1, b, vTop);
    this.uv.setXY(2, a, vBot);
    this.uv.setXY(3, b, vBot);
    this.uv.needsUpdate = true;
  }

  /** textures and materials are shared per sheet (owned by GameRenderer); only the quad is released */
  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-VIEW_W / 2, VIEW_W / 2, VIEW_H / 2, -VIEW_H / 2, 0.1, 100);
  private mapGroup = new THREE.Group();
  private tileTex: THREE.Texture | null = null;
  private tileMat: THREE.MeshBasicMaterial | null = null;
  private world: World | null = null;
  private tileMeta: TilesetMeta | null = null;
  private showMarkers = false;
  readonly stats = { drawnTiles: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(VIEW_W, VIEW_H, false);
    this.renderer.setClearColor(0x000000, 1);
    this.camera.position.set(0, 0, 10);
    this.scene.add(this.mapGroup);
  }

  async setWorld(world: World, tileMeta: TilesetMeta, tilesetId: string): Promise<void> {
    this.world = world;
    this.tileMeta = tileMeta;
    this.tileTex?.dispose();
    this.tileTex = await pixelTexture(assetUrl(`tiles/${tilesetId}.png`));
    this.tileMat?.dispose();
    this.tileMat = new THREE.MeshBasicMaterial({ map: this.tileTex, transparent: true, alphaTest: 0.5 });
    this.rebuildMap();
  }

  setShowMarkers(v: boolean): void {
    this.showMarkers = v;
    if (this.world) this.rebuildMap();
  }

  private rebuildMap(): void {
    const w = this.world!;
    const ts = this.tileMeta!;
    for (const c of [...this.mapGroup.children]) {
      (c as THREE.Mesh).geometry.dispose();
      this.mapGroup.remove(c);
    }
    let tiles = 0;
    // sprites sit at z = 2; overhead tiles (roofs) are drawn in front of them
    for (const [layer, z] of [['ground', 0], ['objects', 1], ['overhead', 3]] as const) {
      for (let cy = 0; cy * CHUNK < w.map.h; cy++) {
        for (let cx = 0; cx * CHUNK < w.map.w; cx++) {
          const a = buildChunk(w, layer, cx, cy, ts, this.showMarkers);
          if (!a) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(a.positions, 3));
          g.setAttribute('uv', new THREE.BufferAttribute(a.uvs, 2));
          g.setIndex(new THREE.BufferAttribute(a.indices, 1));
          const m = new THREE.Mesh(g, this.tileMat!);
          m.position.z = z;
          m.frustumCulled = false;
          this.mapGroup.add(m);
          tiles += a.quads;
        }
      }
    }
    this.stats.drawnTiles = tiles;
  }

  private sheets = new Map<string, Promise<{ pages: THREE.Texture[]; mats: THREE.MeshBasicMaterial[] }>>();

  async createSprite(meta: SpriteSheetMeta): Promise<SpriteActor> {
    let p = this.sheets.get(meta.name);
    if (!p) {
      p = Promise.all(meta.pages.map((pg) => pixelTexture(assetUrl(`sprites/${pg.file}`)))).then((pages) => ({
        pages,
        mats: pages.map((t) => new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.5 })),
      }));
      this.sheets.set(meta.name, p);
    }
    const { pages, mats } = await p;
    const a = new SpriteActor(meta, pages, mats);
    this.scene.add(a.mesh);
    return a;
  }

  removeSprite(a: SpriteActor): void {
    this.scene.remove(a.mesh);
    a.dispose();
  }

  /** camera centre in world pixels (y down), clamped to the map */
  render(camX: number, camY: number): void {
    const w = this.world;
    let x = camX;
    let y = camY;
    if (w) {
      x = w.pixelW <= VIEW_W ? w.pixelW / 2 : Math.min(Math.max(x, VIEW_W / 2), w.pixelW - VIEW_W / 2);
      y = w.pixelH <= VIEW_H ? w.pixelH / 2 : Math.min(Math.max(y, VIEW_H / 2), w.pixelH - VIEW_H / 2);
    }
    this.camera.position.set(Math.round(x), -Math.round(y), 10);
    this.renderer.render(this.scene, this.camera);
  }
}
