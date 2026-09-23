import './styles.css';
import './preview.css';
import welcome from './welcome.md?raw';
import { createEditor } from './editor';
import { Preview } from './preview';
import { Explorer } from './explorer';
import { loadMathJax } from './math';
import {
  isTauri,
  readTextFile,
  writeTextFile,
  fileMtime,
  pathKind,
  takePendingFile,
  basename,
  dirname,
  resolvePath,
  isExternalUrl,
} from './fs';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/* ---------------- 상태 ---------------- */

const state = {
  path: null as string | null,
  saved: welcome,
  mtime: 0,
  dirty: false,
  editorVisible: true,
  sidebarVisible: true,
};

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* 무시 */
    }
  },
};

const docDir = () => (state.path ? dirname(state.path) : null);

/* ---------------- 구성 요소 ---------------- */

const preview = new Preview($('#preview-scroll'));
const explorer = new Explorer($('#sidebar'), (p) => void openFile(p));

let renderTimer: number | undefined;
let syncFrame = 0;

const editor = createEditor($('#editor-pane'), {
  onChange() {
    updateDirty();
    clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderNow, 200);
  },
  onSave: () => void save(),
  onScroll() {
    if (!state.editorVisible) return;
    cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(() => preview.syncTo(editor.topLine(), editor.atBottom()));
  },
});

preview.onRendered = () => {
  if (state.editorVisible) preview.syncTo(editor.topLine(), editor.atBottom());
};

function renderNow() {
  clearTimeout(renderTimer);
  return preview.render(editor.getDoc(), docDir());
}

/* ---------------- 제목 / 변경 표시 ---------------- */

async function updateTitle() {
  const name = state.path ? basename(state.path) : '제목 없음';
  $('#doc-title .name').textContent = name;
  $('#doc-title').title = state.path ?? '';
  $('#doc-title .dirty').hidden = !state.dirty;
  const title = `${state.dirty ? '● ' : ''}${name} — MD Viewer`;
  document.title = title;
  if (isTauri) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    getCurrentWindow().setTitle(title).catch(() => {});
  }
}

function updateDirty() {
  const dirty = editor.getDoc() !== state.saved;
  if (dirty !== state.dirty) {
    state.dirty = dirty;
    void updateTitle();
  }
}

/* ---------------- 대화상자 ---------------- */

async function showError(msg: string) {
  if (isTauri) {
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message(msg, { title: '오류', kind: 'error' });
  } else {
    alert(msg);
  }
}

/** 저장 안 된 변경이 있으면 물어봄. 계속 진행해도 되면 true */
async function confirmDiscard(): Promise<boolean> {
  if (!state.dirty) return true;
  const name = state.path ? basename(state.path) : '제목 없음';
  if (!isTauri) return confirm(`"${name}"의 변경 사항을 버릴까요?`);
  const { message } = await import('@tauri-apps/plugin-dialog');
  const r = await message(`"${name}"의 변경 사항을 저장할까요?`, {
    title: '저장하지 않은 변경 사항',
    kind: 'warning',
    buttons: { yes: '저장', no: '저장 안 함', cancel: '취소' },
  });
  if (r === '저장' || r === 'Yes') return save();
  if (r === '저장 안 함' || r === 'No') return true;
  return false;
}

/* ---------------- 파일 / 폴더 ---------------- */

function loadIntoEditor(content: string, keepPosition = false) {
  const line = keepPosition ? editor.topLine() : 0;
  editor.setDoc(content);
  if (keepPosition) editor.scrollToLine(Math.floor(line));
  else preview.scroller.scrollTop = 0;
  state.saved = content;
  state.dirty = false;
  void updateTitle();
  void renderNow();
}

async function openFile(path: string, force = false) {
  if (!force && path === state.path) return;
  if (!(await confirmDiscard())) return;
  try {
    const data = await readTextFile(path);
    state.path = path;
    state.mtime = data.mtime;
    loadIntoEditor(data.content);
    explorer.setActive(path);
    store.set('lastFile', path);
    if (!explorer.rootPath) await openFolder(dirname(path));
  } catch (e) {
    await showError(`파일을 열 수 없습니다.\n${path}\n\n${e}`);
  }
}

async function openFolder(path: string) {
  await explorer.setRoot(path);
  explorer.setActive(state.path);
  store.set('lastRoot', path);
}

async function pickFolder() {
  if (!isTauri) return;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const dir = await open({ directory: true, multiple: false, title: '폴더 열기' });
  if (typeof dir === 'string') await openFolder(dir);
}

