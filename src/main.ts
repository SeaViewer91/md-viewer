import './styles.css';
import './preview.css';
import welcome from './welcome.md?raw';
import type { EditorState } from '@codemirror/state';
import { createEditor } from './editor';
import { Preview } from './preview';
import { Explorer } from './explorer';
import { Outline } from './outline';
import { FindBar } from './find';
import { loadMathJax } from './math';
import { settings, store, applyTheme, applyLayoutVars } from './settings';
import { openSettings } from './settings-ui';
import { exportHtml, printDocument } from './export';
import { checkForUpdates } from './update';
import { showError, askSave, askYesNo, toast, showMenu } from './ui';
import {
  isTauri,
  readTextFile,
  writeTextFile,
  writeBinaryFile,
  copyFile,
  fileMtime,
  pathKind,
  takePendingFile,
  watchDir,
  basename,
  dirname,
  resolvePath,
  relativePath,
  isExternalUrl,
  isImagePath,
  isMarkdownPath,
  extOf,
} from './fs';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/* ================================================================== */
/* 문서(탭) 모델                                                        */
/* ================================================================== */

interface Doc {
  id: number;
  path: string | null;
  title: string; // 경로가 없을 때 표시할 이름
  state: EditorState;
  saved: string;
  mtime: number;
  dirty: boolean;
  editorLine: number;
  previewTop: number;
}

let nextId = 1;
let untitledCount = 0;
const docs: Doc[] = [];
let active: Doc | null = null;

const docName = (d: Doc) => (d.path ? basename(d.path) : d.title);
const docDir = (d: Doc | null) => (d?.path ? dirname(d.path) : null);
const samePath = (a: string, b: string) => (isTauri && /^[A-Za-z]:/.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b);
const isUnder = (p: string, dir: string) => samePath(p, dir) || p.startsWith(dir.replace(/[\\/]+$/, '') + (dir.includes('\\') ? '\\' : '/'));

/* ================================================================== */
/* 구성 요소                                                            */
/* ================================================================== */

applyTheme();
applyLayoutVars();

const preview = new Preview($('#preview-scroll'), {
  loadText: async (p) => (await readTextFile(p)).content,
});

const explorer = new Explorer($('.side-panel[data-panel="files"]'), {
  openFile: (p) => void openFile(p),
  renamed: (from, to) => {
    for (const d of docs) {
      if (d.path && isUnder(d.path, from)) d.path = to + d.path.slice(from.length);
    }
    renderTabs();
    void updateTitle();
    saveSession();
  },
  removed: (p) => {
    for (const d of docs) {
      if (d.path && isUnder(d.path, p)) {
        d.title = `${basename(d.path)} (삭제됨)`;
        d.path = null;
        d.dirty = true;
      }
    }
    renderTabs();
    void updateTitle();
    saveSession();
  },
});

const outline = new Outline($('.outline-list'), preview.scroller, (item) => {
  scrollOwner = 'preview';
  item.el.scrollIntoView({ block: 'start' });
});

const findBar = new FindBar($('#preview-pane'), preview.body);

let renderTimer: number | undefined;
let autoSaveTimer: number | undefined;
let syncFrame = 0;
let scrollOwner: 'editor' | 'preview' = 'editor';
let editorVisible = store.get('editorVisible') !== 'false';
let sidebarVisible = store.get('sidebarVisible') !== 'false';
let pendingPreviewTop: number | null = null;

const editor = createEditor($('#editor-pane'), {
  onChange() {
    if (!active) return;
    const dirty = editor.getDoc() !== active.saved;
    if (dirty !== active.dirty) {
      active.dirty = dirty;
      renderTabs();
      void updateTitle();
    }
    clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderNow, 200);
    scheduleAutoSave();
  },
  onSave: () => void save(),
  onScroll() {
    if (!editorVisible || scrollOwner !== 'editor') return;
    cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(() => preview.syncTo(editor.topLine(), editor.atBottom()));
  },
  onPasteImage: (file) => pasteImage(file),
});

