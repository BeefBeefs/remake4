import { Arg } from '../script/parser';
import { FaceSpec, RGB, ScriptHost, ShopKind } from '../script/interpreter';

/** what the shop screens need from the game */
export interface ShopHost {
  money: number;
  price(id: number): number | undefined;
  sellPrice(id: number): number | undefined;
  count(id: number): number;
  nameOf(id: number): string;
  buy(id: number): boolean;
  sell(id: number): boolean;
  /** item ids the party holds that this kind of shop takes (equipment or consumables) */
  owned(equipment: boolean): number[];
}

const css = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** DOM dialogue box implementing the UI half of ScriptHost. World effects are delegated. */
export class DialogueUI implements ScriptHost {
  private lines: { text: string; color: RGB }[] = [];
  private color: RGB = [255, 255, 255];
  private face: FaceSpec = null;
  private waiter: (() => void) | null = null;

  constructor(
    private el: HTMLElement,
    private onEffect: (name: string, args: Arg[]) => void | Promise<void>,
    private onPlay: (sound: string) => void,
    private onWarn: (msg: string) => void = () => {},
  ) {
    el.addEventListener('click', () => this.advance());
    window.addEventListener('keydown', (e) => {
      if (this.el.style.display !== 'none' && this.waiter && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        this.advance();
      }
    });
  }

  private advance(): void {
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  get open(): boolean {
    return this.el.style.display === 'block';
  }

  show(): void {
    this.el.style.display = 'block';
  }
  hide(): void {
    this.el.style.display = 'none';
    this.lines = [];
    this.face = null;
  }

  private render(extra?: HTMLElement, hint?: string): void {
    const name = this.face && this.face.kind === 'npc' ? this.face.name : this.face?.kind === 'hero' ? 'Hero' : '';
    const nameColor = this.face ? css(this.face.color) : '#fff';
    this.el.innerHTML = '';
    if (name) {
      const n = document.createElement('div');
      n.className = 'name';
      n.style.color = nameColor;
      n.textContent = name;
      this.el.appendChild(n);
    }
    const body = document.createElement('div');
    body.className = 'lines';
    for (const l of this.lines) {
      const d = document.createElement('div');
      d.style.color = css(l.color);
      d.textContent = l.text || ' ';
      body.appendChild(d);
    }
    this.el.appendChild(body);
    if (extra) this.el.appendChild(extra);
    if (hint) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = hint;
      this.el.appendChild(h);
    }
    this.show();
  }

  clear(): void {
    this.lines = [];
    this.render();
  }
  talk(text: string): void {
    this.lines.push({ text, color: this.color });
    this.render();
  }
  setBox(style: 'BLUE' | 'RED'): void {
    this.el.classList.toggle('red', style === 'RED');
  }
  setColor(c: RGB): void {
    this.color = c;
  }
  setFace(f: FaceSpec): void {
    this.face = f;
    this.render();
  }
  waitKey(): Promise<void> {
    this.render(undefined, 'click / space to continue');
    return new Promise((res) => (this.waiter = res));
  }
  select(choices: { text: string }[], color: RGB): Promise<number> {
    return new Promise((res) => {
      const box = document.createElement('div');
      box.className = 'choices';
      choices.forEach((c, i) => {
        if (!c.text) {
          const sp = document.createElement('div');
          sp.style.height = '6px';
          box.appendChild(sp);
          return;
        }
        const b = document.createElement('button');
        b.textContent = c.text;
        b.style.color = css(color);
        b.onclick = (e) => {
          e.stopPropagation();
          res(i);
        };
        box.appendChild(b);
      });
      this.render(box);
    });
  }
  /** item names for shop listings; set once the string table is loaded */
  itemLabel: (id: number) => string = (id) => `item ${id}`;

  /** set by main: lets the shop screens read and change the party's money and items */
  trade: ShopHost | null = null;

  async shop(kind: ShopKind, prompt: string, list: number[]): Promise<void> {
    const t = this.trade;
    if (!t || kind === 'REPAIR_WEAPON' || kind === 'LEARN_MAGIC') {
      // no prices for spells / repairs in the data we have: just list what is on offer
      this.lines.push({ text: `[${kind.replace(/_/g, ' ').toLowerCase()}] ${prompt}`, color: [150, 150, 150] });
      for (const id of list.slice(0, 12)) this.lines.push({ text: `  · ${this.itemLabel(id)}`, color: [200, 200, 160] });
      if (list.length > 12) this.lines.push({ text: `  … and ${list.length - 12} more`, color: [150, 150, 150] });
      this.render();
      await this.waitKey();
      return;
    }
    const selling = kind === 'SELL_WEAPON' || kind === 'SELL_ITEM';
    let note = '';
    return new Promise((done) => {
      const draw = () => {
        const box = document.createElement('div');
        box.className = 'choices';
        box.style.maxHeight = '38vh';
        box.style.overflowY = 'auto';
        const ids = selling ? t.owned(kind === 'SELL_WEAPON') : list;
        if (!ids.length) {
          const e = document.createElement('div');
          e.textContent = selling ? 'Nothing to sell.' : 'Sold out.';
          box.appendChild(e);
        }
        for (const id of ids) {
          const price = selling ? t.sellPrice(id) : t.price(id);
          const b = document.createElement('button');
          const have = t.count(id);
          b.textContent = `${this.itemLabel(id)}  —  ${price === undefined ? 'n/a' : price}${have ? `  (have ${have})` : ''}`;
          b.disabled = price === undefined || (!selling && t.money < price);
          b.onclick = (e) => {
            e.stopPropagation();
            note = selling ? (t.sell(id) ? `Sold ${t.nameOf(id)}.` : 'Cannot sell that.') : t.buy(id) ? `Bought ${t.nameOf(id)}.` : 'Not enough money.';
            draw();
          };
          box.appendChild(b);
        }
        const leave = document.createElement('button');
        leave.textContent = 'Leave';
        leave.onclick = (e) => {
          e.stopPropagation();
          done();
        };
        box.appendChild(leave);
        this.lines = [
          { text: prompt, color: this.color },
          { text: `Money: ${t.money}${note ? '   ' + note : ''}`, color: [255, 220, 120] },
        ];
        this.render(box);
      };
      draw();
    });
  }
  play(sound: string): void {
    this.onPlay(sound);
  }
  effect(name: string, args: Arg[]): void | Promise<void> {
    return this.onEffect(name, args);
  }
  warn(msg: string): void {
    this.onWarn(msg);
  }
}