async function newDocument() {
  if (!(await confirmDiscard())) return;
  state.path = null;
  state.mtime = 0;
  loadIntoEditor('');
  explorer.setActive(null);
  store.set('lastFile', null);
  editor.focus();
}

async function save(): Promise<boolean> {
  if (!isTauri) return false;
  let path = state.path;
  let isNew = false;
  if (!path) {
    const { save: saveDialog } = await import('@tauri-apps/plugin-dialog');
    const base = explorer.rootPath ?? undefined;
    const picked = await saveDialog({
      title: '다른 이름으로 저장',
      defaultPath: base ? resolvePath(base, 'untitled.md') : 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (!picked) return false;
    path = picked;
    isNew = true;
  }
  const content = editor.getDoc();
  try {
    state.mtime = await writeTextFile(path, content);
  } catch (e) {
    await showError(`저장하지 못했습니다.\n${path}\n\n${e}`);
    return false;
  }
  state.path = path;
  state.saved = content;
  state.dirty = false;
  store.set('lastFile', path);
  void updateTitle();
  if (isNew) {
    if (!explorer.rootPath) await openFolder(dirname(path));
    else await explorer.refresh();
    explorer.setActive(path);
    void renderNow(); // 상대 경로 이미지 기준 폴더가 생겼으므로 다시 렌더
  }
  return true;
}

/** 다른 프로그램에서 파일이 바뀌었는지 확인 (창이 포커스를 받을 때) */
async function checkExternalChange() {
  if (!isTauri) return;
  void explorer.refresh();
  const path = state.path;
  if (!path) return;
  let mtime: number;
  try {
    mtime = await fileMtime(path);
  } catch {
    return; // 삭제되었거나 접근 불가 — 편집 중인 내용은 유지
  }
  if (mtime === state.mtime) return;
  state.mtime = mtime;
  if (state.dirty) {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    const reload = await ask(
      `"${basename(path)}" 파일이 다른 곳에서 변경되었습니다.\n다시 불러올까요? (편집 중인 내용은 사라집니다)`,
      { title: '파일 변경됨', kind: 'warning', okLabel: '다시 불러오기', cancelLabel: '유지' },
    );
    if (!reload) return;
  }
  const data = await readTextFile(path);
  state.mtime = data.mtime;
  loadIntoEditor(data.content, true);
}

/* ---------------- 레이아웃 ---------------- */

const main = $('#main');

function applyLayout() {
  main.classList.toggle('no-sidebar', !state.sidebarVisible);
  main.classList.toggle('no-editor', !state.editorVisible);
  store.set('sidebarVisible', String(state.sidebarVisible));
  store.set('editorVisible', String(state.editorVisible));
}

function toggleSidebar() {
  state.sidebarVisible = !state.sidebarVisible;
  applyLayout();
}

function toggleEditor() {
  const line = preview.topLine();
  state.editorVisible = !state.editorVisible;
  applyLayout();
  if (state.editorVisible) {
    requestAnimationFrame(() => {
      editor.scrollToLine(line);
      editor.view.requestMeasure();
    });
  }
}

function setupGutters() {
  const sideW = Number(store.get('sideWidth')) || 240;
  const ratio = Number(store.get('editorRatio')) || 0.5;
  main.style.setProperty('--side-w', `${sideW}px`);
  main.style.setProperty('--ratio', String(ratio));

  const drag = (gutter: HTMLElement, onMove: (x: number) => void, onEnd: () => void) => {
    gutter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      gutter.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing');
      const move = (ev: PointerEvent) => onMove(ev.clientX);
      const up = () => {
        gutter.removeEventListener('pointermove', move);
        gutter.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing');
        onEnd();
      };
      gutter.addEventListener('pointermove', move);
      gutter.addEventListener('pointerup', up);
    });
  };

  drag(
    $('#gutter-side'),
    (x) => {
      const w = Math.min(520, Math.max(160, x - main.getBoundingClientRect().left));
      main.style.setProperty('--side-w', `${w}px`);
    },
    () => store.set('sideWidth', main.style.getPropertyValue('--side-w').replace('px', '')),
  );

  drag(
    $('#gutter-mid'),
    (x) => {
      const ed = $('#editor-pane').getBoundingClientRect();
      const pv = $('#preview-pane').getBoundingClientRect();
      const total = pv.right - ed.left;
      const r = Math.min(0.8, Math.max(0.2, (x - ed.left) / total));
      main.style.setProperty('--ratio', r.toFixed(4));
    },
    () => store.set('editorRatio', main.style.getPropertyValue('--ratio')),
  );
}