preview.beforeSwap = () => findBar.clear();
preview.onRendered = () => {
  findBar.reapply();
  outline.update(preview.headings());
  if (pendingPreviewTop !== null) {
    preview.scroller.scrollTop = pendingPreviewTop;
    pendingPreviewTop = null;
  } else if (editorVisible && scrollOwner === 'editor') {
    preview.syncTo(editor.topLine(), editor.atBottom());
  }
};

preview.scroller.addEventListener(
  'scroll',
  () => {
    if (!editorVisible || scrollOwner !== 'preview') return;
    cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(() => {
      if (preview.atBottom()) editor.view.scrollDOM.scrollTop = editor.view.scrollDOM.scrollHeight;
      else editor.scrollToLineFrac(preview.topLine());
    });
  },
  { passive: true },
);

// 사용자가 직접 조작한 쪽이 스크롤을 주도
for (const ev of ['wheel', 'pointerdown', 'keydown', 'touchstart']) {
  editor.view.scrollDOM.addEventListener(ev, () => (scrollOwner = 'editor'), { passive: true });
  preview.scroller.addEventListener(ev, () => (scrollOwner = 'preview'), { passive: true });
}

function renderNow() {
  clearTimeout(renderTimer);
  if (!active) return Promise.resolve();
  return preview.render(editor.getDoc(), { path: active.path });
}

/* ================================================================== */
/* 탭                                                                   */
/* ================================================================== */

function renderTabs() {
  const bar = $('#tabbar');
  bar.replaceChildren();
  for (const d of docs) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (d === active ? ' active' : '') + (d.dirty ? ' dirty' : '');
    tab.title = d.path ?? d.title;
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = docName(d);
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.title = '닫기 (⌘/Ctrl+W)';
    close.innerHTML = '<span class="x">✕</span><span class="dot">●</span>';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      void closeDoc(d);
    });
    tab.append(name, close);
    tab.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        void closeDoc(d);
      }
    });
    tab.addEventListener('click', () => activate(d));
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        { label: '닫기', action: () => void closeDoc(d) },
        { label: '다른 탭 모두 닫기', action: () => void closeOthers(d) },
        { separator: true, label: '' },
        {
          label: '경로 복사',
          disabled: !d.path,
          action: () => void navigator.clipboard.writeText(d.path ?? '').then(() => toast('경로를 복사했습니다')),
        },
      ]);
    });
    bar.appendChild(tab);
  }
  bar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

$('#tabbar').addEventListener('dblclick', (e) => {
  if (e.target === e.currentTarget) void newDocument();
});

function stashActive() {
  if (!active) return;
  active.state = editor.view.state;
  active.editorLine = editor.topLine();
  active.previewTop = preview.scroller.scrollTop;
}

function activate(d: Doc) {
  if (d === active) return;
  stashActive();
  active = d;
  editor.setState(d.state);
  preview.resetCaches();
  requestAnimationFrame(() => editor.scrollToLineFrac(d.editorLine));
  pendingPreviewTop = d.previewTop;
  void renderNow();
  explorer.setActive(d.path);
  renderTabs();
  void updateTitle();
  saveSession();
}

function addDoc(path: string | null, content: string, mtime: number, title = ''): Doc {
  const d: Doc = {
    id: nextId++,
    path,
    title: title || `제목 없음 ${++untitledCount}`,
    state: editor.newState(content),
    saved: content,
    mtime,
    dirty: false,
    editorLine: 0,
    previewTop: 0,
  };
  // 활성 탭 바로 뒤에 열기
  const idx = active ? docs.indexOf(active) + 1 : docs.length;
  docs.splice(idx, 0, d);
  return d;
}

