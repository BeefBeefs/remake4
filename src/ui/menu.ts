import { parseSave, SaveData } from '../game/save';

export const SLOT_COUNT = 5;
export const slotKey = (i: number): string => `akuma.save.slot${i}`;

/** One line for a save slot: "Empty", or the game year, level and place ("Year 105 · Level 12 · Western Village"). */
export function slotSummary(text: string | null, heroCount: number, mapName: (id: string) => string): string {
  const d = parseSave(text, heroCount);
  if (!d) return 'Empty';
  return `Year ${Math.floor(d.story.year ?? 123)} · Level ${d.story.level} · ${mapName(d.map)}`;
}

export interface MenuHost {
  heroCount: number;
  mapName(id: string): string;
  /** the current game as a save, or null when it cannot be saved (debug jump, everyone down) */
  snapshot(): SaveData | null;
  /** make this save the game's current one and start from it */
  load(text: string): void;
  musicOn(): boolean;
  toggleMusic(): void;
  sfxOn(): boolean;
  toggleSfx(): void;
  exitToTitle(): void;
  toast(msg: string): void;
}

/** ESC menu: save / load slots, music and sound toggles, back to the title. */
export class GameMenu {
  private view: 'main' | 'save' | 'load' = 'main';
  constructor(private el: HTMLElement, private host: MenuHost) {
    el.addEventListener('click', (e) => e.stopPropagation());
  }

  get open(): boolean {
    return this.el.style.display === 'block';
  }

  toggle(): void {
    if (this.open) this.el.style.display = 'none';
    else {
      this.view = 'main';
      this.el.style.display = 'block';
      this.render();
    }
  }

  private button(label: string, on: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = on;
    return b;
  }

  render(): void {
    const h = this.host;
    this.el.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = this.view === 'save' ? 'Save game' : this.view === 'load' ? 'Load game' : 'Menu';
    head.appendChild(this.button('✕', () => this.toggle()));
    this.el.appendChild(head);
    if (this.view === 'main') {
      const rows: [string, () => void][] = [
        ['Save game', () => this.go('save')],
        ['Load game', () => this.go('load')],
        [`Music: ${h.musicOn() ? 'on' : 'off'}`, () => (h.toggleMusic(), this.render())],
        [`Sound effects: ${h.sfxOn() ? 'on' : 'off'}`, () => (h.toggleSfx(), this.render())],
        ['Exit to title', () => confirm('Abort this game and exit to the title?') && h.exitToTitle()],
      ];
      for (const [label, on] of rows) {
        const row = document.createElement('div');
        row.className = 'q';
        row.appendChild(this.button(label, on));
        this.el.appendChild(row);
      }
      return;
    }
    const info = document.createElement('div');
    info.className = 'q';
    info.textContent = this.view === 'save' ? 'Choose a slot to save' : 'Choose a slot to load';
    this.el.appendChild(info);
    for (let i = 1; i <= SLOT_COUNT; i++) {
      const text = localStorage.getItem(slotKey(i));
      const summary = slotSummary(text, h.heroCount, h.mapName);
      const row = document.createElement('div');
      row.className = 'q';
      const b = this.button(`${i}. ${summary}`, () => this.pick(i, text));
      b.disabled = this.view === 'load' && summary === 'Empty';
      row.appendChild(b);
      this.el.appendChild(row);
    }
    const back = document.createElement('div');
    back.className = 'q';
    back.appendChild(this.button('Back', () => this.go('main')));
    this.el.appendChild(back);
  }

  private go(v: 'main' | 'save' | 'load'): void {
    this.view = v;
    this.render();
  }

  private pick(i: number, text: string | null): void {
    const h = this.host;
    if (this.view === 'save') {
      const snap = h.snapshot();
      if (!snap) return h.toast('Cannot save right now');
      if (text && !confirm(`Overwrite slot ${i}?`)) return;
      try {
        localStorage.setItem(slotKey(i), JSON.stringify(snap));
        h.toast(`Saved to slot ${i}`);
      } catch {
        h.toast('Could not save (storage full or blocked)');
      }
      this.render();
    } else if (text && parseSave(text, h.heroCount) && confirm(`Load slot ${i}? Unsaved progress is lost.`)) {
      h.load(text);
    }
  }
}
