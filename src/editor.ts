import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment, Prec, type Extension } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { mathMarkdown, mathHighlight } from './editor-math';

export interface EditorHandle {
  view: EditorView;
  setDoc(text: string): void;
  getDoc(): string;
  /** 화면 맨 위에 보이는 줄 (0부터, 소수점은 줄 내부 비율) */
  topLine(): number;
  atBottom(): boolean;
  scrollToLine(line: number): void;
  focus(): void;
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px' },
  '.cm-scroller': {
    fontFamily: '"SF Mono", Menlo, Consolas, "D2Coding", "Apple SD Gothic Neo", "Malgun Gothic", monospace',
    lineHeight: '1.65',
  },
  '.cm-content': { padding: '16px 0 40vh' },
  '.cm-line': { padding: '0 18px' },
  '.cm-gutters': { border: 'none' },
});

export function createEditor(
  parent: HTMLElement,
  opts: { onChange: () => void; onSave: () => void; onScroll: () => void },
): EditorHandle {
  const themeComp = new Compartment();
  const themeFor = () => (darkQuery.matches ? oneDark : []);

  const extensions = (): Extension[] => [
    basicSetup,
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [mathMarkdown] }),
    mathHighlight,
    EditorView.lineWrapping,
    baseTheme,
    themeComp.of(themeFor()),
    Prec.highest(
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            opts.onSave();
            return true;
          },
        },
      ]),
    ),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange();
    }),
  ];

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: '', extensions: extensions() }),
  });

  view.scrollDOM.addEventListener('scroll', () => opts.onScroll(), { passive: true });

  darkQuery.addEventListener('change', () => {
    view.dispatch({ effects: themeComp.reconfigure(themeFor()) });
  });

  return {
    view,
    setDoc(text: string) {
      // 새 상태로 교체 → 파일마다 실행 취소 기록이 분리됨
      view.setState(EditorState.create({ doc: text, extensions: extensions() }));
      view.scrollDOM.scrollTop = 0;
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
      const n = Math.min(view.state.doc.lines, Math.max(1, line + 1));
      const pos = view.state.doc.line(n).from;
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
    },
    focus: () => view.focus(),
  };
}