async function closeDoc(d: Doc): Promise<boolean> {
  if (d.dirty) {
    if (d !== active) activate(d);
    const r = await askSave(docName(d));
    if (r === 'cancel') return false;
    if (r === 'save' && !(await save(d))) return false;
  }
  const idx = docs.indexOf(d);
  docs.splice(idx, 1);
  if (d === active) {
    active = null;
    const next = docs[idx] ?? docs[idx - 1];
    if (next) activate(next);
    else {
      activate(addDoc(null, '', 0));
    }
  }
  renderTabs();
  saveSession();
  return true;
}

async function closeOthers(keep: Doc) {
  for (const d of [...docs]) {
    if (d !== keep && !(await closeDoc(d))) return;
  }
}

function saveSession() {
  store.setJSON('session', {
    paths: docs.filter((d) => d.path).map((d) => d.path),
    active: active?.path ?? null,
  });
}

/* ================================================================== */
/* 제목                                                                 */
/* ================================================================== */

async function updateTitle() {
  const name = active ? docName(active) : 'MD Viewer';
  $('#doc-title .name').textContent = name;
  $('#doc-title').title = active?.path ?? '';
  $('#doc-title .dirty').hidden = !active?.dirty;
  const title = `${active?.dirty ? '● ' : ''}${name} — MD Viewer`;
  document.title = title;
  if (isTauri) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    getCurrentWindow().setTitle(title).catch(() => {});
  }
}

/* ================================================================== */
/* 파일 / 폴더                                                          */
/* ================================================================== */

function addRecent(path: string) {
  const list = store.getJSON<string[]>('recent', []).filter((p) => p !== path);
  list.unshift(path);
  store.setJSON('recent', list.slice(0, 20));
  renderRecent();
}

async function openFile(path: string) {
  const existing = docs.find((d) => d.path && samePath(d.path, path));
  if (existing) {
    activate(existing);
    return;
  }
  try {
    const data = await readTextFile(path);
    // 수정 안 한 빈 "제목 없음" 탭은 대체
    const blank = active && !active.path && !active.dirty && (editor.getDoc() === '' || active.title === '환영합니다') ? active : null;
    const d = addDoc(path, data.content, data.mtime);
    activate(d);
    if (blank) {
      docs.splice(docs.indexOf(blank), 1);
      renderTabs();
    }
    addRecent(path);
    if (!explorer.rootPath) await openFolder(dirname(path));
    saveSession();
  } catch (e) {
    await showError(`파일을 열 수 없습니다.\n${path}\n\n${e}`);
  }
}

async function openFolder(path: string) {
  await explorer.setRoot(path);
  explorer.setActive(active?.path ?? null);
  store.set('lastRoot', path);
  if (isTauri) watchDir(path).catch((e) => console.warn('[watch]', e));
}

async function pickFolder() {
  if (!isTauri) return;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const dir = await open({ directory: true, multiple: false, title: '폴더 열기' });
  if (typeof dir === 'string') await openFolder(dir);
}

async function newDocument() {
  activate(addDoc(null, '', 0));
  editor.focus();
}