/* ---------------- 미리보기: 링크, 이미지 확대 ---------------- */

function setupPreviewInteractions() {
  const lightbox = $('#lightbox');
  const lbImg = lightbox.querySelector('img')!;
  const closeLightbox = () => (lightbox.hidden = true);
  lightbox.addEventListener('click', closeLightbox);

  preview.body.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    const img = target.closest('img');
    if (img && !target.closest('a')) {
      lbImg.src = img.currentSrc || img.src;
      lightbox.hidden = false;
      return;
    }

    const a = target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    e.preventDefault(); // 앱 창이 다른 페이지로 이동하지 않도록

    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      const el = preview.body.querySelector(`[id="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ block: 'start' });
      return;
    }
    if (isExternalUrl(href)) {
      if (isTauri) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        openUrl(href).catch((err) => showError(String(err)));
      } else {
        window.open(href, '_blank');
      }
      return;
    }
    // 상대 경로 링크: 마크다운이면 편집기에서 열기
    const base = docDir();
    if (!base || !isTauri) return;
    let rel = href.split('#')[0];
    try {
      rel = decodeURIComponent(rel);
    } catch {
      /* 그대로 */
    }
    const abs = resolvePath(base, rel);
    if (/\.(md|markdown|mdx|txt)$/i.test(abs)) {
      await openFile(abs);
    } else {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      openPath(abs).catch(() => {});
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });
}

/* ---------------- 단축키 / 버튼 ---------------- */

function setupCommands() {
  $('#btn-sidebar').addEventListener('click', toggleSidebar);
  $('#btn-editor').addEventListener('click', toggleEditor);
  $('#btn-open').addEventListener('click', () => void pickFolder());
  $('#btn-open-2').addEventListener('click', () => void pickFolder());
  $('#btn-new').addEventListener('click', () => void newDocument());
  $('#btn-save').addEventListener('click', () => void save());
  $('#btn-refresh').addEventListener('click', () => void explorer.refresh());

  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const run = (fn: () => unknown) => {
      e.preventDefault();
      fn();
    };
    if (k === 'o') run(() => void pickFolder());
    else if (k === 'n') run(() => void newDocument());
    else if (k === 'b') run(toggleSidebar);
    else if (k === 'e') run(toggleEditor);
    else if (k === 's') run(() => void save());
  });

  window.addEventListener('focus', () => void checkExternalChange());
}

async function setupTauriEvents() {
  if (!isTauri) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  const { listen } = await import('@tauri-apps/api/event');

  // 창 닫기 전에 저장 확인
  await getCurrentWindow().onCloseRequested(async (ev) => {
    if (!state.dirty) return;
    if (!(await confirmDiscard())) ev.preventDefault();
  });

  // 폴더 / 파일 끌어다 놓기
  await getCurrentWebview().onDragDropEvent(async (ev) => {
    if (ev.payload.type !== 'drop') return;
    const p = ev.payload.paths[0];
    if (!p) return;
    const kind = await pathKind(p);
    if (kind === 'dir') await openFolder(p);
    else if (kind === 'file' && /\.(md|markdown|mdx|txt)$/i.test(p)) await openFile(p);
  });

  // macOS: 앱이 실행 중일 때 Finder에서 .md 더블클릭
  await listen<string>('open-file', async (ev) => {
    await takePendingFile();
    await openFile(ev.payload);
  });
}

/* ---------------- 시작 ---------------- */

async function start() {
  state.sidebarVisible = store.get('sidebarVisible') !== 'false';
  state.editorVisible = store.get('editorVisible') !== 'false';
  applyLayout();
  setupGutters();
  setupPreviewInteractions();
  setupCommands();
  void loadMathJax();

  editor.setDoc(welcome);
  void updateTitle();
  void renderNow();

  if (!isTauri) {
    document.body.classList.add('browser-mode');
    return;
  }
  await setupTauriEvents();

  const pending = await takePendingFile();
  const lastRoot = store.get('lastRoot');
  const lastFile = store.get('lastFile');

  if (lastRoot && (await pathKind(lastRoot)) === 'dir') await openFolder(lastRoot);

  if (pending && (await pathKind(pending)) === 'file') {
    const root = explorer.rootPath;
    const inRoot = root && pending.startsWith(root);
    if (!inRoot) await openFolder(dirname(pending));
    await openFile(pending, true);
  } else if (lastFile && (await pathKind(lastFile)) === 'file') {
    await openFile(lastFile, true);
  }
}

void start();
