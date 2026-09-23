# MD Viewer

논문·개발 문서를 읽고 쓰기 위한 마크다운 에디터 겸 뷰어입니다. (Tauri 2 + TypeScript)

- 왼쪽 탐색기 · 가운데 편집기(CodeMirror 6) · 오른쪽 실시간 미리보기
- 수식: MathJax 4 (오프라인). `$…$`, `\(…\)`, `$$…$$`, `\[…\]`, `\begin{align}…\end{align}`, 수식 번호, `\label`/`\eqref`
- 표(넓은 표는 가로 스크롤), 상대 경로 이미지, 그림 캡션(alt), 클릭하면 확대
- 코드 하이라이트, 각주, 체크박스, 라이트/다크 테마(시스템 설정 따라감)

## 개발 실행

```bash
npm install          # 처음 한 번 (MathJax를 public/vendor로 복사함)
npm run tauri dev    # 개발 모드로 앱 실행 (처음엔 Rust 컴파일로 몇 분 걸림)
```

## 설치 파일 만들기

```bash
npm run tauri build
```

결과물: `src-tauri/target/release/bundle/` 아래 `dmg/`(Mac), `nsis/`·`msi/`(Windows)

Intel과 Apple Silicon Mac에서 모두 도는 파일이 필요하면:

```bash
rustup target add x86_64-apple-darwin aarch64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

Windows 설치 파일은 Windows에서 빌드하거나, GitHub에 올린 뒤 `v0.1.0` 같은 태그를 push하면
GitHub Actions가 Mac·Windows 설치 파일을 함께 만들어 Releases에 올립니다.
(처음 한 번 `mkdir -p .github/workflows && cp ci/build.yml .github/workflows/` 로 옮겨 두세요.)

### 서명 안 된 앱 처음 실행

- Mac: 응용 프로그램 폴더로 옮긴 뒤 우클릭 → 열기 (또는 `xattr -cr "/Applications/MD Viewer.app"`)
- Windows: SmartScreen 창에서 "추가 정보" → "실행"

## 단축키 (Mac은 ⌘, Windows는 Ctrl)

| 키 | 기능 |
|---|---|
| ⌘O | 폴더 열기 |
| ⌘N | 새 문서 |
| ⌘S | 저장 |
| ⌘B | 탐색기 보기/숨기기 |
| ⌘E | 편집기 보기/숨기기 (읽기 모드) |
| ⌘F | 편집기 안에서 찾기·바꾸기 |

## 수식 매크로 추가

`src/math.ts`의 `MACROS`에 추가하세요. 기본 제공: `\R \N \Z \E \argmin \argmax \norm{} \abs{} \T`

## 구조

```
src/
  main.ts          앱 조립, 파일 열기/저장, 레이아웃, 단축키
  editor.ts        CodeMirror 편집기
  editor-math.ts   편집기에서 수식 구간 색 표시
  markdown.ts      markdown-it 설정 (수식 파싱, 표, 앵커, 체크박스, 줄 번호)
  math.ts          MathJax 설정·조판
  preview.ts       미리보기 렌더링, 이미지 처리, 스크롤 동기화
  explorer.ts      폴더 트리
  fs.ts            Rust 명령 호출, 경로 처리
src-tauri/src/lib.rs   파일 읽기/쓰기, 폴더 목록, 파일 연결 처리
```
