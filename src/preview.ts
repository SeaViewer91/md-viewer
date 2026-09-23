import { createMarkdown } from './markdown';
import { typeset } from './math';
import { toImageUrl } from './fs';

const md = createMarkdown();

interface Anchor {
  line: number;
  top: number;
}

export class Preview {
  readonly scroller: HTMLElement;
  readonly body: HTMLElement;
  private staging: HTMLElement;
  private renderSeq = 0;
  private anchors: Anchor[] | null = null;
  onRendered: () => void = () => {};

  constructor(scroller: HTMLElement) {
    this.scroller = scroller;
    this.body = document.createElement('article');
    this.body.className = 'markdown-body mj-ignore';
    scroller.appendChild(this.body);

    // 화면 밖 렌더링용 (수식 조판이 끝난 뒤 한 번에 교체 → 깜빡임 방지)
    this.staging = document.createElement('article');
    this.staging.className = 'markdown-body mj-ignore staging';
    this.staging.setAttribute('aria-hidden', 'true');
    (scroller.parentElement ?? scroller).appendChild(this.staging);

    new ResizeObserver(() => (this.anchors = null)).observe(this.body);
  }

  async render(source: string, docDir: string | null): Promise<void> {
    const seq = ++this.renderSeq;
    const st = this.staging;
    st.innerHTML = md.render(source);
    this.postProcess(st, docDir);
    await typeset(st);
    if (seq !== this.renderSeq) return; // 더 최신 렌더가 시작됨

    const top = this.scroller.scrollTop;
    this.body.replaceChildren(...Array.from(st.childNodes));
    st.replaceChildren();
    this.scroller.scrollTop = top;
    this.anchors = null;
    this.onRendered();
  }

  private postProcess(root: HTMLElement, docDir: string | null) {
    for (const img of Array.from(root.querySelectorAll('img'))) {
      const src = img.getAttribute('src');
      if (src) img.setAttribute('src', toImageUrl(src, docDir));
      img.loading = 'lazy';
      img.addEventListener('load', () => (this.anchors = null), { once: true });

      // 문단에 이미지 하나만 있으면 figure + 캡션(alt)으로
      const p = img.parentElement;
      if (p && p.tagName === 'P' && p.childNodes.length === 1) {
        const fig = document.createElement('figure');
        const line = p.getAttribute('data-line');
        if (line) fig.setAttribute('data-line', line);
        fig.appendChild(img);
        const alt = img.getAttribute('alt');
        if (alt) {
          const cap = document.createElement('figcaption');
          cap.textContent = alt;
          fig.appendChild(cap);
        }
        p.replaceWith(fig);
      }
    }
  }

  /* ---------------- 스크롤 동기화 (편집기 → 미리보기) ---------------- */

  private collectAnchors(): Anchor[] {
    if (this.anchors) return this.anchors;
    const base = this.body.getBoundingClientRect().top;
    const list: Anchor[] = [];
    let lastLine = -1;
    for (const el of Array.from(this.body.querySelectorAll<HTMLElement>('[data-line]'))) {
      const line = Number(el.dataset.line);
      if (Number.isNaN(line) || line <= lastLine) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height === 0 && rect.width === 0) continue;
      list.push({ line, top: rect.top - base });
      lastLine = line;
    }
    this.anchors = list;
    return list;
  }

  syncTo(line: number, atBottom: boolean) {
    const s = this.scroller;
    if (atBottom) {
      s.scrollTop = s.scrollHeight;
      return;
    }
    const a = this.collectAnchors();
    if (!a.length) return;
    let i = 0;
    while (i + 1 < a.length && a[i + 1].line <= line) i++;
    let y: number;
    if (line < a[0].line) {
      y = 0;
    } else if (i + 1 < a.length) {
      const cur = a[i], nxt = a[i + 1];
      const t = (line - cur.line) / (nxt.line - cur.line);
      y = cur.top + (nxt.top - cur.top) * Math.min(1, Math.max(0, t));
    } else {
      y = a[i].top + (line - a[i].line) * 20;
    }
    s.scrollTop = y + this.body.offsetTop - 16;
  }

  /** 미리보기 맨 위에 보이는 원본 줄 번호 (읽기 모드 → 편집 모드 전환 시 사용) */
  topLine(): number {
    const a = this.collectAnchors();
    const y = this.scroller.scrollTop - this.body.offsetTop + 16;
    let line = 0;
    for (const x of a) {
      if (x.top > y) break;
      line = x.line;
    }
    return line;
  }
}
