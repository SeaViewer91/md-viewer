// 그림·표 자동 번호와 본문 참조 (@fig:id, @tbl:id, [@fig:id])

export interface CrossrefOptions {
  numbering: boolean;
  lang: 'ko' | 'en';
}

const LABELS = {
  ko: { fig: '그림', tbl: '표' },
  en: { fig: 'Figure', tbl: 'Table' },
};

const TABLE_CAPTION = /^\s*(?:Table|표)?\s*:\s+/;
const LABEL_TAIL = /\s*\{#((?:tbl):[\w:.-]+)\}\s*$/;

/** 표 바로 뒤(또는 앞) 문단이 "Table: 캡션 {#tbl:id}" / ": 캡션" 이면 표 캡션으로 */
function attachTableCaptions(root: HTMLElement) {
  for (const wrap of Array.from(root.querySelectorAll<HTMLElement>('.table-wrap'))) {
    const table = wrap.querySelector('table');
    if (!table || table.querySelector('caption')) continue;
    const candidates = [wrap.nextElementSibling, wrap.previousElementSibling];
    for (const p of candidates) {
      if (!p || p.tagName !== 'P' || !TABLE_CAPTION.test(p.textContent ?? '')) continue;
      const cap = document.createElement('caption');
      cap.innerHTML = p.innerHTML;
      stripLeadingText(cap, TABLE_CAPTION);
      const label = extractTrailingLabel(cap, LABEL_TAIL);
      if (label) table.id = label;
      table.prepend(cap);
      p.remove();
      break;
    }
  }
}

function stripLeadingText(el: HTMLElement, re: RegExp) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode() as Text | null;
  if (first) first.data = first.data.replace(re, '');
}

function extractTrailingLabel(el: HTMLElement, re: RegExp): string | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) last = n as Text;
  if (!last) return null;
  const m = re.exec(last.data);
  if (!m) return null;
  last.data = last.data.slice(0, m.index);
  return m[1];
}

export function applyCrossrefs(root: HTMLElement, opts: CrossrefOptions) {
  attachTableCaptions(root);
  const L = LABELS[opts.lang];
  const numbers = new Map<string, string>(); // label → "그림 3"

  // 그림
  let fig = 0;
  for (const f of Array.from(root.querySelectorAll<HTMLElement>('figure'))) {
    const img = f.querySelector('img');
    const label = img?.getAttribute('data-label');
    const cap = f.querySelector('figcaption');
    if (label) f.id = label;
    if (!cap && !label) continue;
    fig++;
    const name = `${L.fig} ${fig}`;
    if (label) numbers.set(label, name);
    if (opts.numbering && cap) {
      const b = document.createElement('span');
      b.className = 'caption-label';
      b.textContent = `${name}. `;
      cap.prepend(b);
    }
  }

  // 표
  let tbl = 0;
  for (const t of Array.from(root.querySelectorAll<HTMLElement>('table'))) {
    const cap = t.querySelector('caption');
    if (!cap && !t.id) continue;
    tbl++;
    const name = `${L.tbl} ${tbl}`;
    if (t.id) numbers.set(t.id, name);
    if (opts.numbering && cap) {
      const b = document.createElement('span');
      b.className = 'caption-label';
      b.textContent = `${name}. `;
      cap.prepend(b);
    }
  }

  const refHtml = (key: string) => {
    const name = numbers.get(key);
    const a = document.createElement('a');
    a.className = 'xref';
    a.href = `#${key}`;
    a.textContent = name ?? `??${key}`;
    if (!name) a.classList.add('xref-missing');
    return a;
  };

  // [@fig:x] 형태 (citation 토큰으로 파싱됨)
  for (const c of Array.from(root.querySelectorAll<HTMLElement>('cite.cite:not(.cite-done)'))) {
    const items: { key: string; prefix: string; suffix: string }[] = JSON.parse(c.dataset.cites ?? '[]');
    if (!items.every((it) => /^(fig|tbl):/.test(it.key))) continue;
    const frag = document.createDocumentFragment();
    items.forEach((it, i) => {
      if (i) frag.append(', ');
      if (it.prefix) frag.append(it.prefix + ' ');
      frag.append(refHtml(it.key));
      if (it.suffix) frag.append(', ' + it.suffix);
    });
    c.replaceWith(frag);
  }

  // 본문의 @fig:x / @tbl:x
  const re = /(?<![\w@])@((?:fig|tbl):[\w:-]+)/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest('code, pre, .math, a, script, style')) return NodeFilter.FILTER_REJECT;
      return n.nodeValue && n.nodeValue.includes('@') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n as Text);
  for (const t of targets) {
    const text = t.data;
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      frag.append(refHtml(m[1]));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    t.replaceWith(frag);
  }
}
