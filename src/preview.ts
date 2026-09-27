import { load as loadYaml } from 'js-yaml';
import { createMarkdown, splitFrontMatter, protectTablePipes } from './markdown';
import { typesetElements } from './math';
import { toImageUrl, resolveDocPath, dirname } from './fs';
import { applyCrossrefs } from './crossref';
import { applyCitations, parseBibtex, type BibEntry } from './citations';
import { settings, isDark } from './settings';

const md = createMarkdown();

interface Anchor {
  line: number;
  top: number;
}

export interface RenderContext {
  path: string | null;
}

export interface PreviewOptions {
  /** 참고문헌(.bib) 등 텍스트 파일 읽기 */
  loadText: (path: string) => Promise<string>;
}

/** 번호·참조가 걸린 수식 — 이 목록이 바뀌면 번호가 달라지므로 전부 다시 조판 */
const NUMBERED = /\\(?:label|tag|eqref|ref)\b|\\begin\{(?:equation|align|gather|multline|flalign|alignat|eqnarray|xalignat)\}/;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class Preview {
  readonly scroller: HTMLElement;
  readonly body: HTMLElement;
  private staging: HTMLElement;
  private renderSeq = 0;
  private anchors: Anchor[] | null = null;
  private mathCache = new Map<string, string>();
  private numberedSig = '';
  private mermaidCache = new Map<string, string>();
  private bibCache = new Map<string, Map<string, BibEntry>>();
  private mermaidSeq = 0;
  /** 마지막 렌더에서 쓰인 front matter */
  front: Record<string, unknown> | null = null;
  missingCitations: string[] = [];

  beforeSwap: () => void = () => {};
  onRendered: () => void = () => {};

  constructor(
    scroller: HTMLElement,
    private opts: PreviewOptions,
  ) {
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
    window.addEventListener('themechange', () => this.mermaidCache.clear());
  }

  invalidateBib(path?: string) {
    if (path) this.bibCache.delete(path);
    else this.bibCache.clear();
  }

  /** 문서 전환 시 캐시 비우기 (수식 번호 서명 초기화) */
  resetCaches() {
    this.numberedSig = '';
  }

  async render(source: string, ctx: RenderContext): Promise<void> {
    const seq = ++this.renderSeq;
    const st = this.staging;
    const docDir = ctx.path ? dirname(ctx.path) : null;

    // .bib / .txt 는 코드로 보여줌
    const ext = ctx.path?.split('.').pop()?.toLowerCase();
    if (ext === 'bib' || ext === 'txt') {
      source = '```' + (ext === 'bib' ? 'bibtex' : 'text') + '\n' + source.replace(/```/g, '​```') + '\n```';
    }

    const { body, front } = splitFrontMatter(source);
    let meta: Record<string, unknown> | null = null;
    if (front) {
      try {
        const v = loadYaml(front.raw);
        if (v && typeof v === 'object') meta = v as Record<string, unknown>;
      } catch {
        meta = null;
      }
    }
    this.front = meta;

    st.innerHTML = (meta ? this.headerHtml(meta) : '') + md.render(protectTablePipes(body));
    this.postProcessImages(st, docDir);
    await this.renderMermaid(st);
    if (seq !== this.renderSeq) return;

    // 참고문헌
    this.missingCitations = [];
    const bibPaths = this.bibPaths(meta, docDir);
    if (bibPaths.length && st.querySelector('cite.cite')) {
      const bib = await this.loadBib(bibPaths);
      if (seq !== this.renderSeq) return;
      const r = applyCitations(st, bib, settings.citationStyle, settings.labelLang);
      this.missingCitations = r.missing;
    }
    applyCrossrefs(st, { numbering: settings.numberFigures, lang: settings.labelLang });

    await this.typesetMath(st);
    if (seq !== this.renderSeq) return;

    this.beforeSwap();
    const top = this.scroller.scrollTop;
    this.swapIn(st);
    this.scroller.scrollTop = top;
    this.anchors = null;
    this.onRendered();
  }

  /* ---------------- front matter 제목 블록 ---------------- */

  private headerHtml(m: Record<string, unknown>): string {
    const str = (v: unknown) => (v == null ? '' : String(v));
    const parts: string[] = [];
    if (m.title) parts.push(`<h1 class="doc-title" id="title">${md.renderInline(str(m.title))}</h1>`);
    if (m.subtitle) parts.push(`<p class="doc-subtitle">${md.renderInline(str(m.subtitle))}</p>`);
    const authors = Array.isArray(m.author) ? m.author : m.author ? [m.author] : [];
    if (authors.length) {
      const names = authors.map((a) =>
        a && typeof a === 'object' ? escapeHtml(str((a as Record<string, unknown>).name)) : escapeHtml(str(a)),
      );
      parts.push(`<p class="doc-authors">${names.join(' · ')}</p>`);
    }
    if (m.date) {
      const d = m.date instanceof Date ? m.date.toISOString().slice(0, 10) : str(m.date);
      parts.push(`<p class="doc-date">${escapeHtml(d)}</p>`);
    }
    if (m.abstract) {
      const label = settings.labelLang === 'ko' ? '초록' : 'Abstract';
      parts.push(`<div class="doc-abstract"><div class="doc-abstract-label">${label}</div>${md.render(str(m.abstract))}</div>`);
    }
    if (m.keywords) {
      const kw = Array.isArray(m.keywords) ? m.keywords.map(str).join(', ') : str(m.keywords);
      const label = settings.labelLang === 'ko' ? '주제어' : 'Keywords';
      parts.push(`<p class="doc-keywords"><strong>${label}:</strong> ${escapeHtml(kw)}</p>`);
    }
    return parts.length ? `<header class="doc-header" data-line="0">${parts.join('')}</header>` : '';
  }

  /* ---------------- 이미지 ---------------- */

  private postProcessImages(root: HTMLElement, docDir: string | null) {
    for (const img of Array.from(root.querySelectorAll('img'))) {
      const src = img.getAttribute('src');
      if (src) {
        const abs = resolveDocPath(src, docDir);
        if (abs) img.dataset.path = abs;
        img.setAttribute('src', toImageUrl(src, docDir));
      }
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
          cap.innerHTML = md.renderInline(alt);
          fig.appendChild(cap);
        }
        p.replaceWith(fig);
      }
    }
  }

  /* ---------------- Mermaid ---------------- */

  private async renderMermaid(root: HTMLElement) {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre > code.language-mermaid'));
    if (!blocks.length) return;
    const { default: mermaid } = await import('mermaid');
    const theme = isDark() ? 'dark' : 'default';
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', fontFamily: 'inherit' });
    for (const code of blocks) {
      const src = code.textContent ?? '';
      const key = theme + '\u0000' + src;
      const div = document.createElement('div');
      div.className = 'mermaid-block';
      const line = code.getAttribute('data-line');
      if (line) div.setAttribute('data-line', line);
      let svg = this.mermaidCache.get(key);
      if (!svg) {
        try {
          const r = await mermaid.render(`mmd-${++this.mermaidSeq}`, src);
          svg = r.svg;
          this.mermaidCache.set(key, svg);
        } catch (e) {
          svg = `<div class="mermaid-error">Mermaid 오류: ${escapeHtml(String((e as Error)?.message ?? e))}</div>`;
          document.getElementById(`dmmd-${this.mermaidSeq}`)?.remove();
        }
      }
      div.innerHTML = svg;
      code.parentElement!.replaceWith(div);
    }
    if (this.mermaidCache.size > 200) this.mermaidCache.clear();
  }

  /* ---------------- 참고문헌 ---------------- */

  private bibPaths(meta: Record<string, unknown> | null, docDir: string | null): string[] {
    const b = meta?.bibliography;
    if (!b || !docDir) return [];
    const list = Array.isArray(b) ? b.map(String) : [String(b)];
    return list.map((p) => resolveDocPath(p, docDir)).filter((p): p is string => !!p);
  }

  private async loadBib(paths: string[]): Promise<Map<string, BibEntry>> {
    const merged = new Map<string, BibEntry>();
    for (const p of paths) {
      let entries = this.bibCache.get(p);
      if (!entries) {
        try {
          entries = parseBibtex(await this.opts.loadText(p));
        } catch (e) {
          console.warn('[bib]', p, e);
          entries = new Map();
        }
        this.bibCache.set(p, entries);
      }
      for (const [k, v] of entries) merged.set(k, v);
    }
    return merged;
  }

  /* ---------------- 수식: 바뀐 것만 조판 ---------------- */

  private async typesetMath(root: HTMLElement) {
    const els = Array.from(root.querySelectorAll<HTMLElement>('.math'));
    if (!els.length) {
      this.mathCache.clear();
      this.numberedSig = '';
      return;
    }
    const keys: string[] = [];
    const numbered: boolean[] = [];
    let nIdx = 0;
    for (const el of els) {
      const kind = el.classList.contains('math-block') ? 'B' : el.classList.contains('math-display') ? 'D' : 'I';
      const tex = el.textContent ?? '';
      const isNum = NUMBERED.test(tex);
      numbered.push(isNum);
      keys.push(kind + (isNum ? `#${nIdx++}` : '') + '\u0000' + tex);
    }
    const sig = keys.filter((_, i) => numbered[i]).join('\u0001');
    const reuseNumbered = sig === this.numberedSig;

    const todo: HTMLElement[] = [];
    let resetNumbers = false;
    els.forEach((el, i) => {
      const cached = this.mathCache.get(keys[i]);
      if (numbered[i] && !reuseNumbered) {
        todo.push(el);
        resetNumbers = true;
      } else if (cached !== undefined) {
        el.innerHTML = cached;
      } else {
        todo.push(el);
      }
    });

    await typesetElements(todo, resetNumbers);

    const next = new Map<string, string>();
    els.forEach((el, i) => {
      if (el.querySelector('mjx-container')) next.set(keys[i], el.innerHTML);
    });
    this.mathCache = next;
    this.numberedSig = sig;
  }

  /* ---------------- 바뀐 블록만 교체 (이미지 재로딩·깜빡임 방지) ---------------- */

  private swapIn(st: HTMLElement) {
    const pool = new Map<string, Element[]>();
    for (const n of Array.from(this.body.children)) {
      const k = n.outerHTML;
      const arr = pool.get(k);
      if (arr) arr.push(n);
      else pool.set(k, [n]);
    }
    const next: Node[] = [];
    for (const n of Array.from(st.childNodes)) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const old = pool.get((n as Element).outerHTML)?.shift();
        next.push(old ?? n);
      } else if (n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').trim()) {
        continue;
      } else {
        next.push(n);
      }
    }
    this.body.replaceChildren(...next);
    st.replaceChildren();
  }

  /* ---------------- 스크롤 동기화 ---------------- */

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

  invalidateLayout() {
    this.anchors = null;
  }

  /** 편집기의 줄(소수 포함)에 맞춰 미리보기 스크롤 */
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

  /** 미리보기 맨 위에 보이는 원본 줄 번호 (소수 포함) */
  topLine(): number {
    const a = this.collectAnchors();
    if (!a.length) return 0;
    const y = this.scroller.scrollTop - this.body.offsetTop + 16;
    let i = 0;
    while (i + 1 < a.length && a[i + 1].top <= y) i++;
    if (y < a[0].top) return 0;
    if (i + 1 < a.length) {
      const cur = a[i], nxt = a[i + 1];
      const t = (y - cur.top) / Math.max(1, nxt.top - cur.top);
      return cur.line + (nxt.line - cur.line) * Math.min(1, Math.max(0, t));
    }
    return a[i].line;
  }

  atBottom(): boolean {
    const s = this.scroller;
    return s.scrollTop + s.clientHeight >= s.scrollHeight - 4;
  }

  /** 클릭한 요소의 원본 줄 번호 */
  lineOf(el: Element | null): number | null {
    const hit = el?.closest<HTMLElement>('[data-line]');
    if (!hit) return null;
    const n = Number(hit.dataset.line);
    return Number.isNaN(n) ? null : n;
  }

  headings(): { level: number; text: string; id: string; el: HTMLElement }[] {
    return Array.from(this.body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
      .filter((h) => !h.closest('.references') || h.id === 'references')
      .map((h) => ({
        level: h.classList.contains('doc-title') ? 0 : Number(h.tagName[1]),
        text: (h.textContent ?? '').trim(),
        id: h.id,
        el: h,
      }));
  }
}

export const escapeForHtml = escapeHtml;
