// 목차(아웃라인) 패널: 미리보기의 제목으로 목록을 만들고 현재 위치를 강조

export interface OutlineItem {
  level: number;
  text: string;
  id: string;
  el: HTMLElement;
}

export class Outline {
  private items: OutlineItem[] = [];
  private rows: HTMLElement[] = [];
  private current = -1;

  constructor(
    private container: HTMLElement,
    private scroller: HTMLElement,
    private onJump: (item: OutlineItem) => void,
  ) {
    let frame = 0;
    scroller.addEventListener(
      'scroll',
      () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => this.highlight());
      },
      { passive: true },
    );
  }

  update(items: OutlineItem[]) {
    const same =
      items.length === this.items.length &&
      items.every((it, i) => it.text === this.items[i].text && it.level === this.items[i].level);
    this.items = items;
    if (same) {
      this.highlight(true);
      return;
    }
    this.container.replaceChildren();
    this.rows = [];
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'outline-empty';
      empty.textContent = '제목(#)이 없습니다';
      this.container.appendChild(empty);
      return;
    }
    const minLevel = Math.min(...items.map((i) => i.level));
    items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = `outline-item level-${it.level}`;
      row.style.paddingLeft = `${12 + (it.level - minLevel) * 14}px`;
      row.textContent = it.text;
      row.title = it.text;
      row.addEventListener('click', () => this.onJump(this.items[i] ?? it));
      this.container.appendChild(row);
      this.rows.push(row);
    });
    this.current = -1;
    this.highlight(true);
  }

  private highlight(force = false) {
    if (!this.items.length) return;
    const top = this.scroller.getBoundingClientRect().top + 40;
    let idx = 0;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].el.getBoundingClientRect().top <= top) idx = i;
      else break;
    }
    if (idx === this.current && !force) return;
    this.rows[this.current]?.classList.remove('current');
    this.current = idx;
    const row = this.rows[idx];
    if (row) {
      row.classList.add('current');
      if (this.container.offsetParent) {
        const c = this.container.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        if (r.top < c.top || r.bottom > c.bottom) row.scrollIntoView({ block: 'nearest' });
      }
    }
  }
}
