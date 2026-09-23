// Rust 명령 래퍼 + 경로 유틸 (macOS / Windows 공통)
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

export const isTauri = '__TAURI_INTERNALS__' in window;

export interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface FileData {
  content: string;
  mtime: number;
}

export const listDir = (path: string) => invoke<Entry[]>('list_dir', { path });
export const readTextFile = (path: string) => invoke<FileData>('read_text_file', { path });
export const writeTextFile = (path: string, content: string) =>
  invoke<number>('write_text_file', { path, content });
export const fileMtime = (path: string) => invoke<number>('file_mtime', { path });
export const pathKind = (path: string) => invoke<'dir' | 'file' | 'missing'>('path_kind', { path });
export const takePendingFile = () => invoke<string | null>('take_pending_file');

/* ---------------- 경로 ---------------- */

export const isWindowsPath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');

export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const d = i <= 0 ? p.slice(0, i + 1) : p.slice(0, i);
  return /^[A-Za-z]:$/.test(d) ? d + '\\' : d;
}

/** base 폴더 기준으로 rel 경로를 풀어 절대 경로로 (.. / . 처리) */
export function resolvePath(baseDir: string, rel: string): string {
  if (rel.startsWith('/') || isWindowsPath(rel)) return normalize(rel);
  return normalize(baseDir + '/' + rel);
}

function normalize(p: string): string {
  const win = isWindowsPath(p);
  const unc = p.startsWith('\\\\');
  const parts = p.split(/[\\/]+/);
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > (win ? 1 : 0)) out.pop();
      continue;
    }
    out.push(part);
  }
  if (unc) return '\\\\' + out.join('\\');
  if (win) return out.join('\\');
  return '/' + out.join('/');
}

export const isExternalUrl = (s: string) => /^[a-z][a-z0-9+.-]*:/i.test(s) && !isWindowsPath(s);

/** 마크다운 안의 이미지 src를 웹뷰가 읽을 수 있는 URL로 */
export function toImageUrl(src: string, docDir: string | null): string {
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (/^(https?|asset):/i.test(src) || src.startsWith('http://asset.localhost')) return src;
  if (!isTauri) return src;
  let p = src;
  if (p.startsWith('file://')) p = p.replace(/^file:\/\/(localhost)?/, '');
  try {
    p = decodeURI(p);
  } catch {
    /* 그대로 사용 */
  }
  p = p.split(/[?#]/)[0];
  if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1); // file:///C:/...
  if (!docDir && !(p.startsWith('/') || isWindowsPath(p))) return src;
  const abs = resolvePath(docDir ?? '/', p);
  return convertFileSrc(abs);
}
