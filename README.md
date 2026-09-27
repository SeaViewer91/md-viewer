# MD Viewer

논문과 개발 문서를 읽고 쓰기 위한 마크다운 에디터 겸 뷰어. Tauri 2와 TypeScript로 개발.

## 기능

- **화면**: 사이드바(파일·목차·최근) · 편집기(CodeMirror 6) · 실시간 미리보기의 3분할 구성. 여러 문서를 탭으로 연다.
- **수식**: MathJax 4로 조판하며 오프라인에서 동작한다. `$…$`, `\(…\)`, `$$…$$`, `\[…\]`, `\begin{align}…\end{align}`를 인식한다. 수식 번호와 `\label`/`\eqref` 참조를 지원한다. 편집 중에는 바뀐 수식만 다시 조판한다.
- **그림·표 번호**: `![캡션](a.png){#fig:id}`, 표 아래 `Table: 캡션 {#tbl:id}`로 번호를 붙이고 본문에서 `@fig:id`, `@tbl:id`로 참조한다.
- **인용**: front matter에 `bibliography: refs.bib`를 지정하고 `[@key]`, `[@a; @b, p. 3]`으로 인용하면 참고문헌 목록이 붙는다. 저자-연도 방식과 번호 방식을 고를 수 있다.
- **front matter**: `title`, `author`, `date`, `abstract`, `keywords`를 제목 블록으로 표시한다.
- **표**: 넓은 표는 가로로 스크롤된다. 표 안 수식의 `|`도 처리한다. 엑셀에서 복사한 셀은 붙여넣으면 마크다운 표가 된다. `⇧⌥F`로 열 너비를 맞춘다.
- **이미지**: 문서 기준 상대 경로로 불러온다. 캡처 이미지를 붙여넣거나 파일을 끌어다 놓으면 `images/`에 저장하고 링크를 넣는다. 클릭하면 확대된다.
- **그 밖의 표기**: Mermaid 다이어그램, 콜아웃(`> [!NOTE]` 등), 코드 하이라이트, 각주, 체크박스를 지원한다.
- **탐색**: 목차 패널, 미리보기 검색, 미리보기 더블클릭 시 편집기 해당 줄로 이동, 편집기와 미리보기 양방향 스크롤 동기화를 제공한다.
- **파일**: 탐색기에서 새 파일·새 폴더·이름 바꾸기·휴지통 이동을 한다. 폴더 변경을 감시해 목록과 열린 문서를 자동으로 갱신한다. 자동 저장을 켤 수 있다.
- **내보내기**: 수식과 이미지를 모두 담은 HTML 파일 하나로 내보내거나, 인쇄 대화상자에서 PDF로 저장한다.
- **설정**: 테마, 글자 크기, 본문 폭, 자동 저장, 캡션 언어, 인용 방식, 수식 매크로, 새 버전 알림.

## 개발 실행

```bash
npm install          # 최초 1회, 의존성이 바뀐 뒤에도 실행한다. MathJax를 public/vendor로 복사한다
npm run tauri dev    # 개발 모드 실행. 첫 실행은 Rust 컴파일로 수 분 걸린다
```

## 설치 파일 빌드

```bash
npm run tauri build
```

결과물은 `src-tauri/target/release/bundle/`에 생성된다. Mac은 `dmg/`, Windows는 `nsis/`·`msi/`에 있다.

Intel과 Apple Silicon Mac 공용 파일은 다음과 같이 빌드한다.

```bash
rustup target add x86_64-apple-darwin aarch64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

Windows 설치 파일은 Windows에서 직접 빌드하거나 GitHub Actions로 만든다. `v0.2.0` 형식의 태그를 push하면 `.github/workflows/build.yml`이 Mac·Windows 설치 파일을 빌드해 Releases에 초안으로 올린다.

```bash
git tag v0.2.0
git push origin v0.2.0
```

### 서명 없는 앱의 첫 실행

- Mac: 응용 프로그램 폴더로 옮긴 뒤 우클릭 → 열기. 막히면 시스템 설정 → 개인정보 보호 및 보안 → "그래도 열기"를 누르거나 `xattr -cr "/Applications/MD Viewer.app"`를 실행한다.
- Windows: SmartScreen 창에서 "추가 정보" → "실행"을 누른다.

## 단축키

Mac은 ⌘, Windows는 Ctrl을 쓴다.

| 키 | 기능 |
|---|---|
| ⌘O | 폴더 열기 |
| ⌘N | 새 문서 |
| ⌘S | 저장 |
| ⌘W | 탭 닫기 |
| ⌘1–9, Ctrl+Tab | 탭 이동 |
| ⌘B | 사이드바 표시 전환 |
| ⌘E | 편집기 표시 전환 (읽기 모드) |
| ⌘F | 찾기 (편집기 안에서는 찾기·바꾸기, 그 밖에서는 미리보기 검색) |
| ⌘⇧F | 목차 패널 |
| ⌘P | 인쇄 / PDF 저장 |
| ⌘, | 설정 |
| ⇧⌥F | 커서가 있는 표의 열 맞춤 |

## 논문 작성 예시

```markdown
---
title: 위성 영상 기반 해양쓰레기 탐지
author: [박수호, 김연구]
date: 2026-09-25
abstract: 본 연구는 …
bibliography: refs.bib
---

선행 연구[@kim2024; @lee2023, p. 12]를 따른다. 연구 지역은 @fig:site 와 같다.

![연구 지역 위치도](images/site.png){#fig:site}

| 센서 | 해상도 |
|---|--:|
| Sentinel-2 | 10 |

Table: 사용한 센서 {#tbl:sensors}
```

## 구조

```
src/
  main.ts          앱 조립: 탭, 파일 열기·저장, 레이아웃, 단축키, 이미지 붙여넣기
  editor.ts        CodeMirror 편집기 (붙여넣기 처리, 표 정렬)
  editor-math.ts   편집기 내 수식 구간 강조
  markdown.ts      markdown-it 설정 (수식, 인용, 콜아웃, 그림 라벨, front matter, 줄 번호)
  preview.ts       미리보기 렌더링 (부분 조판, 블록 단위 교체, Mermaid, 스크롤 동기화)
  math.ts          MathJax 설정·조판
  crossref.ts      그림·표 번호와 참조
  citations.ts     BibTeX 파싱, 인용·참고문헌 서식
  tables.ts        표 변환·정렬
  explorer.ts      폴더 트리와 파일 조작
  outline.ts       목차 패널
  find.ts          미리보기 검색
  export.ts        HTML 내보내기, 인쇄
  settings.ts      설정·테마
  settings-ui.ts   설정 화면
  update.ts        새 버전 알림
  ui.ts            대화상자·메뉴·알림
src-tauri/src/lib.rs   파일 읽기·쓰기, 폴더 목록·감시, 파일 조작, 인쇄, 파일 연결 처리
```

## 변경 이력

- **0.2.0**: 탭·최근 파일, 목차, 미리보기 검색, 양방향 스크롤, 수식 부분 조판, 그림·표 번호와 참조, BibTeX 인용, front matter, Mermaid, 콜아웃, 표 붙여넣기·정렬, 이미지 붙여넣기·끌어놓기, 탐색기 파일 조작·폴더 감시, 자동 저장, HTML·PDF 내보내기, 설정 화면, 새 버전 알림
- **0.1.0**: 탐색기·편집기·미리보기, MathJax 수식, 표, 상대 경로 이미지
