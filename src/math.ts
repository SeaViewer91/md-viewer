// MathJax 4 (SVG 출력) — public/vendor에 복사된 파일을 로컬에서 불러와 오프라인으로 동작

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    MathJax: any;
  }
}

/** 자주 쓰는 매크로. 필요하면 여기에 추가하세요. */
export const MACROS: Record<string, string | [string, number]> = {
  R: '\\mathbb{R}',
  N: '\\mathbb{N}',
  Z: '\\mathbb{Z}',
  E: '\\mathbb{E}',
  argmin: '\\operatorname*{arg\\,min}',
  argmax: '\\operatorname*{arg\\,max}',
  norm: ['\\left\\lVert #1 \\right\\rVert', 1],
  abs: ['\\left\\lvert #1 \\right\\rvert', 1],
  T: '^{\\mathsf{T}}',
};

let readyPromise: Promise<void> | null = null;

export function loadMathJax(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise<void>((resolve, reject) => {
    window.MathJax = {
      loader: {
        paths: { mathjax: '/vendor/mathjax', fonts: '/vendor/@mathjax' },
        // 메뉴·접근성(음성) 모듈 없이 필요한 것만 불러옴
        load: ['input/tex', 'output/svg', '[tex]/mathtools'],
      },
      tex: {
        inlineMath: [['\\(', '\\)']],
        displayMath: [['\\[', '\\]']],
        processEscapes: false,
        processEnvironments: true,
        tags: 'ams',
        macros: MACROS,
        packages: { '[+]': ['mathtools'] },
      },
      svg: { fontCache: 'local' },
      options: {
        ignoreHtmlClass: 'mj-ignore',
        processHtmlClass: 'mj-process',
      },
      startup: {
        typeset: false,
        ready() {
          window.MathJax.startup.defaultReady();
          window.MathJax.startup.promise.then(() => resolve());
        },
      },
    };
    const s = document.createElement('script');
    s.src = '/vendor/mathjax/startup.js';
    s.async = true;
    s.onerror = () => reject(new Error('MathJax 로드 실패'));
    document.head.appendChild(s);
  });
  return readyPromise;
}

let queue: Promise<void> = Promise.resolve();

/** 요소 안의 수식을 조판. 호출은 순서대로 직렬 처리된다. */
export function typeset(el: HTMLElement): Promise<void> {
  queue = queue
    .then(() => loadMathJax())
    .then(async () => {
      const MJ = window.MathJax;
      MJ.texReset();
      MJ.typesetClear();
      await MJ.typesetPromise([el]);
    })
    .catch((e) => console.error('[math]', e));
  return queue;
}