async function save(d: Doc | null = active): Promise<boolean> {
  if (!d || !isTauri) return false;
  if (d === active) d.state = editor.view.state;
  let path = d.path;
  let isNew = false;
  if (!path) {
    const { save: saveDialog } = await import('@tauri-apps/plugin-dialog');
    const base = explorer.rootPath ?? undefined;
    const suggested = d.title.replace(/\s*\(삭제됨\)$/, '').replace(/^제목 없음.*$/, 'untitled');
    const picked = await saveDialog({
      title: '다른 이름으로 저장',
      defaultPath: base ? resolvePath(base, /\.\w+$/.test(suggested) ? suggested : suggested + '.md') : suggested + '.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (!picked) return false;
    path = picked;
    isNew = true;
  }
  const content = d.state.doc.toString();
  try {
    d.mtime = await writeTextFile(path, content);
  } catch (e) {
    await showError(`저장하지 못했습니다.\n${path}\n\n${e}`);
    return false;
  }
  d.path = path;
  d.saved = content;
  d.dirty = d === active ? editor.getDoc() !== content : false;
  renderTabs();
  void updateTitle();
  addRecent(path);
  saveSession();
  if (isNew) {
    if (!explorer.rootPath) await openFolder(dirname(path));
    else await explorer.refresh();
    explorer.setActive(active?.path ?? null);
    if (d === active) void renderNow(); // 상대 경로 이미지 기준 폴더가 생겼으므로 다시 렌더
  }
  return true;
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  if (settings.autoSave !== 'delay' || !active?.path) return;
  const d = active;
  autoSaveTimer = window.setTimeout(() => {
    if (d.dirty && d.path) void save(d);
  }, settings.autoSaveDelay);
}

async function saveAllForBlur() {
  if (settings.autoSave !== 'blur') return;
  for (const d of docs) if (d.dirty && d.path) await save(d);
}

/** 다른 프로그램에서 파일이 바뀌었는지 확인 */
async function checkExternalChange(d: Doc) {
  if (!isTauri || !d.path) return;
  let mtime: number;
  try {
    mtime = await fileMtime(d.path);
  } catch {
    return; // 삭제되었거나 접근 불가 — 편집 중인 내용은 유지
  }
  if (mtime === d.mtime) return;
  d.mtime = mtime;
  if (d.dirty) {
    const reload = await askYesNo(
      `"${docName(d)}" 파일이 다른 곳에서 변경되었습니다.\n다시 불러올까요? (편집 중인 내용은 사라집니다)`,
      '파일 변경됨',
      '다시 불러오기',
      '유지',
    );
    if (!reload) return;
  }
  const data = await readTextFile(d.path);
  if (data.content === (d === active ? editor.getDoc() : d.state.doc.toString())) {
    d.mtime = data.mtime;
    return; // 자동 저장 등 내 변경
  }
  d.mtime = data.mtime;
  d.saved = data.content;
  d.dirty = false;
  if (d === active) {
    const line = editor.topLine();
    d.state = editor.newState(data.content);
    editor.setState(d.state);
    editor.scrollToLineFrac(line);
    void renderNow();
  } else {
    d.state = editor.newState(data.content);
  }
  renderTabs();
  void updateTitle();
}

/* ================================================================== */
/* 이미지 붙여넣기 / 끌어다 놓기                                         */
/* ================================================================== */

const pad2 = (n: number) => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function mdLink(rel: string, alt = '') {
  return /[\s()<>]/.test(rel) ? `![${alt}](<${rel}>)` : `![${alt}](${rel})`;
}

async function ensureSavedForImages(): Promise<Doc | null> {
  if (!active) return null;
  if (active.path) return active;
  toast('이미지를 넣으려면 먼저 문서를 저장해야 합니다');
  return (await save(active)) ? active : null;
}

async function pasteImage(file: File): Promise<string | null> {
  if (!isTauri) {
    toast('앱에서만 지원됩니다');
    return null;
  }
  const d = await ensureSavedForImages();
  if (!d?.path) return null;
  const ext = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const stem = basename(d.path).replace(/\.[^.]+$/, '').replace(/\s+/g, '-');
  const folder = settings.imageFolder.trim() || 'images';
  const rel = `${folder}/${stem}-${stamp()}.${ext}`;
  const abs = resolvePath(dirname(d.path), rel);
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  try {
    await writeBinaryFile(abs, btoa(bin));
  } catch (e) {
    await showError(`이미지를 저장하지 못했습니다.\n${e}`);
    return null;
  }
  toast(`${rel} 저장됨`);
  return mdLink(rel) + '\n';
}

async function dropImages(paths: string[], x: number, y: number) {
  const d = await ensureSavedForImages();
  if (!d?.path) return;
  const dir = dirname(d.path);
  const folder = settings.imageFolder.trim() || 'images';
  const lines: string[] = [];
  for (const p of paths) {
    let rel: string;
    if (isUnder(p, dir)) rel = relativePath(dir, p);
    else {
      const name = basename(p).replace(/\s+/g, '-');
      rel = `${folder}/${name}`;
      try {
        await copyFile(p, resolvePath(dir, rel));
      } catch (e) {
        await showError(`이미지를 복사하지 못했습니다.\n${e}`);
        continue;
      }
    }
    lines.push(mdLink(rel));
  }
  if (!lines.length) return;
  const pos = editorVisible ? editor.view.posAtCoords({ x, y }) : null;
  editor.insertAt(pos, lines.join('\n\n') + '\n');
}

/* ================================================================== */
/* 레이아웃                                                             */
/* ================================================================== */

const main = $('#main');

function applyLayout() {
  main.classList.toggle('no-sidebar', !sidebarVisible);
  main.classList.toggle('no-editor', !editorVisible);
  store.set('sidebarVisible', String(sidebarVisible));
  store.set('editorVisible', String(editorVisible));
}

function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  applyLayout();
}

function setEditorVisible(v: boolean) {
  if (v === editorVisible) return;
  const line = preview.topLine();
  editorVisible = v;
  applyLayout();
  preview.invalidateLayout();
  if (v) {
    requestAnimationFrame(() => {
      editor.view.requestMeasure();
      editor.scrollToLineFrac(line);
    });
  }
}

function showSidePanel(name: string) {
  if (!sidebarVisible) toggleSidebar();
  for (const b of Array.from(document.querySelectorAll<HTMLElement>('.side-tabs button'))) {
    b.classList.toggle('on', b.dataset.panel === name);
  }
  for (const p of Array.from(document.querySelectorAll<HTMLElement>('.side-panel'))) {
    p.hidden = p.dataset.panel !== name;
  }
  store.set('sidePanel', name);
}

function setupSidebar() {
  for (const b of Array.from(document.querySelectorAll<HTMLElement>('.side-tabs button'))) {
    b.addEventListener('click', () => showSidePanel(b.dataset.panel!));
  }
  showSidePanel(store.get('sidePanel') ?? 'files');
  if (!sidebarVisible) applyLayout();
}

function renderRecent() {
  const box = $('.recent-list');
  box.replaceChildren();
  const list = store.getJSON<string[]>('recent', []);
  if (!list.length) {
    box.innerHTML = '<div class="outline-empty">최근 연 파일이 없습니다</div>';
    return;
  }
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'recent-item';
    row.innerHTML = '<span class="recent-name"></span><span class="recent-dir"></span>';
    row.querySelector('.recent-name')!.textContent = basename(p);
    row.querySelector('.recent-dir')!.textContent = dirname(p);
    row.title = p;
    row.addEventListener('click', () => void openFile(p));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        {
          label: '목록에서 제거',
          action: () => {
            store.setJSON('recent', store.getJSON<string[]>('recent', []).filter((x) => x !== p));
            renderRecent();
          },
        },
        {
          label: '목록 비우기',
          danger: true,
          action: () => {
            store.setJSON('recent', []);
            renderRecent();
          },
        },
      ]);
    });
    box.appendChild(row);
  }
}

