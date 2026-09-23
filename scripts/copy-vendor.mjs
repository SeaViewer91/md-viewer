// MathJax와 수식 글꼴을 public/vendor로 복사 (오프라인 동작용)
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'vendor');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const mj = join(nm, 'mathjax');
const mjOut = join(out, 'mathjax');
for (const item of ['startup.js', 'core.js', 'loader.js', 'input', 'output', 'adaptors']) {
  const src = join(mj, item);
  if (existsSync(src)) cpSync(src, join(mjOut, item), { recursive: true });
}

const font = join(nm, '@mathjax', 'mathjax-newcm-font');
const fontOut = join(out, '@mathjax', 'mathjax-newcm-font');
cpSync(join(font, 'svg'), join(fontOut, 'svg'), { recursive: true });
cpSync(join(font, 'svg.js'), join(fontOut, 'svg.js'));

console.log('[copy-vendor] MathJax -> public/vendor');
