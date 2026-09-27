import {
  listDir,
  basename,
  dirname,
  joinPath,
  createFile,
  createDir,
  renamePath,
  trashPath,
  type Entry,
} from './fs';
import { showMenu, showError, askYesNo } from './ui';
import { store } from './settings';

const ICON_DIR = `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M6 4l4 4-4 4z"/></svg>`;
const ICON_FILE = `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M4 1.5h5l3 3v10H4z M9 1.5v3h3"/></svg>`;

export interface ExplorerCallbacks {
  openFile: (path: string) => void;
  /** 파일/폴더 이름이 바뀜 (열린 탭 경로 갱신용) */
  renamed: (from: string, to: string) => void;
  /** 휴지통으로 이동됨 */
  removed: (path: string) => void;
}

/** VS Code 스타일 폴더 트리 (펼칠 때 하위 항목을 불러옴) */
export class Explorer {
  private root: string | null = null;
  private expanded = new Set<string>();
  private active: string | null = null;
  private tree: HTMLElement;
  private title: HTMLElement;
  private refreshing: Promise<void> | null = null;

  constructor(
    container: HTMLElement,
    private cb: ExplorerCallbacks,
  ) {
    this.title = container.querySelector('.explorer-title')!;
    this.tree = container.querySelector('.explorer-tree')!;
    // 빈 곳 우클릭 → 루트에 새 파일/폴더
    this.tree.addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('.node') || !this.root) return;
      e.preventDefault();
      this.showMenuFor(e.clientX, e.clientY, this.root, true);
    });
  }

  get rootPath() {
    return this.root;
  }

  async setRoot(path: string) {
    if (this.root !== path) {
      this.root = path;
      this.expanded = new Set(store.getJSON<string[]>('expanded:' + path, []));
    }
    this.title.textContent = basename(path);
    this.title.title = path;
    await this.refresh();
  }

  setActive(path: string | null) {
    this.active = path;
    for (const el of Array.from(this.tree.querySelectorAll<HTMLElement>('.node.file'))) {
      el.classList.toggle('active', el.dataset.path === path);
    }
  }

  /** 트리 다시 그림. 동시에 여러 번 불리면 한 번으로 합침 */
  refresh(): Promise<void> {
    if (!this.root) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const scroll = this.tree.scrollTop;
      const ul = await this.buildList(this.root!, 0);
      this.tree.replaceChildren(ul);
      this.tree.scrollTop = scroll;
    })().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private saveExpanded() {
    if (this.root) store.setJSON('expanded:' + this.root, [...this.expanded]);
  }

  private async buildList(dir: string, depth: number): Promise<HTMLElement> {
    const ul = document.createElement('ul');
    let entries: Entry[] = [];
    try {
      entries = await listDir(dir);
    } catch (e) {
      const li = document.createElement('li');
      li.className = 'node error';
      li.textContent = String(e);
      ul.appendChild(li);
      return ul;
    }
    for (const e of entries) ul.appendChild(await this.buildItem(e, depth));
    if (!entries.length && depth === 0) {
      const li = document.createElement('li');
      li.className = 'node empty';
      li.textContent = '마크다운 파일이 없습니다 (우클릭 → 새 파일)';
      ul.appendChild(li);
    }
    return ul;
  }

  private async buildItem(e: Entry, depth: number): Promise<HTMLElement> {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = `node ${e.is_dir ? 'dir' : 'file'}`;
    row.dataset.path = e.path;
    row.dataset.depth = String(depth);
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.innerHTML = `<span class="icon">${e.is_dir ? ICON_DIR : ICON_FILE}</span><span class="label"></span>`;
    row.querySelector('.label')!.textContent = e.name;
    row.title = e.path;
    li.appendChild(row);

    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.showMenuFor(ev.clientX, ev.clientY, e.path, e.is_dir);
    });

    if (e.is_dir) {
      const open = this.expanded.has(e.path);
      row.classList.toggle('open', open);
      if (open) li.appendChild(await this.buildList(e.path, depth + 1));
      row.addEventListener('click', async () => {
        if (row.querySelector('input')) return;
        if (this.expanded.has(e.path)) {
          this.expanded.delete(e.path);
          row.classList.remove('open');
          li.querySelector('ul')?.remove();
        } else {
          this.expanded.add(e.path);
          row.classList.add('open');
          li.appendChild(await this.buildList(e.path, depth + 1));
        }
        this.saveExpanded();
      });
    } else {
      if (e.path === this.active) row.classList.add('active');
      row.addEventListener('click', () => {
        if (!row.querySelector('input')) this.cb.openFile(e.path);
      });
    }
    return li;
  }

  /* ---------------- 우클릭 메뉴 ---------------- */

  private async showMenuFor(x: number, y: number, path: string, isDir: boolean) {
    const dir = isDir ? path : dirname(path);
    const isRoot = path === this.root;
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    const reveal = navigator.platform.toLowerCase().includes('mac') ? 'Finder에서 보기' : '탐색기에서 보기';
    showMenu(x, y, [
      { label: '새 파일', action: () => void this.promptNew(dir, 'file') },
      { label: '새 폴더', action: () => void this.promptNew(dir, 'dir') },
      { separator: true, label: '' },
      { label: '이름 바꾸기', disabled: isRoot, action: () => void this.promptRename(path) },
      { label: reveal, action: () => void revealItemInDir(path).catch(() => {}) },
      { separator: true, label: '' },
      { label: '휴지통으로 이동', danger: true, disabled: isRoot, action: () => void this.remove(path, isDir) },
    ]);
  }

  /** 트리 안에 입력칸을 띄워 이름을 받음 */
  private inlineInput(anchor: HTMLElement, mode: 'after' | 'prepend', initial: string, depth: number, selectStem: boolean): Promise<string | null> {
    return new Promise((resolve) => {
      const row = document.createElement('div');
      row.className = 'node editing';
      row.style.paddingLeft = `${8 + depth * 14 + 18}px`;
      const input = document.createElement('input');
      input.value = initial;
      input.spellcheck = false;
      row.appendChild(input);
      if (mode === 'after') anchor.after(row);
      else anchor.prepend(row);
      input.focus();
      const dot = initial.lastIndexOf('.');
      input.setSelectionRange(0, selectStem && dot > 0 ? dot : initial.length);
      let done = false;
      const finish = (v: string | null) => {
        if (done) return;
        done = true;
        row.remove();
        resolve(v && v.trim() ? v.trim() : null);
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(input.value);
        else if (e.key === 'Escape') finish(null);
      });
      input.addEventListener('blur', () => finish(input.value));
    });
  }

  private rowFor(path: string): HTMLElement | null {
    return this.tree.querySelector<HTMLElement>(`.node[data-path="${CSS.escape(path)}"]`);
  }

  private async promptNew(dir: string, kind: 'file' | 'dir') {
    // 대상 폴더 펼치기
    let container: HTMLElement = this.tree;
    let mode: 'after' | 'prepend' = 'prepend';
    let depth = 0;
    if (dir !== this.root) {
      if (!this.expanded.has(dir)) {
        this.expanded.add(dir);
        this.saveExpanded();
        await this.refresh();
      }
      const row = this.rowFor(dir);
      if (row) {
        container = row;
        mode = 'after';
        depth = Number(row.dataset.depth ?? 0) + 1;
      }
    }
    const name = await this.inlineInput(container, mode, kind === 'file' ? '새 문서.md' : '새 폴더', depth, true);
    if (!name) return;
    const finalName = kind === 'file' && !/\.[^.]+$/.test(name) ? name + '.md' : name;
    const target = joinPath(dir, finalName);
    try {
      if (kind === 'file') await createFile(target);
      else await createDir(target);
    } catch (e) {
      await showError(String(e));
      return;
    }
    await this.refresh();
    if (kind === 'file') this.cb.openFile(target);
  }

  private async promptRename(path: string) {
    const row = this.rowFor(path);
    if (!row) return;
    const depth = Number(row.dataset.depth ?? 0);
    row.style.display = 'none';
    const name = await this.inlineInput(row, 'after', basename(path), depth - 18 / 14, true);
    row.style.display = '';
    if (!name || name === basename(path)) return;
    const target = joinPath(dirname(path), name);
    try {
      await renamePath(path, target);
    } catch (e) {
      await showError(String(e));
      return;
    }
    if (this.expanded.has(path)) {
      this.expanded.delete(path);
      this.expanded.add(target);
      this.saveExpanded();
    }
    this.cb.renamed(path, target);
    await this.refresh();
  }

  private async remove(path: string, isDir: boolean) {
    const ok = await askYesNo(
      `"${basename(path)}"${isDir ? ' 폴더와 그 안의 파일을' : '을(를)'} 휴지통으로 옮길까요?`,
      '휴지통으로 이동',
      '이동',
    );
    if (!ok) return;
    try {
      await trashPath(path);
    } catch (e) {
      await showError(String(e));
      return;
    }
    this.cb.removed(path);
    await this.refresh();
  }
}
