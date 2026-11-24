import { ItemDb } from '../game/itemdb';
import { StoryState } from '../script/state';

/** Simple DOM inventory: money, items with their effects, "use" for healing items. */
export class InventoryUI {
  constructor(
    private el: HTMLElement,
    private db: ItemDb,
    private state: StoryState,
    private onHeal: (fraction: number) => boolean,
    private toast: (msg: string) => void,
  ) {
    el.addEventListener('click', (e) => e.stopPropagation());
  }

  get open(): boolean {
    return this.el.style.display === 'block';
  }

  toggle(): void {
    if (this.open) this.el.style.display = 'none';
    else {
      this.el.style.display = 'block';
      this.render();
    }
  }

  render(): void {
    this.el.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = `Items · money ${this.state.money}`;
    const close = document.createElement('button');
    close.textContent = '✕';
    close.onclick = () => this.toggle();
    head.appendChild(close);
    this.el.appendChild(head);
    const ids = [...this.state.items.keys()].sort((a, b) => a - b);
    if (!ids.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'Nothing yet. Pick things up or talk to people.';
      this.el.appendChild(e);
    }
    for (const id of ids) {
      const row = document.createElement('div');
      row.className = 'item';
      const label = document.createElement('div');
      const n = this.state.itemCount(id);
      label.innerHTML = '';
      const nm = document.createElement('b');
      nm.textContent = this.db.name(id) + (n > 1 ? ` ×${n}` : '');
      const d = document.createElement('small');
      d.textContent = this.db.desc(id);
      label.append(nm, document.createElement('br'), d);
      row.appendChild(label);
      const heal = this.db.healFraction(id);
      if (heal !== null) {
        const b = document.createElement('button');
        b.textContent = 'Use';
        b.onclick = () => {
          if (this.onHeal(heal)) {
            this.state.removeItem(id);
            this.toast(`Used ${this.db.name(id)}`);
          } else this.toast('Life is already full');
          this.render();
        };
        row.appendChild(b);
      }
      this.el.appendChild(row);
    }
  }
}