function setupGutters() {
  const sideW = Number(store.get('sideWidth')) || 250;
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
        preview.invalidateLayout();
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
      const panes = $('#panes').getBoundingClientRect();
      const r = Math.min(0.8, Math.max(0.2, (x - panes.left) / panes.width));
      main.style.setProperty('--ratio', r.toFixed(4));
    },
    () => store.set('editorRatio', main.style.getPropertyValue('--ratio')),
  );
}

/* ================================================================== */
/* 미리보기: 링크, 이미지 확대, 더블클릭 → 편집기                         */
/* ================================================================== */

function setupPreviewInteractions() {
  const lightbox = $('#lightbox');
  const lbImg = lightbox.querySelector('img')!;
  const closeLightbox = () => (lightbox.hidden = true);
  lightbox.addEventListener('click', closeLightbox);

  preview.body.addEventListener('dblclick', (e) => {
    const line = preview.lineOf(e.target as Element);
    if (line === null) return;
    setEditorVisible(true);
    requestAnimationFrame(() => {
      scrollOwner = 'editor';
      editor.revealLine(line);
    });
  });

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
      scrollOwner = 'preview';
      el?.scrollIntoView({ block: 'center' });
      el?.classList.add('flash');
      setTimeout(() => el?.classList.remove('flash'), 1200);
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
    const base = docDir(active);
    if (!base || !isTauri) return;
    let rel = href.split('#')[0];
    try {
      rel = decodeURIComponent(rel);
    } catch {
      /* 그대로 */
    }
    const abs = resolvePath(base, rel);
    if (isMarkdownPath(abs)) {
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

/* ================================================================== */
/* 명령 · 단축키                                                        */
/* ================================================================== */

function openFind() {
  const sel = window.getSelection()?.toString().trim();
  findBar.open(sel && sel.length < 80 && !sel.includes('\n') ? sel : undefined);
}

function showExportMenu() {
  const r = $('#btn-export').getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, [
    {
      label: 'HTML로 내보내기…',
      action: () =>
        void exportHtml(preview.body, {
          title: String(preview.front?.title ?? (active ? docName(active).replace(/\.[^.]+$/, '') : 'document')),
          docPath: active?.path ?? null,
        }),
    },
    { label: '인쇄 / PDF로 저장… (⌘/Ctrl+P)', action: () => void printDocument() },
  ]);
}

async function requestReload() {
  for (const d of docs) {
    if (d.dirty && d.path) await save(d);
  }
  location.reload();
}

function setupCommands() {
  $('#btn-sidebar').addEventListener('click', toggleSidebar);
  $('#btn-editor').addEventListener('click', () => setEditorVisible(!editorVisible));
  $('#btn-open').addEventListener('click', () => void pickFolder());
  $('#btn-open-2').addEventListener('click', () => void pickFolder());
  $('#btn-new').addEventListener('click', () => void newDocument());
  $('#btn-save').addEventListener('click', () => void save());
  $('#btn-refresh').addEventListener('click', () => void explorer.refresh());
  $('#btn-find').addEventListener('click', openFind);
  $('#btn-export').addEventListener('click', showExportMenu);
  $('#btn-settings').addEventListener('click', () => void openSettings({ requestReload: () => void requestReload() }));

  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const target = e.target as HTMLElement;
    const inField = target.closest('input, textarea, select, .modal') !== null;

    // 탭 전환: Ctrl+Tab / Ctrl+Shift+Tab
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      if (!active || docs.length < 2) return;
      const i = docs.indexOf(active);
      activate(docs[(i + (e.shiftKey ? -1 : 1) + docs.length) % docs.length]);
      return;
    }
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    const run = (fn: () => unknown) => {
      e.preventDefault();
      fn();
    };
    if (k === 's') return run(() => void save());
    if (inField) return;
    if (k === 'o') run(() => void pickFolder());
    else if (k === 'n') run(() => void newDocument());
    else if (k === 'b') run(toggleSidebar);
    else if (k === 'e') run(() => setEditorVisible(!editorVisible));
    else if (k === 'w') run(() => active && void closeDoc(active));
    else if (k === 'p') run(() => void printDocument());
    else if (k === ',') run(() => void openSettings({ requestReload: () => void requestReload() }));
    else if (k === 'f' && e.shiftKey) run(() => showSidePanel('outline'));
    else if (k === 'f' && !editor.hasFocus()) run(openFind);
    else if (/^[1-9]$/.test(k)) run(() => docs[Number(k) - 1] && activate(docs[Number(k) - 1]));
  });

  window.addEventListener('focus', () => {
    void explorer.refresh();
    for (const d of docs) void checkExternalChange(d);
  });
  window.addEventListener('blur', () => void saveAllForBlur());
}

