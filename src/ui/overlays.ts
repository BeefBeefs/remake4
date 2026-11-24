import { assetUrl } from '../data/loaders';
import { MapIndexEntry } from '../data/types';

/** The two world pictures with a button per place (the original's clickable hotspots are not decoded yet). */
export class WorldMapUI {
  private tab: 'world' | 'under' = 'world';
  constructor(
    private el: HTMLElement,
    private maps: MapIndexEntry[],
    private onGo: (id: string) => void,
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
    if (current) this.tab = /^[cd]/.test(current) ? 'under' : 'world';
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
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const m of this.maps) {
      const under = /^[cd]/.test(m.id);
      if (under !== (this.tab === 'under')) continue;
      const b = document.createElement('button');
      b.textContent = m.name;
      if (m.id === current) b.className = 'here';
      b.onclick = () => {
        this.toggle();
        this.onGo(m.id);
      };
      chips.appendChild(b);
    }
    pic.appendChild(chips);
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

/** Title picture; the first click also unlocks audio. */
export function showTitle(el: HTMLElement, onStart: () => void): void {
  el.style.display = 'flex';
  el.innerHTML = `<img src="${assetUrl('images/title-01.webp')}" alt="Akuma"><div>click / tap to begin</div>`;
  el.onclick = () => {
    el.style.display = 'none';
    onStart();
  };
}

/** Music by map family. Which track the original plays where is not decoded; this is a placeholder. */
export function trackForMap(entry: MapIndexEntry, orderInFamily: number): number {
  const family = entry.id[0];
  const pools: Record<string, number[]> = { t: [2, 3], a: [4, 5, 6, 7], b: [8, 9], c: [10, 11], d: [12, 13, 14, 15] };
  const pool = pools[family] ?? [2];
  return pool[orderInFamily % pool.length];
}
