// 편집기에서 수식 구간을 하나의 덩어리로 인식 → _ * 가 기울임/밑줄로 잘못 칠해지지 않고 수식 색으로 표시
import type { MarkdownConfig } from '@lezer/markdown';
import { Tag } from '@lezer/highlight';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';

const mathTag = Tag.define();
const DOLLAR = 36, BACKSLASH = 92, OPEN_PAREN = 40, SPACE = /\s/;

export const mathMarkdown: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: mathTag },
    { name: 'BlockMath', block: true, style: mathTag },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      before: 'Escape',
      parse(cx, next, pos) {
        const text = cx.slice(pos, cx.end);
        if (next === BACKSLASH && cx.char(pos + 1) === OPEN_PAREN) {
          const end = text.indexOf('\\)', 2);
          return end < 0 ? -1 : cx.addElement(cx.elt('InlineMath', pos, pos + end + 2));
        }
        if (next === BACKSLASH && /^\\(eq)?ref\{[^}]*\}/.test(text)) {
          const m = /^\\(eq)?ref\{[^}]*\}/.exec(text)!;
          return cx.addElement(cx.elt('InlineMath', pos, pos + m[0].length));
        }
        if (next !== DOLLAR) return -1;
        if (cx.char(pos + 1) === DOLLAR) {
          const end = text.indexOf('$$', 2);
          return end < 0 ? -1 : cx.addElement(cx.elt('InlineMath', pos, pos + end + 2));
        }
        if (text.length < 2 || SPACE.test(text[1])) return -1;
        for (let i = 1; i < text.length; i++) {
          if (text[i] === '\\') {
            i++;
            continue;
          }
          if (text[i] !== '$') continue;
          if (SPACE.test(text[i - 1]) || /\d/.test(text[i + 1] ?? '')) continue;
          return cx.addElement(cx.elt('InlineMath', pos, pos + i + 1));
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'FencedCode',
      parse(cx, line) {
        const t = line.text.slice(line.pos);
        let open = 0, close: string;
        const env = /^\\begin\{([a-zA-Z*]+)\}/.exec(t);
        if (t.startsWith('$$')) (open = 2), (close = '$$');
        else if (t.startsWith('\\[')) (open = 2), (close = '\\]');
        else if (env) close = `\\end{${env[1]}}`;
        else return false;

        const from = cx.lineStart + line.pos;
        let end = cx.lineStart + line.text.length;
        const closeIdx = t.indexOf(close, open);
        if (closeIdx >= 0) {
          if (t.slice(closeIdx + close.length).trim() !== '') return false; // 인라인으로 처리
          cx.nextLine();
        } else {
          let found = false;
          while (cx.nextLine()) {
            end = cx.lineStart + line.text.length;
            if (line.text.includes(close)) {
              found = true;
              cx.nextLine();
              break;
            }
          }
          if (!found) end = cx.lineStart;
        }
        cx.addElement(cx.elt('BlockMath', from, end));
        return true;
      },
    },
  ],
};

export const mathHighlight = syntaxHighlighting(HighlightStyle.define([{ tag: mathTag, class: 'cm-math' }]));
