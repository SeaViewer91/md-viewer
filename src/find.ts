// 미리보기 검색 (읽기 모드에서도 동작). 결과는 <mark class="find-hit">로 표시

export class FindBar {
  private bar: HTMLElement;
  private input: HTMLInputElement;
  private count: HTMLElement;
  private hits: HTMLElement[] = [];
  private index = -1;
  private query = '';
  private caseSensitive = false;

  constructor(
    host: HTMLElement,
    private root: HTMLElement,
  ) {
    this.bar = document.createElement('div');
    this.bar.className = 'find-bar';
    this.bar.hidden = true;
    this.bar.innerHTML = `
      <input type="text" placeholder="미리보기에서 찾기" spellcheck="false" />
      <span class="find-count"></span>
      <button class="icon-btn find-case" title="대소문자 구분">Aa</button>
      <button class="icon-btn find-prev" title="이전 (Shift+Enter)">↑</button>
      <button class="icon-btn find-next" title="다음 (Enter)">↓</button>
      <button class="icon-btn find-close" title="닫기 (Esc)">✕</button>`;
    host.appendChild(this.bar);
    this.input = this.bar.querySelector('input')!;
    this.count = this.bar.querySelector('.find-count')!;

    let timer: number | undefined;
    this.input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => this.search(this.input.value), 120);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.query !== this.input.value) this.search(this.input.value);
        else this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.bar.querySelector('.find-next')!.addEventListener('click', () => this.step(1));
    this.bar.querySelector('.find-prev')!.addEventListener('click', () => this.step(-1));
    this.bar.querySelector('.find-close')!.addEventListener('click', () => this.close());
    const caseBtn = this.bar.querySelector<HTMLElement>('.find-case')!;
    caseBtn.addEventListener('click', () => {
      this.caseSensitive = !this.caseSensitive;
      caseBtn.classList.toggle('on', this.caseSensitive);
      this.search(this.input.value);
    });
  }

  get isOpen() {
    return !this.bar.hidden;
  }

  open(initial?: string) {
    this.bar.hidden = false;
    if (initial) this.input.value = initial;
    this.input.focus();
    this.input.select();
    if (this.input.value) this.search(this.input.value);
  }

  close() {
    this.bar.hidden = true;
    this.clear();
    this.query = '';
  }

  /** 하이라이트 제거 (렌더 전에 호출) */
  clear() {
    for (const m of this.hits) {
      const parent = m.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(m.textContent ?? ''), m);
      parent.normalize();
    }
    this.hits = [];
  }

  /** 렌더 후 다시 적용 */
  reapply() {
    if (!this.isOpen || !this.query) return;
    const keep = this.index;
    this.search(this.query, false);
    if (this.hits.length) this.select(Math.min(Math.max(keep, 0), this.hits.length - 1), false);
  }

  private search(q: string, scroll = true) {
    this.clear();
    this.query = q;
    this.index = -1;
    if (!q) {
      this.count.textContent = '';
      return;
    }
    const needle = this.caseSensitive ? q : q.toLowerCase();
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest('mjx-container, svg, script, style')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    for (const node of nodes) {
      const text = node.data;
      const hay = this.caseSensitive ? text : text.toLowerCase();
      let from = 0;
      let idx = hay.indexOf(needle, from);
      if (idx < 0) continue;
      const frag = document.createDocumentFragment();
      while (idx >= 0) {
        if (idx > from) frag.append(text.slice(from, idx));
        const mark = document.createElement('mark');
        mark.className = 'find-hit';
        mark.textContent = text.slice(idx, idx + q.length);
        frag.append(mark);
        this.hits.push(mark);
        from = idx + q.length;
        idx = hay.indexOf(needle, from);
      }
      if (from < text.length) frag.append(text.slice(from));
      node.replaceWith(frag);
    }
    if (this.hits.length) this.select(0, scroll);
    else this.count.textContent = '없음';
  }

  private step(d: number) {
    if (!this.hits.length) return;
    this.select((this.index + d + this.hits.length) % this.hits.length, true);
  }

  private select(i: number, scroll: boolean) {
    this.hits[this.index]?.classList.remove('current');
    this.index = i;
    const m = this.hits[i];
    m.classList.add('current');
    if (scroll) m.scrollIntoView({ block: 'center' });
    this.count.textContent = `${i + 1}/${this.hits.length}`;
  }
}
