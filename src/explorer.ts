import { listDir, basename, type Entry } from './fs';

const ICON_DIR = `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M6 4l4 4-4 4z"/></svg>`;
const ICON_FILE = `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M4 1.5h5l3 3v10H4z M9 1.5v3h3"/></svg>`;

/** VS Code 스타일 폴더 트리 (펼칠 때 하위 항목을 불러옴) */
export class Explorer {
  private root: string | null = null;
  private expanded = new Set<string>();
  private active: string | null = null;
  private tree: HTMLElement;
  private title: HTMLElement;

  constructor(
    container: HTMLElement,
    private onOpenFile: (path: string) => void,
  ) {
    this.title = container.querySelector('.explorer-title')!;
    this.tree = container.querySelector('.explorer-tree')!;
  }

  get rootPath() {
    return this.root;
  }

  async setRoot(path: string) {
    if (this.root !== path) {
      this.root = path;
      this.expanded = new Set(loadExpanded(path));
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

  async refresh() {
    if (!this.root) return;
    const scroll = this.tree.scrollTop;
    const ul = await this.buildList(this.root, 0);
    this.tree.replaceChildren(ul);
    this.tree.scrollTop = scroll;
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
    for (const e of entries) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = `node ${e.is_dir ? 'dir' : 'file'}`;
      row.dataset.path = e.path;
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.innerHTML = `<span class="icon">${e.is_dir ? ICON_DIR : ICON_FILE}</span><span class="label"></span>`;
      row.querySelector('.label')!.textContent = e.name;
      row.title = e.path;
      li.appendChild(row);

      if (e.is_dir) {
        const open = this.expanded.has(e.path);
        row.classList.toggle('open', open);
        if (open) li.appendChild(await this.buildList(e.path, depth + 1));
        row.addEventListener('click', async () => {
          if (this.expanded.has(e.path)) {
            this.expanded.delete(e.path);
            row.classList.remove('open');
            li.querySelector('ul')?.remove();
          } else {
            this.expanded.add(e.path);
            row.classList.add('open');
            li.appendChild(await this.buildList(e.path, depth + 1));
          }
          saveExpanded(this.root!, this.expanded);
        });
      } else {
        if (e.path === this.active) row.classList.add('active');
        row.addEventListener('click', () => this.onOpenFile(e.path));
      }
      ul.appendChild(li);
    }
    if (!entries.length && depth === 0) {
      const li = document.createElement('li');
      li.className = 'node empty';
      li.textContent = '마크다운 파일이 없습니다';
      ul.appendChild(li);
    }
    return ul;
  }
}

function loadExpanded(root: string): string[] {
  try {
    return JSON.parse(localStorage.getItem('expanded:' + root) ?? '[]');
  } catch {
    return [];
  }
}

function saveExpanded(root: string, set: Set<string>) {
  try {
    localStorage.setItem('expanded:' + root, JSON.stringify([...set]));
  } catch {
    /* 무시 */
  }
}