/* ================================================================== */
/* Tauri 이벤트                                                         */
/* ================================================================== */

async function setupTauriEvents() {
  if (!isTauri) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  const { listen } = await import('@tauri-apps/api/event');

  // 창 닫기 전에 저장 확인
  await getCurrentWindow().onCloseRequested(async (ev) => {
    stashActive();
    for (const d of docs) {
      if (!d.dirty) continue;
      activate(d);
      const r = await askSave(docName(d));
      if (r === 'cancel') return ev.preventDefault();
      if (r === 'save' && !(await save(d))) return ev.preventDefault();
    }
  });

  // 폴더 / 파일 / 이미지 끌어다 놓기
  await getCurrentWebview().onDragDropEvent(async (ev) => {
    if (ev.payload.type !== 'drop') return;
    const paths = ev.payload.paths;
    if (!paths.length) return;
    const images = paths.filter(isImagePath);
    if (images.length) {
      const scale = window.devicePixelRatio || 1;
      await dropImages(images, ev.payload.position.x / scale, ev.payload.position.y / scale);
      return;
    }
    for (const p of paths) {
      const kind = await pathKind(p);
      if (kind === 'dir') await openFolder(p);
      else if (kind === 'file' && (isMarkdownPath(p) || extOf(p) === 'bib')) await openFile(p);
    }
  });

  // macOS: 앱이 실행 중일 때 Finder에서 .md 더블클릭
  await listen<string>('open-file', async (ev) => {
    await takePendingFile();
    await openFile(ev.payload);
  });

  // 탐색기 폴더 감시
  let fsTimer: number | undefined;
  const changed = new Set<string>();
  await listen<string[]>('fs-change', (ev) => {
    for (const p of ev.payload) changed.add(p);
    clearTimeout(fsTimer);
    fsTimer = window.setTimeout(() => {
      const list = [...changed];
      changed.clear();
      void explorer.refresh();
      let bibChanged = false;
      for (const p of list) {
        if (extOf(p) === 'bib') {
          preview.invalidateBib(p);
          bibChanged = true;
        }
      }
      for (const d of docs) {
        if (d.path && list.some((p) => samePath(p, d.path!))) void checkExternalChange(d);
      }
      if (bibChanged) void renderNow();
    }, 250);
  });
}

