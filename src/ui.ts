// 대화상자 · 알림 · 컨텍스트 메뉴 공용 도우미
import { isTauri } from './fs';

export async function showError(msg: string) {
  if (isTauri) {
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message(msg, { title: '오류', kind: 'error' });
  } else {
    alert(msg);
  }
}

export async function askYesNo(msg: string, title: string, ok = '확인', cancel = '취소'): Promise<boolean> {
  if (!isTauri) return confirm(msg);
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask(msg, { title, kind: 'warning', okLabel: ok, cancelLabel: cancel });
}

/** 저장 / 저장 안 함 / 취소 */
export async function askSave(name: string): Promise<'save' | 'discard' | 'cancel'> {
  if (!isTauri) return confirm(`"${name}"의 변경 사항을 버릴까요?`) ? 'discard' : 'cancel';
  const { message } = await import('@tauri-apps/plugin-dialog');
  const r = await message(`"${name}"의 변경 사항을 저장할까요?`, {
    title: '저장하지 않은 변경 사항',
    kind: 'warning',
    buttons: { yes: '저장', no: '저장 안 함', cancel: '취소' },
  });
  if (r === '저장' || r === 'Yes') return 'save';
  if (r === '저장 안 함' || r === 'No') return 'discard';
  return 'cancel';
}

/* ---------------- 토스트 ---------------- */

let toastTimer: number | undefined;
export function toast(msg: string, ms = 2200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), ms);
}

/* ---------------- 컨텍스트 메뉴 ---------------- */

export interface MenuItem {
  label: string;
  action?: () => void;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
}

let openMenu: HTMLElement | null = null;

export function closeMenu() {
  openMenu?.remove();
  openMenu = null;
}

export function showMenu(x: number, y: number, items: MenuItem[]) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  for (const it of items) {
    if (it.separator) {
      menu.appendChild(document.createElement('hr'));
      continue;
    }
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.danger) b.classList.add('danger');
    b.disabled = !!it.disabled;
    b.addEventListener('click', () => {
      closeMenu();
      it.action?.();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
  openMenu = menu;
}

document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.contains(e.target as Node)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});
window.addEventListener('blur', closeMenu);

/* ---------------- 모달 ---------------- */

export function openModal(title: string, body: HTMLElement, onClose?: () => void): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const box = document.createElement('div');
  box.className = 'modal';
  const head = document.createElement('div');
  head.className = 'modal-head';
  head.innerHTML = `<span></span><button class="icon-btn" title="닫기">✕</button>`;
  head.querySelector('span')!.textContent = title;
  box.append(head, body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  head.querySelector('button')!.addEventListener('click', close);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });
  return close;
}
