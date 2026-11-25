import { assetUrl } from '../data/loaders';
import { SpriteSheetMeta } from '../data/types';

/** MENUICON.GOS records: each is [normal, highlighted] button art */
export const ART = { singlePlay: 0, quit: 3, newGame: 4, loadGame: 5, saveGame: 7, load: 8, option: 9, exitToMenu: 10, continueGame: 11 } as const;

let sheet: { url: string; w: number; frames: ({ x: number; y: number; w: number; h: number } | null)[][] } | null = null;

export function setMenuArt(meta: SpriteSheetMeta): void {
  const page = meta.pages[0];
  sheet = { url: assetUrl(`sprites/${page.file}`), w: page.w, frames: meta.records.map((r) => r.frames) };
}

/** a button drawn with the original art (falls back to text if the sheet is missing); highlights on hover or press */
export function artButton(rec: number, label: string, on: (e: MouseEvent) => void, scale = 1): HTMLElement {
  const fr = sheet?.frames[rec];
  const b = document.createElement('button');
  b.onclick = on;
  if (!sheet || !fr || !fr[0]) {
    b.textContent = label;
    return b;
  }
  b.setAttribute('aria-label', label);
  b.className = 'art';
  const set = (i: number): void => {
    const f = fr[i] ?? fr[0]!;
    b.style.width = `${f.w * scale}px`;
    b.style.height = `${f.h * scale}px`;
    b.style.background = `#000 url(${sheet!.url}) -${f.x * scale}px -${f.y * scale}px / ${sheet!.w * scale}px auto no-repeat`;
  };
  set(0);
  b.onpointerenter = () => set(1);
  b.onpointerleave = () => set(0);
  b.onpointerdown = () => set(1);
  return b;
}
