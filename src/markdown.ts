import MarkdownItCtor from 'markdown-it';
import type { StateBlock, StateInline, StateCore } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import hljs from 'highlight.js/lib/common';

type MarkdownIt = InstanceType<typeof MarkdownItCtor>;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ */
/* 수식: $..$, \(..\), $$..$$, \[..\], \begin{env}..\end{env}           */
/* 마크다운 파서가 _ * \ 를 먼저 먹지 않도록 파싱 단계에서 떼어낸다.        */
/* ------------------------------------------------------------------ */

function findClosing(src: string, from: number, delim: string): number {
  let i = from;
  while (i < src.length) {
    const j = src.indexOf(delim, i);
    if (j < 0) return -1;
    // \$ 처럼 이스케이프된 경우 건너뜀
    let bs = 0;
    for (let k = j - 1; k >= from && src[k] === '\\'; k--) bs++;
    if (delim === '$' && bs % 2 === 1) {
      i = j + 1;
      continue;
    }
    return j;
  }
  return -1;
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;
  const ch = src[pos];

  // \( ... \)  /  \[ ... \]
  if (ch === '\\' && (src[pos + 1] === '(' || src[pos + 1] === '[')) {
    const display = src[pos + 1] === '[';
    const close = display ? '\\]' : '\\)';
    const end = src.indexOf(close, pos + 2);
    if (end < 0) return false;
    if (!silent) {
      const t = state.push(display ? 'math_inline_display' : 'math_inline', 'math', 0);
      t.content = src.slice(pos + 2, end);
      t.markup = ch + src[pos + 1];
    }
    state.pos = end + 2;
    return true;
  }

  // 본문에 쓴 \eqref{..} / \ref{..} 도 수식 번호 참조로 처리
  if (ch === '\\' && (src.startsWith('\\eqref{', pos) || src.startsWith('\\ref{', pos))) {
    const end = src.indexOf('}', pos);
    if (end < 0) return false;
    if (!silent) {
      const t = state.push('math_inline', 'math', 0);
      t.content = src.slice(pos, end + 1);
      t.markup = '\\ref';
    }
    state.pos = end + 1;
    return true;
  }

  if (ch !== '$') return false;

  // $$ ... $$ (문단 안에 섞여 있는 경우)
  if (src[pos + 1] === '$') {
    const end = src.indexOf('$$', pos + 2);
    if (end < 0 || end === pos + 2) return false;
    if (!silent) {
      const t = state.push('math_inline_display', 'math', 0);
      t.content = src.slice(pos + 2, end);
      t.markup = '$$';
    }
    state.pos = end + 2;
    return true;
  }

  // $ ... $  — 여는 $ 뒤, 닫는 $ 앞에 공백 불가, 닫는 $ 뒤에 숫자 불가 ($5, $10 같은 금액 보호)
  const next = src[pos + 1];
  if (next === undefined || /\s/.test(next)) return false;
  let search = pos + 1;
  while (true) {
    const end = findClosing(src, search, '$');
    if (end < 0) return false;
    const prev = src[end - 1];
    const after = src[end + 1];
    if (/\s/.test(prev) || (after !== undefined && /\d/.test(after))) {
      search = end + 1;
      continue;
    }
    if (!silent) {
      const t = state.push('math_inline', 'math', 0);
      t.content = src.slice(pos + 1, end);
      t.markup = '$';
    }
    state.pos = end + 1;
    return true;
  }
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;

  const first = state.src.slice(pos, max);
  let open: string, close: string, isEnv = false;
  const env = /^\\begin\{([a-zA-Z*]+)\}/.exec(first);
  if (first.startsWith('$$')) {
    open = '$$';
    close = '$$';
  } else if (first.startsWith('\\[')) {
    open = '\\[';
    close = '\\]';
  } else if (env) {
    open = '';
    close = `\\end{${env[1]}}`;
    isEnv = true;
  } else {
    return false;
  }

  let content = '';
  let nextLine = startLine;
  const rest = first.slice(open.length);
  const sameLineEnd = rest.indexOf(close);

  if (sameLineEnd >= 0) {
    // 한 줄에 끝나는 경우: 닫는 기호 뒤에 다른 글자가 있으면 인라인으로 처리
    const tail = rest.slice(sameLineEnd + close.length);
    if (tail.trim() !== '') return false;
    content = isEnv ? first : rest.slice(0, sameLineEnd);
  } else {
    const lines: string[] = [isEnv ? first : rest];
    let found = false;
    for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
      pos = state.bMarks[nextLine] + state.tShift[nextLine];
      max = state.eMarks[nextLine];
      const lineText = state.src.slice(state.bMarks[nextLine], max);
      if (pos < max && state.sCount[nextLine] < state.blkIndent) break;
      const idx = lineText.indexOf(close);
      if (idx >= 0) {
        lines.push(isEnv ? lineText.slice(0, idx + close.length) : lineText.slice(0, idx));
        found = true;
        break;
      }
      lines.push(lineText);
    }
    if (!found) return false;
    content = lines.join('\n');
  }

  if (silent) return true;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = content;
  token.info = isEnv ? 'env' : '';
  token.map = [startLine, nextLine + 1];
  token.markup = open;
  state.line = nextLine + 1;
  return true;
}

