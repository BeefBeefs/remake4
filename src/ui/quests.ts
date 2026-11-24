import { StoryState } from '../script/state';

/** The quest log: every active `ORDER` with its title and the hint lines the script gave. */
export class QuestLog {
  constructor(
    private el: HTMLElement,
    private state: StoryState,
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
    head.textContent = 'Quests';
    const close = document.createElement('button');
    close.textContent = '\u2715';
    close.onclick = () => this.toggle();
    head.appendChild(close);
    this.el.appendChild(head);
    if (!this.state.orders.size) {
      const none = document.createElement('div');
      none.className = 'q';
      none.textContent = 'No quests yet. Talk to the villagers.';
      this.el.appendChild(none);
    }
    for (const [id, q] of [...this.state.orders].sort((a, b) => b[0] - a[0])) {
      const box = document.createElement('div');
      box.className = 'q';
      const t = document.createElement('b');
      t.textContent = q.title || `Quest ${id}`;
      box.appendChild(t);
      for (const line of q.ment) {
        const d = document.createElement('div');
        d.textContent = line;
        box.appendChild(d);
      }
      this.el.appendChild(box);
    }
  }
}
