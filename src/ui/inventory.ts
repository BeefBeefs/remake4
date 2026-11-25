import { ItemDb } from '../game/itemdb';
import { ItemEffect, itemEffect } from '../game/consumables';
import { StatName, StoryState } from '../script/state';
import { ALLOC_STATS, Derived, Loadout, SLOTS, slotOf } from '../game/stats';
import { partyLoad } from '../game/weight';

/** what the inventory needs to show and change the heroes' gear */
export interface EquipHost {
  names: string[];
  gear(i: number): Loadout;
  derived(i: number): Derived;
  hp(i: number): [number, number];
  /** "left/max" durability of an item, '' if it does not wear */
  durability(id: number): string;
  /** this hero's own stats, the level-up points he has left, and spending one or all of them */
  stats(i: number): Record<StatName, number>;
  points(i: number): number;
  spend(i: number, stat: StatName): void;
  autoSpend(i: number): void;
  /** what the party can carry */
  capacity(): number;
  equip(i: number, id: number): void;
  unequip(i: number, slot: string): void;
}

/** Simple DOM inventory: money, items with their effects, "use" for healing items. */
export class InventoryUI {
  constructor(
    private el: HTMLElement,
    private db: ItemDb,
    private state: StoryState,
    private onUse: (fx: ItemEffect) => boolean | Promise<boolean>,
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
    const load = partyLoad(this.db, this.state.items, eh.names.map((_, i) => eh.gear(i)));
    sheet.textContent = `Level ${this.state.level} · xp ${this.state.xp} · weight ${load}/${eh.capacity()}`;
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
      const st = eh.stats(i);
      const pts = eh.points(i);
      const line = document.createElement('div');
      line.className = 'stats';
      const labels: Record<string, string> = { HEALTH: 'Health', STRENGTH: 'Strength', MAGIC: 'Magic', DEXTERITY: 'Dexterity', BRAIN: 'Intelligence' };
      for (const k of ALLOC_STATS) {
        const cell = document.createElement('span');
        cell.textContent = `${labels[k]} ${st[k]} `;
        if (pts > 0) {
          const plus = document.createElement('button');
          plus.textContent = '+';
          plus.className = 'plus';
          plus.onclick = () => {
            eh.spend(i, k);
            this.render();
          };
          cell.appendChild(plus);
        }
        line.append(cell, ' ');
      }
      if (pts > 0) {
        const left = document.createElement('b');
        left.style.color = '#ffd24a';
        left.textContent = `${pts} points `;
        const auto = document.createElement('button');
        auto.textContent = 'Auto';
        auto.onclick = () => {
          eh.autoSpend(i);
          this.render();
        };
        line.append(left, auto);
      }
      t.appendChild(line);
      const g = eh.gear(i);
      for (const slot of SLOTS) {
        const id = g[slot];
        if (!id) continue;
        t.appendChild(document.createElement('br'));
        const w = document.createElement('small');
        w.textContent = `${slot}: ${this.db.name(id)} ${eh.durability(id)} `;
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
      nm.textContent = this.db.name(id) + (n > 1 ? ` ×${n}` : '') + (eh.durability(id) ? ` (${eh.durability(id)})` : '');
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
        b.onclick = async () => {
          if (await this.onUse(fx)) {
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