function mathPlugin(md: MarkdownIt) {
  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.block.ruler.before('fence', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="math mj-process">\\(${escapeHtml(tokens[idx].content)}\\)</span>`;
  md.renderer.rules.math_inline_display = (tokens, idx) =>
    `<span class="math math-display mj-process">\\[${escapeHtml(tokens[idx].content)}\\]</span>`;
  md.renderer.rules.math_block = (tokens, idx) => {
    const t = tokens[idx];
    const line = t.map ? ` data-line="${t.map[0]}"` : '';
    const body = t.info === 'env' ? escapeHtml(t.content) : `\\[${escapeHtml(t.content)}\\]`;
    return `<div class="math math-block mj-process"${line}>${body}</div>\n`;
  };
}

/* ------------------------------------------------------------------ */
/* 스크롤 동기화용 원본 줄 번호, 제목 앵커, 체크박스                        */
/* ------------------------------------------------------------------ */

function sourceLinePlugin(md: MarkdownIt) {
  md.core.ruler.push('source_line', (state: StateCore) => {
    for (const t of state.tokens) {
      if (t.map && (t.nesting === 1 || (t.nesting === 0 && t.block && t.type !== 'inline'))) {
        t.attrSet('data-line', String(t.map[0]));
      }
    }
  });
}

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function headingIdPlugin(md: MarkdownIt) {
  md.core.ruler.push('heading_ids', (state: StateCore) => {
    const used = new Map<string, number>();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'heading_open') continue;
      const inline = tokens[i + 1];
      const raw = inline?.children?.map((c) => c.content).join('') ?? inline?.content ?? '';
      let slug = slugify(raw) || 'section';
      const n = used.get(slug) ?? 0;
      used.set(slug, n + 1);
      if (n > 0) slug = `${slug}-${n}`;
      tokens[i].attrSet('id', slug);
    }
  });
}

function taskListPlugin(md: MarkdownIt) {
  md.core.ruler.push('task_list', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
      const m = /^\[([ xX])\]\s/.exec(t.content);
      if (!m || !t.children?.length || t.children[0].type !== 'text') continue;
      const first = t.children[0];
      first.content = first.content.replace(/^\[[ xX]\]\s/, '');
      const box = new state.Token('html_inline', '', 0);
      box.content = `<input type="checkbox" class="task" disabled${m[1] !== ' ' ? ' checked' : ''}> `;
      t.children.unshift(box);
      tokens[i - 2].attrJoin('class', 'task-item');
    }
  });
}

/* ------------------------------------------------------------------ */

export function createMarkdown(): MarkdownIt {
  const md: MarkdownIt = new MarkdownItCtor({
    html: true,
    linkify: true,
    typographer: false,
    highlight(code, lang) {
      const l = (lang || '').trim().split(/\s+/)[0];
      if (l && hljs.getLanguage(l)) {
        try {
          return hljs.highlight(code, { language: l, ignoreIllegals: true }).value;
        } catch {
          /* 기본 처리 */
        }
      }
      return '';
    },
  });

  md.use(mathPlugin).use(footnote).use(headingIdPlugin).use(taskListPlugin).use(sourceLinePlugin);

  // 넓은 표는 가로 스크롤
  md.renderer.rules.table_open = (tokens, idx, opts, _env, slf) =>
    '<div class="table-wrap">' + slf.renderToken(tokens, idx, opts);
  md.renderer.rules.table_close = (tokens, idx, opts, _env, slf) =>
    slf.renderToken(tokens, idx, opts) + '</div>';

  return md;
}
