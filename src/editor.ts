import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment, Prec, type Extension } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import { mathMarkdown, mathHighlight } from './editor-math';
import { delimitedToMarkdown, formatTableLines } from './tables';
import { isDark } from './settings';

export interface EditorHandle {
  view: EditorView;
  newState(text: string): EditorState;
  setState(state: EditorState): void;
  getDoc(): string;
  /** 화면 맨 위에 보이는 줄 (0부터, 소수점은 줄 내부 비율) */
  topLine(): number;
  atBottom(): boolean;
  scrollToLine(line: number): void;
  /** 줄 번호(소수 포함)가 화면 맨 위에 오도록 */
  scrollToLineFrac(line: number): void;
  /** 해당 줄로 커서 이동 + 화면 가운데 */
  revealLine(line: number): void;
  insertAt(pos: number | null, text: string): void;
  formatTable(): boolean;
  focus(): void;
  hasFocus(): boolean;
}

export interface EditorOptions {
  onChange: () => void;
  onSave: () => void;
  onScroll: () => void;
  /** 붙여넣은 이미지를 저장하고 삽입할 마크다운을 돌려줌 (null이면 취소) */
  onPasteImage: (file: File) => Promise<string | null>;
}

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font-size, 14px)' },
  '.cm-scroller': {
    fontFamily: '"SF Mono", Menlo, Consolas, "D2Coding", "Apple SD Gothic Neo", "Malgun Gothic", monospace',
    lineHeight: '1.65',
  },
  '.cm-content': { padding: '16px 0 40vh' },
  '.cm-line': { padding: '0 18px' },
  '.cm-gutters': { border: 'none' },
  '.cm-panels': { fontFamily: 'inherit' },
});

// 찾기·바꾸기 패널 한국어
const phrases = EditorState.phrases.of({
  Find: '찾기',
  Replace: '바꾸기',
  next: '다음',
  previous: '이전',
  all: '모두',
  'match case': '대소문자 구분',
  regexp: '정규식',
  'by word': '단어 단위',
  replace: '바꾸기',
  'replace all': '모두 바꾸기',
  close: '닫기',
  'Go to line': '줄로 이동',
  go: '이동',
  'current match': '현재 항목',
  'on line': '줄',
  'replaced match on line $': '$번 줄에서 바꿈',
  'replaced $ matches': '$개 바꿈',
  'Folded lines': '접힌 줄',
  'Unfolded lines': '펼친 줄',
  'Fold line': '접기',
  'Unfold line': '펼치기',
});

