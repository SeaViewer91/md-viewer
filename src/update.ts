// 새 버전 알림: GitHub Releases의 최신 버전과 비교해 배너 표시
import { isTauri } from './fs';
import { settings, store } from './settings';

export const REPO = 'SeaViewer91/md-viewer';

function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

export async function currentVersion(): Promise<string> {
  if (!isTauri) return __APP_VERSION__;
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

/**
 * manual=true: 설정 화면의 "지금 확인" — 결과를 문자열로 돌려줌
 * manual=false: 시작 시 하루 한 번, 새 버전이 있을 때만 배너
 */
export async function checkForUpdates(manual = false): Promise<string> {
  if (!manual) {
    if (!settings.checkUpdates) return '';
    const last = Number(store.get('updateCheckedAt') ?? 0);
    if (Date.now() - last < 24 * 3600 * 1000) return '';
  }
  store.set('updateCheckedAt', String(Date.now()));
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return manual ? `확인 실패 (HTTP ${res.status})` : '';
    const rel = (await res.json()) as { tag_name: string; html_url: string };
    const cur = await currentVersion();
    if (!newer(rel.tag_name, cur)) return manual ? `최신 버전입니다 (v${cur})` : '';
    if (store.get('updateDismissed') === rel.tag_name && !manual) return '';
    showBanner(rel.tag_name, rel.html_url);
    return `새 버전 ${rel.tag_name}이 있습니다`;
  } catch (e) {
    return manual ? `확인 실패: ${e}` : '';
  }
}

function showBanner(tag: string, url: string) {
  document.getElementById('update-banner')?.remove();
  const bar = document.createElement('div');
  bar.id = 'update-banner';
  bar.innerHTML = `<span>새 버전 <b></b>이 나왔습니다.</span>
    <button class="primary">다운로드 페이지 열기</button>
    <button class="later">나중에</button>`;
  bar.querySelector('b')!.textContent = tag;
  bar.querySelector('.primary')!.addEventListener('click', async () => {
    if (isTauri) {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    } else window.open(url, '_blank');
  });
  bar.querySelector('.later')!.addEventListener('click', () => {
    store.set('updateDismissed', tag);
    bar.remove();
  });
  document.getElementById('app')!.prepend(bar);
}