/* ================================================================== */
/* 시작                                                                 */
/* ================================================================== */

async function start() {
  applyLayout();
  setupGutters();
  setupSidebar();
  setupPreviewInteractions();
  setupCommands();
  renderRecent();
  void loadMathJax();

  if (!isTauri) {
    document.body.classList.add('browser-mode');
    activate(addDoc(null, welcome, 0, '환영합니다'));
    return;
  }
  await setupTauriEvents();

  const pending = await takePendingFile();
  const lastRoot = store.get('lastRoot');
  const session = store.getJSON<{ paths: string[]; active: string | null }>('session', { paths: [], active: null });

  if (lastRoot && (await pathKind(lastRoot)) === 'dir') await openFolder(lastRoot);

  for (const p of session.paths) {
    if ((await pathKind(p)) !== 'file') continue;
    try {
      const data = await readTextFile(p);
      docs.push({
        id: nextId++,
        path: p,
        title: '',
        state: editor.newState(data.content),
        saved: data.content,
        mtime: data.mtime,
        dirty: false,
        editorLine: 0,
        previewTop: 0,
      });
    } catch {
      /* 건너뜀 */
    }
  }

  if (pending && (await pathKind(pending)) === 'file') {
    const root = explorer.rootPath;
    if (!root || !isUnder(pending, root)) await openFolder(dirname(pending));
    if (!docs.length) activate(addDoc(null, '', 0));
    await openFile(pending);
  } else if (docs.length) {
    activate(docs.find((d) => session.active && d.path === session.active) ?? docs[0]);
  } else {
    activate(addDoc(null, welcome, 0, '환영합니다'));
  }

  setTimeout(() => void checkForUpdates(false), 3000);
}

void start();

