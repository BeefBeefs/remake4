import { ItemDb } from '../game/itemdb';
import { ItemEffect, itemEffect } from '../game/consumables';
import { StoryState } from '../script/state';
import { Derived, Loadout, SLOTS, slotOf } from '../game/stats';

/** what the inventory needs to show and change the heroes' gear */
export interface EquipHost {
  names: string[];
  gear(i: number): Loadout;
  derived(i: number): Derived;
  hp(i: number): [number, number];
  equip(i: number, id: number): void;
  unequip(i: number, slot: string): void;
}

/** Simple DOM inventory: money, items with their effects, "use" for healing items. */
export class InventoryUI {
  constructor(
    private el: HTMLElement,
    private db: ItemDb,
    private state: StoryState,
    private onUse: (fx: ItemEffect) => boolean,
    private toast: (msg: string) => void,
    private equipHost: EquipHost,
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
    const eh = this.equipHost;
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.textContent = `Level ${this.state.level} · xp ${this.state.xp}`;
    this.el.appendChild(sheet);
    eh.names.forEach((nm, i) => {
      const d = eh.derived(i);
      const [hp, max] = eh.hp(i);
      const box = document.createElement('div');
      box.className = 'item';
      const t = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = nm;
      const sm = document.createElement('small');
      sm.textContent = ` HP ${hp}/${max} · atk ${d.attack} · def ${d.defense} · str ${d.strength} dex ${d.dexterity} mag ${d.magic}`;
      t.append(b, sm);
      const g = eh.gear(i);
      for (const slot of SLOTS) {
        const id = g[slot];
        if (!id) continue;
        t.appendChild(document.createElement('br'));
        const w = document.createElement('small');
        w.textContent = `${slot}: ${this.db.name(id)} `;
        const x = document.createElement('button');
        x.textContent = 'take off';
        x.onclick = () => {
          eh.unequip(i, slot);
          this.render();
        };
        w.appendChild(x);
        t.appendChild(w);
      }
      box.appendChild(t);
      this.el.appendChild(box);
    });
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
      if (slotOf(this.db, id)) {
        eh.names.forEach((nm, i) => {
          const b = document.createElement('button');
          b.textContent = nm.slice(0, 1);
          b.title = `Equip on ${nm}`;
          b.onclick = () => {
            eh.equip(i, id);
            this.render();
          };
          row.appendChild(b);
        });
      }
      const fx = this.db.kind(id) === 'consumable' ? itemEffect(id, this.db.desc(id)) : null;
      if (fx) {
        const b = document.createElement('button');
        b.textContent = 'Use';
        b.onclick = () => {
          if (this.onUse(fx)) {
            this.state.removeItem(id);
            this.toast(`Used ${this.db.name(id)}`);
          } else this.toast('No effect right now');
          this.render();
        };
        row.appendChild(b);
      }
      this.el.appendChild(row);
    }
  }
}
