import { assetUrl } from '../data/loaders';
import { ART, artButton } from './artbutton';
import { MapIndexEntry } from '../data/types';

/** The two world pictures with a marker per place, positioned from the EXE's map table. */
export class WorldMapUI {
  private tab: 'world' | 'under' = 'world';
  constructor(
    private el: HTMLElement,
    private maps: MapIndexEntry[],
    private onGo: (id: string) => void,
    /** true for places that cannot be entered yet (shown dimmed) */
    private sealed: (m: MapIndexEntry) => boolean = () => false,
  ) {
    el.addEventListener('click', (e) => e.stopPropagation());
  }

  get open(): boolean {
    return this.el.style.display === 'block';
  }

  toggle(current?: string): void {
    if (this.open) {
      this.el.style.display = 'none';
      return;
    }
    const here = this.maps.find((m) => m.id === current);
    if (here) this.tab = here.world === 2 ? 'under' : 'world';
    this.el.style.display = 'block';
    this.render(current);
  }

  private render(current?: string): void {
    this.el.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'bar';
    for (const [key, label] of [['world', 'World'], ['under', 'Underworld']] as const) {
      const b = document.createElement('button');
      b.textContent = label;
      if (this.tab === key) b.className = 'on';
      b.onclick = () => {
        this.tab = key;
        this.render(current);
      };
      bar.appendChild(b);
    }
    const x = document.createElement('button');
    x.textContent = '✕';
    x.onclick = () => this.toggle();
    bar.appendChild(x);
    this.el.appendChild(bar);
    const pic = document.createElement('div');
    pic.className = 'pic';
    pic.style.backgroundImage = `url(${assetUrl(this.tab === 'world' ? 'images/world1.webp' : 'images/world2.webp')})`;
    const world = this.tab === 'world' ? 1 : 2;
    for (const m of this.maps) {
      if (m.world !== world) continue;
      // positions come from the EXE's map table, in the 800x600 picture's coordinates
      const left = `${(m.wx / 800) * 100}%`;
      const top = `${(m.wy / 600) * 100}%`;
      const b = document.createElement('button');
      const shut = this.sealed(m);
      b.className = 'spot' + (/^[cd]/.test(m.id) ? ' cave' : '') + (m.id === current ? ' here' : '') + (shut ? ' sealed' : '');
      b.disabled = shut;
      b.style.left = left;
      b.style.top = top;
      b.title = m.name;
      b.onclick = () => {
        this.toggle();
        this.onGo(m.id);
      };
      const l = document.createElement('div');
      l.className = 'lbl';
      l.textContent = shut ? '\u{1F512}' : m.name;
      l.style.left = left;
      l.style.top = top;
      pic.append(b, l);
    }
    this.el.appendChild(pic);
  }
}

/** Fullscreen player for the converted intro videos. */
export class MoviePlayer {
  constructor(private el: HTMLElement) {
    el.addEventListener('click', () => this.stop());
  }

  play(name: string): void {
    this.el.innerHTML = '';
    const v = document.createElement('video');
    v.src = assetUrl(`video/${name}.mp4`);
    v.autoplay = true;
    v.playsInline = true;
    v.controls = false;
    v.onended = () => this.stop();
    this.el.appendChild(v);
    this.el.style.display = 'flex';
    void v.play().catch(() => {});
  }

  stop(): void {
    this.el.querySelector('video')?.pause();
    this.el.innerHTML = '';
    this.el.style.display = 'none';
  }
}

export interface Slide {
  image: string;
  text?: string;
}

/** Full-screen pictures with a caption, one per click / tap; resolves after the last one. Reuses the movie layer. */
export function showSlides(el: HTMLElement, slides: Slide[]): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const next = (): void => {
      if (i >= slides.length) {
        el.onclick = null;
        el.innerHTML = '';
        el.style.display = 'none';
        resolve();
        return;
      }
      const sl = slides[i++];
      el.innerHTML = `<img src="${assetUrl('images/' + sl.image)}" alt="">${sl.text ? `<div class="cap">${sl.text}</div>` : ''}`;
      el.style.display = 'flex';
    };
    el.onclick = next;
    next();
  });
}

/** Title picture; the first click also unlocks audio. With a save, the player picks Continue or New game. */
export function showTitle(el: HTMLElement, hasSave: boolean, onStart: () => void, onNewGame: () => void): void {
  el.style.display = 'flex';
  const start = (): void => {
    el.style.display = 'none';
    onStart();
  };
  el.innerHTML = `<img src="${assetUrl('images/title-01.webp')}" alt="Akuma">`;
  if (!hasSave) {
    const hint = document.createElement('div');
    hint.textContent = 'click / tap to begin';
    el.appendChild(hint);
    el.onclick = start;
    return;
  }
  el.onclick = null;
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.append(
    artButton(ART.continueGame, 'Continue', start),
    artButton(ART.newGame, 'New game', (e) => {
      e.stopPropagation();
      if (confirm('Erase the saved game and start over?')) onNewGame();
    }),
  );
  el.appendChild(menu);
}

/** CD tracks the original shuffles through while playing (audio tracks 7-14 = track08..track15); the shorter tracks are jingles. */
export const GAME_TRACKS = [8, 9, 10, 11, 12, 13, 14, 15];
