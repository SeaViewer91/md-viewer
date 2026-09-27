// 사용자 설정 (localStorage에 저장)

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemeMode;
  previewFontSize: number;
  previewWidth: number;
  editorFontSize: number;
  autoSave: 'off' | 'delay' | 'blur';
  autoSaveDelay: number;
  numberFigures: boolean;
  labelLang: 'ko' | 'en';
  citationStyle: 'author-year' | 'numeric';
  imageFolder: string;
  macros: string;
  checkUpdates: boolean;
}

export const DEFAULT_MACROS = String.raw`\R = \mathbb{R}
\N = \mathbb{N}
\Z = \mathbb{Z}
\E = \mathbb{E}
\argmin = \operatorname*{arg\,min}
\argmax = \operatorname*{arg\,max}
\norm[1] = \left\lVert #1 \right\rVert
\abs[1] = \left\lvert #1 \right\rvert
\T = ^{\mathsf{T}}`;

export const DEFAULTS: Settings = {
  theme: 'system',
  previewFontSize: 16,
  previewWidth: 880,
  editorFontSize: 14,
  autoSave: 'off',
  autoSaveDelay: 1500,
  numberFigures: true,
  labelLang: 'ko',
  citationStyle: 'author-year',
  imageFolder: 'images',
  macros: DEFAULT_MACROS,
  checkUpdates: true,
};

const KEY = 'settings';
type Listener = (s: Settings, changed: (keyof Settings)[]) => void;
const listeners: Listener[] = [];

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* 기본값 사용 */
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();

export function updateSettings(patch: Partial<Settings>) {
  const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => patch[k] !== settings[k]);
  if (!changed.length) return;
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* 무시 */
  }
  for (const l of listeners) l(settings, changed);
}

export function onSettingsChange(l: Listener) {
  listeners.push(l);
}

/** "\name = 정의" / "\name[2] = 정의 #1 #2" 형식의 매크로 목록을 MathJax 형식으로 */
export function parseMacros(text: string): Record<string, string | [string, number]> {
  const out: Record<string, string | [string, number]> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%')) continue;
    const m = /^\\([A-Za-z]+)(?:\[(\d)\])?\s*=\s*(.+)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2] ? [m[3], Number(m[2])] : m[3];
  }
  return out;
}

/* ---------------- 테마 ---------------- */

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function isDark(): boolean {
  return settings.theme === 'dark' || (settings.theme === 'system' && darkQuery.matches);
}

export function applyTheme() {
  const dark = isDark();
  const root = document.documentElement;
  if (root.classList.contains('dark') === dark && root.dataset.themeApplied) return;
  root.classList.toggle('dark', dark);
  root.dataset.themeApplied = '1';
  window.dispatchEvent(new CustomEvent('themechange', { detail: { dark } }));
}

export function applyLayoutVars() {
  const s = document.documentElement.style;
  s.setProperty('--preview-font-size', `${settings.previewFontSize}px`);
  s.setProperty('--preview-width', `${settings.previewWidth}px`);
  s.setProperty('--editor-font-size', `${settings.editorFontSize}px`);
}

darkQuery.addEventListener('change', applyTheme);
onSettingsChange((_s, changed) => {
  if (changed.includes('theme')) applyTheme();
  if (changed.some((k) => k === 'previewFontSize' || k === 'previewWidth' || k === 'editorFontSize')) applyLayoutVars();
});

/* ---------------- 공용 저장소 ---------------- */

export const store = {
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
  getJSON<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  setJSON(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 무시 */
    }
  },
};
