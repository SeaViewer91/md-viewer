// 설정 화면
import { settings, updateSettings, DEFAULTS, type Settings } from './settings';
import { openModal, toast } from './ui';
import { checkForUpdates, currentVersion, REPO } from './update';

export async function openSettings(opts: { requestReload: () => void }) {
  const body = document.createElement('form');
  body.className = 'settings-form';
  body.innerHTML = `
    <section>
      <h3>화면</h3>
      <label>테마
        <select name="theme">
          <option value="system">시스템 설정 따름</option>
          <option value="light">밝게</option>
          <option value="dark">어둡게</option>
        </select>
      </label>
      <label>미리보기 글자 크기 <span><input type="number" name="previewFontSize" min="11" max="26" step="1" /> px</span></label>
      <label>미리보기 본문 폭 <span><input type="number" name="previewWidth" min="560" max="1600" step="20" /> px</span></label>
      <label>편집기 글자 크기 <span><input type="number" name="editorFontSize" min="10" max="24" step="1" /> px</span></label>
    </section>
    <section>
      <h3>저장</h3>
      <label>자동 저장
        <select name="autoSave">
          <option value="off">끔</option>
          <option value="delay">입력을 멈추면</option>
          <option value="blur">창을 벗어나면</option>
        </select>
      </label>
      <label>자동 저장 대기 <span><input type="number" name="autoSaveDelay" min="300" max="10000" step="100" /> ms</span></label>
      <label>붙여넣은 이미지 저장 폴더 <input type="text" name="imageFolder" /></label>
    </section>
    <section>
      <h3>논문</h3>
      <label class="check"><input type="checkbox" name="numberFigures" /> 그림·표에 자동 번호 붙이기</label>
      <label>캡션·참조 표기
        <select name="labelLang">
          <option value="ko">한국어 (그림 1, 표 1, 참고문헌)</option>
          <option value="en">영어 (Figure 1, Table 1, References)</option>
        </select>
      </label>
      <label>인용 방식
        <select name="citationStyle">
          <option value="author-year">저자-연도 (Kim et al., 2024)</option>
          <option value="numeric">번호 [1]</option>
        </select>
      </label>
      <label class="block">수식 매크로 <small>한 줄에 하나: <code>\\이름 = 정의</code>, 인자는 <code>\\이름[2] = … #1 #2</code>. 바꾸면 앱이 다시 로드됩니다.</small>
        <textarea name="macros" rows="8" spellcheck="false"></textarea>
      </label>
    </section>
    <section>
      <h3>업데이트</h3>
      <label class="check"><input type="checkbox" name="checkUpdates" /> 시작할 때 새 버전 확인 (하루 한 번)</label>
      <div class="row"><span class="version"></span><button type="button" class="check-now">지금 확인</button><span class="update-result"></span></div>
    </section>
    <div class="actions">
      <button type="button" class="reset">기본값으로</button>
      <span></span>
      <button type="button" class="done primary">닫기</button>
    </div>`;

  const fields = body.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[name]');
  const fill = () => {
    for (const f of Array.from(fields)) {
      const key = f.name as keyof Settings;
      const v = settings[key];
      if (f instanceof HTMLInputElement && f.type === 'checkbox') f.checked = Boolean(v);
      else f.value = String(v);
    }
  };
  fill();

  const read = (f: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): unknown => {
    const def = DEFAULTS[f.name as keyof Settings];
    if (f instanceof HTMLInputElement && f.type === 'checkbox') return f.checked;
    if (typeof def === 'number') {
      const n = Number(f.value);
      return Number.isFinite(n) && n > 0 ? n : def;
    }
    return f.value;
  };

  let macrosChanged = false;
  for (const f of Array.from(fields)) {
    const evt = f instanceof HTMLTextAreaElement || (f instanceof HTMLInputElement && f.type === 'text') ? 'change' : 'input';
    f.addEventListener(evt, () => {
      if (f.name === 'macros') {
        macrosChanged = f.value !== settings.macros;
        updateSettings({ macros: f.value });
        return;
      }
      updateSettings({ [f.name]: read(f) } as Partial<Settings>);
    });
  }

  body.querySelector('.version')!.textContent = `현재 v${await currentVersion()} · github.com/${REPO}`;
  body.querySelector('.check-now')!.addEventListener('click', async () => {
    const out = body.querySelector('.update-result')!;
    out.textContent = '확인 중…';
    out.textContent = await checkForUpdates(true);
  });
  body.querySelector('.reset')!.addEventListener('click', () => {
    const { macros: _m, ...rest } = DEFAULTS;
    updateSettings(rest);
    fill();
    toast('기본값으로 되돌렸습니다 (수식 매크로 제외)');
  });

  const close = openModal('설정', body, () => {
    if (macrosChanged) opts.requestReload();
  });
  body.querySelector('.done')!.addEventListener('click', close);
  body.addEventListener('submit', (e) => e.preventDefault());
}