export function createEditor(parent: HTMLElement, opts: EditorOptions): EditorHandle {
  const themeComp = new Compartment();
  const themeFor = () => (isDark() ? oneDark : []);

  let view: EditorView;

  const formatTable = (): boolean => {
    const st = view.state;
    const doc = st.doc;
    const cur = doc.lineAt(st.selection.main.head);
    const isRow = (n: number) => /^\s*\|/.test(doc.line(n).text);
    if (!isRow(cur.number)) return false;
    let a = cur.number, b = cur.number;
    while (a > 1 && isRow(a - 1)) a--;
    while (b < doc.lines && isRow(b + 1)) b++;
    const lines: string[] = [];
    for (let n = a; n <= b; n++) lines.push(doc.line(n).text);
    const out = formatTableLines(lines);
    const from = doc.line(a).from, to = doc.line(b).to;
    const text = out.join('\n');
    if (text === doc.sliceString(from, to)) return true;
    view.dispatch({ changes: { from, to, insert: text } });
    return true;
  };

  const extensions = (): Extension[] => [
    basicSetup,
    yamlFrontmatter({
      content: markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [mathMarkdown] }),
    }),
    mathHighlight,
    EditorView.lineWrapping,
    baseTheme,
    phrases,
    themeComp.of(themeFor()),
    Prec.highest(
      keymap.of([
        { key: 'Mod-s', run: () => (opts.onSave(), true) },
        { key: 'Shift-Alt-f', run: formatTable },
      ]),
    ),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange();
    }),
    EditorView.domEventHandlers({
      paste(event, v) {
        const dt = event.clipboardData;
        if (!dt) return false;
        const img = Array.from(dt.files).find((f) => f.type.startsWith('image/'));
        if (img) {
          event.preventDefault();
          const pos = v.state.selection.main.head;
          void opts.onPasteImage(img).then((mdText) => {
            if (mdText) insertAt(pos, mdText);
          });
          return true;
        }
        const text = dt.getData('text/plain');
        if (text && text.includes('\t')) {
          const table = delimitedToMarkdown(text);
          if (table) {
            event.preventDefault();
            const line = v.state.doc.lineAt(v.state.selection.main.head);
            const prefix = line.text.trim() ? '\n\n' : '';
            v.dispatch(v.state.replaceSelection(prefix + table + '\n'));
            return true;
          }
        }
        return false;
      },
    }),
  ];

  view = new EditorView({
    parent,
    state: EditorState.create({ doc: '', extensions: extensions() }),
  });

  view.scrollDOM.addEventListener('scroll', () => opts.onScroll(), { passive: true });

  window.addEventListener('themechange', () => {
    view.dispatch({ effects: themeComp.reconfigure(themeFor()) });
  });

  /** 블록(이미지 등)을 앞뒤 문단과 빈 줄로 떨어뜨려 삽입 */
  function insertAt(pos: number | null, text: string) {
    const doc = view.state.doc;
    const at = pos ?? view.state.selection.main.head;
    const line = doc.lineAt(at);
    let prefix = '';
    if (at !== line.from && line.text.trim()) prefix = '\n\n';
    else if (at === line.from && line.number > 1 && doc.line(line.number - 1).text.trim()) prefix = '\n';
    const body = text.replace(/\n+$/, '');
    let suffix = '\n';
    if (at < doc.length) {
      const after = doc.sliceString(at, at + 1);
      if (after !== '\n') suffix = '\n\n';
      else {
        const next = line.number < doc.lines ? doc.line(line.number + 1).text : '';
        suffix = next.trim() ? '\n' : '';
      }
    }
    const insert = prefix + body + suffix;
    view.dispatch({
      changes: { from: at, insert },
      selection: { anchor: at + prefix.length + body.length },
      scrollIntoView: true,
    });
    view.focus();
  }

  const docTopOffset = () => view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;

  return {
    view,
    newState: (text: string) => EditorState.create({ doc: text, extensions: extensions() }),
    setState(state: EditorState) {
      view.setState(state);
      // 새 상태에도 현재 테마 적용
      view.dispatch({ effects: themeComp.reconfigure(themeFor()) });
    },
    getDoc: () => view.state.doc.toString(),
    topLine() {
      const h = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
      const blk = view.lineBlockAtHeight(Math.max(0, h));
      const line = view.state.doc.lineAt(blk.from).number - 1;
      const frac = blk.height > 0 ? Math.min(1, Math.max(0, (h - blk.top) / blk.height)) : 0;
      return line + frac;
    },
    atBottom() {
      const s = view.scrollDOM;
      return s.scrollTop + s.clientHeight >= s.scrollHeight - 4;
    },
    scrollToLine(line: number) {
      const n = Math.min(view.state.doc.lines, Math.max(1, Math.floor(line) + 1));
      const pos = view.state.doc.line(n).from;
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
    },
    scrollToLineFrac(line: number) {
      const doc = view.state.doc;
      const n = Math.min(doc.lines, Math.max(1, Math.floor(line) + 1));
      const blk = view.lineBlockAt(doc.line(n).from);
      const frac = line - Math.floor(line);
      view.scrollDOM.scrollTop = blk.top + blk.height * frac + docTopOffset();
    },
    revealLine(line: number) {
      const n = Math.min(view.state.doc.lines, Math.max(1, line + 1));
      const pos = view.state.doc.line(n).from;
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
      view.focus();
    },
    insertAt,
    formatTable,
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
  };
}
