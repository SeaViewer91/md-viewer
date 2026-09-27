// HTML 내보내기(수식·이미지를 모두 담은 파일 하나) / 인쇄·PDF 저장
import previewCss from './preview.css?raw';
import { isTauri, readBinaryBase64, writeTextFile, printPage, basename, extOf } from './fs';
import { showError, toast } from './ui';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

const LIGHT_VARS = `
:root {
  --fg: #1f2328; --fg-muted: #57606a; --border: #d0d7de; --accent: #0969da;
  --preview-font-size: 16px; --preview-width: 880px;
}
html, body { margin: 0; background: #fff; color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Pretendard', 'Malgun Gothic', 'Segoe UI', sans-serif; }
.markdown-body { padding: 40px 32px 80px; }
`;

export async function exportHtml(article: HTMLElement, opts: { title: string; docPath: string | null }) {
  if (!isTauri) return;
  const clone = article.cloneNode(true) as HTMLElement;
  clone.classList.remove('mj-ignore');
  for (const m of Array.from(clone.querySelectorAll('mark.find-hit'))) m.replaceWith(m.textContent ?? '');

  let failed = 0;
  for (const img of Array.from(clone.querySelectorAll<HTMLImageElement>('img'))) {
    img.removeAttribute('loading');
    const path = img.dataset.path;
    if (!path) continue;
    try {
      const b64 = await readBinaryBase64(path);
      img.src = `data:${MIME[extOf(path)] ?? 'application/octet-stream'};base64,${b64}`;
    } catch {
      failed++;
    }
    img.removeAttribute('data-path');
  }

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(opts.title)}</title>
<style>${LIGHT_VARS}
${previewCss}
</style>
</head>
<body>
${clone.outerHTML}
</body>
</html>
`;

  const { save } = await import('@tauri-apps/plugin-dialog');
  const base = opts.docPath ? opts.docPath.replace(/\.[^.\\/]+$/, '') : opts.title;
  const target = await save({
    title: 'HTML로 내보내기',
    defaultPath: base + '.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!target) return;
  try {
    await writeTextFile(target, html);
    toast(`${basename(target)} 저장됨${failed ? ` (이미지 ${failed}개 누락)` : ''}`);
  } catch (e) {
    await showError(`내보내지 못했습니다.\n${e}`);
  }
}

export async function printDocument() {
  document.body.classList.add('printing');
  try {
    const handled = isTauri ? await printPage().catch(() => false) : false;
    if (!handled) window.print();
  } finally {
    setTimeout(() => document.body.classList.remove('printing'), 1000);
  }
}
