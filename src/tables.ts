// 표 편집 보조: 엑셀/CSV 붙여넣기 → 마크다운 표, 표 열 맞춤

/** 화면 폭 기준 글자 너비 (한글·한자 등 전각은 2) */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff) ||
      (c >= 0x20000 && c <= 0x3fffd);
    w += wide ? 2 : 1;
  }
  return w;
}

const escCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

/** 탭으로 구분된 여러 줄(엑셀 복사) 또는 CSV를 마크다운 표로. 표가 아니면 null */
export function delimitedToMarkdown(text: string): string | null {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length < 2) return null;
  let rows: string[][];
  if (lines.every((l) => l.includes('\t'))) {
    rows = lines.map((l) => l.split('\t'));
  } else {
    return null; // CSV는 쉼표가 본문에 흔해서 자동 변환하지 않음
  }
  const cols = rows[0].length;
  if (cols < 2 || rows.some((r) => r.length !== cols)) return null;
  const numeric = (col: number) =>
    rows.slice(1).every((r) => r[col].trim() === '' || /^[-+]?[\d,]*\.?\d+(e[-+]?\d+)?%?$/i.test(r[col].trim()));
  const align = Array.from({ length: cols }, (_, c) => (numeric(c) ? 'right' : 'left'));
  const out = [
    '| ' + rows[0].map(escCell).join(' | ') + ' |',
    '|' + align.map((a) => (a === 'right' ? '---:' : '---')).join('|') + '|',
    ...rows.slice(1).map((r) => '| ' + r.map(escCell).join(' | ') + ' |'),
  ];
  return formatTableLines(out).join('\n');
}

/** 표 한 줄을 셀로 나눔 ( \| , `코드`, $수식$ 안의 | 는 구분자로 보지 않음) */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  let inMath = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      cur += ch + s[++i];
      continue;
    }
    if (ch === '`') inCode = !inCode;
    else if (ch === '$' && !inCode) inMath = !inMath;
    if (ch === '|' && !inCode && !inMath) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const isDelimiterRow = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, '')));

/** 표 줄들의 열 너비를 맞춰 다시 씀 */
export function formatTableLines(lines: string[]): string[] {
  const rows = lines.map(splitRow);
  const delimIdx = rows.findIndex(isDelimiterRow);
  if (delimIdx !== 1) return lines;
  const cols = Math.max(...rows.map((r) => r.length));
  const aligns = Array.from({ length: cols }, (_, c) => {
    const d = (rows[1][c] ?? '---').replace(/\s/g, '');
    if (d.startsWith(':') && d.endsWith(':')) return 'center';
    if (d.endsWith(':')) return 'right';
    if (d.startsWith(':')) return 'left-explicit';
    return 'left';
  });
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(3, ...rows.map((r, i) => (i === 1 ? 0 : displayWidth(r[c] ?? '')))),
  );
  const pad = (text: string, w: number, a: string) => {
    const gap = w - displayWidth(text);
    if (a === 'right') return ' '.repeat(gap) + text;
    if (a === 'center') return ' '.repeat(Math.floor(gap / 2)) + text + ' '.repeat(Math.ceil(gap / 2));
    return text + ' '.repeat(gap);
  };
  return rows.map((r, i) => {
    if (i === 1) {
      const segs = widths.map((w, c) => {
        const a = aligns[c];
        if (a === 'center') return ':' + '-'.repeat(w) + ':';
        if (a === 'right') return '-'.repeat(w + 1) + ':';
        if (a === 'left-explicit') return ':' + '-'.repeat(w + 1);
        return '-'.repeat(w + 2);
      });
      return '|' + segs.join('|') + '|';
    }
    return '| ' + widths.map((w, c) => pad(r[c] ?? '', w, aligns[c])).join(' | ') + ' |';
  });
}
