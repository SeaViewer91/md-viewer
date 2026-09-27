// BibTeX 파서 + 본문 인용 [@key] 서식 + 참고문헌 목록

import type { CiteItem } from './markdown';

export interface BibEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
}

/* ---------------- BibTeX 파싱 ---------------- */

const ACCENTS: Record<string, string> = {
  '\\"a': 'ä', '\\"o': 'ö', '\\"u': 'ü', '\\"A': 'Ä', '\\"O': 'Ö', '\\"U': 'Ü',
  "\\'a": 'á', "\\'e": 'é', "\\'i": 'í', "\\'o": 'ó', "\\'u": 'ú', "\\'E": 'É',
  '\\`a': 'à', '\\`e': 'è', '\\^o': 'ô', '\\^e': 'ê', '\\~n': 'ñ', '\\c{c}': 'ç',
  '\\ss': 'ß', '\\o': 'ø', '\\aa': 'å', '\\&': '&', '\\%': '%', '\\_': '_', '--': '–',
};

function cleanValue(v: string): string {
  let s = v.replace(/\s+/g, ' ').trim();
  for (const [k, r] of Object.entries(ACCENTS)) s = s.split(k).join(r);
  s = s.replace(/\\[`'^"~]\{(\w)\}/g, '$1');
  s = s.replace(/\\(?:textit|emph|textbf|mathrm)\{([^{}]*)\}/g, '$1');
  s = s.replace(/[{}]/g, '');
  return s;
}

export function parseBibtex(src: string): Map<string, BibEntry> {
  const out = new Map<string, BibEntry>();
  const strings: Record<string, string> = {};
  let i = 0;
  const n = src.length;

  const skipWs = () => {
    while (i < n && /\s/.test(src[i])) i++;
  };

  const readBraced = (): string => {
    // src[i] === '{'
    let depth = 0;
    const start = i + 1;
    for (; i < n; i++) {
      if (src[i] === '\\') {
        i++;
        continue;
      }
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) {
          i++;
          return src.slice(start, i - 1);
        }
      }
    }
    return src.slice(start);
  };

  const readQuoted = (): string => {
    const start = ++i;
    let depth = 0;
    for (; i < n; i++) {
      if (src[i] === '\\') {
        i++;
        continue;
      }
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      else if (src[i] === '"' && depth === 0) {
        i++;
        return src.slice(start, i - 1);
      }
    }
    return src.slice(start);
  };

  const readValue = (): string => {
    let parts = '';
    while (i < n) {
      skipWs();
      if (src[i] === '{') parts += readBraced();
      else if (src[i] === '"') parts += readQuoted();
      else {
        const m = /^[^,}#\s]+/.exec(src.slice(i));
        if (!m) break;
        i += m[0].length;
        parts += strings[m[0].toLowerCase()] ?? m[0];
      }
      skipWs();
      if (src[i] === '#') {
        i++;
        continue;
      }
      break;
    }
    return parts;
  };

  while (i < n) {
    const at = src.indexOf('@', i);
    if (at < 0) break;
    i = at + 1;
    const tm = /^([A-Za-z]+)\s*[{(]/.exec(src.slice(i));
    if (!tm) continue;
    const type = tm[1].toLowerCase();
    i += tm[0].length;

    if (type === 'comment' || type === 'preamble') {
      i--; // 여는 괄호로
      if (src[i] === '{') readBraced();
      continue;
    }
    if (type === 'string') {
      skipWs();
      const nm = /^([A-Za-z][\w-]*)\s*=\s*/.exec(src.slice(i));
      if (nm) {
        i += nm[0].length;
        strings[nm[1].toLowerCase()] = readValue();
      }
      continue;
    }

    skipWs();
    const km = /^([^,\s]+)\s*,/.exec(src.slice(i));
    if (!km) continue;
    const key = km[1];
    i += km[0].length;
    const fields: Record<string, string> = {};
    while (i < n) {
      skipWs();
      if (src[i] === '}' || src[i] === ')') {
        i++;
        break;
      }
      const fm = /^([A-Za-z][\w-]*)\s*=\s*/.exec(src.slice(i));
      if (!fm) {
        // 알 수 없는 문자 — 다음 쉼표나 닫는 괄호까지 건너뜀
        const next = src.slice(i).search(/[,}]/);
        if (next < 0) break;
        i += next + (src[i + next] === ',' ? 1 : 0);
        continue;
      }
      i += fm[0].length;
      fields[fm[1].toLowerCase()] = cleanValue(readValue());
      skipWs();
      if (src[i] === ',') i++;
    }
    out.set(key, { key, type, fields });
  }
  return out;
}

/* ---------------- 저자 이름 ---------------- */

interface Name {
  last: string;
  first: string;
}

function parseNames(s: string | undefined): Name[] {
  if (!s) return [];
  return s
    .split(/\s+and\s+/i)
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => {
      if (a.toLowerCase() === 'others') return { last: 'others', first: '' };
      if (a.includes(',')) {
        const [last, first] = a.split(',', 2).map((x) => x.trim());
        return { last, first };
      }
      if (/[가-힣]/.test(a) && !a.includes(' ')) return { last: a, first: '' }; // 한글 이름 통째로
      const parts = a.split(/\s+/);
      const last = parts.pop() ?? a;
      return { last, first: parts.join(' ') };
    });
}

const initials = (first: string) =>
  first
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + '.')
    .join(' ');

const fullName = (n: Name) => (n.first ? `${n.last}, ${initials(n.first)}` : n.last);

/* ---------------- 서식 ---------------- */

export type CiteStyle = 'author-year' | 'numeric';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function authorShort(e: BibEntry, lang: 'ko' | 'en'): string {
  const names = parseNames(e.fields.author ?? e.fields.editor);
  if (!names.length) return e.fields.title?.split(' ').slice(0, 3).join(' ') ?? e.key;
  const etal = lang === 'ko' && /[가-힣]/.test(names[0].last) ? ' 외' : ' et al.';
  if (names.length === 1) return names[0].last;
  if (names.length === 2 && names[1].last !== 'others') return `${names[0].last} & ${names[1].last}`;
  return names[0].last + etal;
}

const year = (e: BibEntry) => e.fields.year ?? (e.fields.date ? e.fields.date.slice(0, 4) : 'n.d.');

export function formatReference(e: BibEntry): string {
  const f = e.fields;
  const names = parseNames(f.author ?? f.editor);
  let authors = '';
  if (names.length === 1) authors = fullName(names[0]);
  else if (names.length > 1) {
    const list = names.filter((x) => x.last !== 'others').map(fullName);
    authors = list.slice(0, -1).join(', ') + ', & ' + list[list.length - 1];
    if (names.some((x) => x.last === 'others')) authors = list.join(', ') + ', et al.';
  }
  const parts: string[] = [];
  if (authors) parts.push(escapeHtml(authors) + (f.editor && !f.author ? ' (Ed.)' : ''));
  parts.push(`(${escapeHtml(year(e))}).`);
  if (f.title) parts.push(escapeHtml(f.title.replace(/\.$/, '')) + '.');

  const venue = f.journal ?? f.journaltitle ?? f.booktitle;
  if (venue) {
    let v = `<em>${escapeHtml(venue)}</em>`;
    if (f.volume) v += `, <em>${escapeHtml(f.volume)}</em>`;
    if (f.number) v += `(${escapeHtml(f.number)})`;
    if (f.pages) v += `, ${escapeHtml(f.pages)}`;
    parts.push((e.type === 'inproceedings' ? 'In ' : '') + v + '.');
  } else if (f.publisher || f.school || f.institution) {
    parts.push(escapeHtml(f.publisher ?? f.school ?? f.institution ?? '') + '.');
  }
  if (f.doi) {
    const doi = f.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    parts.push(`<a href="https://doi.org/${escapeHtml(doi)}">https://doi.org/${escapeHtml(doi)}</a>`);
  } else if (f.url) {
    parts.push(`<a href="${escapeHtml(f.url)}">${escapeHtml(f.url)}</a>`);
  }
  return parts.join(' ');
}

/** 참고문헌 정렬용 */
function sortKey(e: BibEntry): string {
  const n = parseNames(e.fields.author ?? e.fields.editor)[0];
  return `${n?.last ?? e.fields.title ?? e.key} ${year(e)}`.toLowerCase();
}

export interface CitationResult {
  used: BibEntry[];
  missing: string[];
}

/**
 * root 안의 <cite class="cite" data-cites="..."> 를 서식에 맞게 바꾸고
 * 참고문헌 목록을 문서 끝(또는 <div id="refs">)에 넣는다.
 * 그림·표·수식 참조 키(fig:, tbl:, eq:)는 건너뛴다 (crossref가 처리).
 */
export function applyCitations(
  root: HTMLElement,
  bib: Map<string, BibEntry>,
  style: CiteStyle,
  lang: 'ko' | 'en',
): CitationResult {
  const cites = Array.from(root.querySelectorAll<HTMLElement>('cite.cite'));
  const order: string[] = [];
  const missing = new Set<string>();

  for (const c of cites) {
    const items: CiteItem[] = JSON.parse(c.dataset.cites ?? '[]');
    if (items.every((it) => /^(fig|tbl|eq|sec):/.test(it.key))) continue;
    for (const it of items) if (bib.has(it.key) && !order.includes(it.key)) order.push(it.key);
  }

  const numberOf = (key: string) => order.indexOf(key) + 1;

  for (const c of cites) {
    const items: CiteItem[] = JSON.parse(c.dataset.cites ?? '[]');
    if (items.every((it) => /^(fig|tbl|eq|sec):/.test(it.key))) continue;
    const pieces = items.map((it) => {
      const e = bib.get(it.key);
      if (!e) {
        missing.add(it.key);
        return `<span class="cite-missing" title="참고문헌에 없는 키">?${escapeHtml(it.key)}</span>`;
      }
      const pre = it.prefix ? escapeHtml(it.prefix) + ' ' : '';
      const suf = it.suffix ? ', ' + escapeHtml(it.suffix) : '';
      const body = style === 'numeric' ? String(numberOf(it.key)) : `${escapeHtml(authorShort(e, lang))}, ${escapeHtml(year(e))}`;
      return `${pre}<a href="#ref-${escapeHtml(it.key)}">${body}</a>${suf}`;
    });
    c.innerHTML = style === 'numeric' ? `[${pieces.join(', ')}]` : `(${pieces.join('; ')})`;
    c.classList.add('cite-done');
  }

  const used = order.map((k) => bib.get(k)!);
  if (used.length) {
    const list = style === 'numeric' ? used : [...used].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const section = document.createElement('section');
    section.className = 'references';
    const title = lang === 'ko' ? '참고문헌' : 'References';
    const tag = style === 'numeric' ? 'ol' : 'ul';
    section.innerHTML =
      `<h2 id="references">${title}</h2><${tag}>` +
      list.map((e) => `<li id="ref-${escapeHtml(e.key)}">${formatReference(e)}</li>`).join('') +
      `</${tag}>`;
    const slot = root.querySelector('#refs');
    if (slot) slot.replaceWith(section);
    else {
      // 각주가 있으면 그 앞에
      const fn = root.querySelector('.footnotes-sep') ?? root.querySelector('.footnotes');
      if (fn) fn.before(section);
      else root.appendChild(section);
    }
  }
  return { used, missing: [...missing] };
}
