# MD Viewer

논문과 개발 문서를 읽고 쓰기 위한 마크다운 에디터 겸 뷰어다. Tauri 2와 TypeScript로 만들었다.

- 화면은 3분할이다. 왼쪽은 탐색기, 가운데는 편집기(CodeMirror 6), 오른쪽은 실시간 미리보기다.
- 수식은 MathJax 4로 조판하며 오프라인에서 동작한다. `$…$`, `\(…\)`, `$$…$$`, `\[…\]`, `\begin{align}…\end{align}`를 인식한다. 수식 번호와 `\label`/`\eqref` 참조를 지원한다.
- 넓은 표는 가로로 스크롤된다. 이미지는 문서 기준 상대 경로로 불러오고, alt 텍스트를 캡션으로 쓴다. 클릭하면 확대된다.
- 코드 하이라이트, 각주, 체크박스를 지원한다. 테마는 시스템 설정(라이트/다크)을 따른다.

## 개발 실행

```bash
npm install          # 최초 1회. MathJax를 public/vendor로 복사한다
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

Windows 설치 파일은 Windows에서 직접 빌드하거나 GitHub Actions로 만든다. `v0.1.0` 형식의 태그를 push하면 `.github/workflows/build.yml`이 Mac·Windows 설치 파일을 빌드해 Releases에 초안으로 올린다.

```bash
git tag v0.1.0
git push origin v0.1.0
```

### 서명 없는 앱의 첫 실행

- Mac: 응용 프로그램 폴더로 옮긴 뒤 우클릭 → 열기. 또는 `xattr -cr "/Applications/MD Viewer.app"`를 실행한다.
- Windows: SmartScreen 창에서 "추가 정보" → "실행"을 누른다.

## 단축키

Mac은 ⌘, Windows는 Ctrl을 쓴다.

| 키 | 기능 |
|---|---|
| ⌘O | 폴더 열기 |
| ⌘N | 새 문서 |
| ⌘S | 저장 |
| ⌘B | 탐색기 표시 전환 |
| ⌘E | 편집기 표시 전환 (읽기 모드) |
| ⌘F | 편집기 내 찾기·바꾸기 |

## 수식 매크로

`src/math.ts`의 `MACROS`에서 관리한다. 기본 매크로는 `\R \N \Z \E \argmin \argmax \norm{} \abs{} \T`다.

## 구조

```
src/
  main.ts          앱 조립, 파일 열기·저장, 레이아웃, 단축키
  editor.ts        CodeMirror 편집기
  editor-math.ts   편집기 내 수식 구간 강조
  markdown.ts      markdown-it 설정 (수식 파싱, 표, 앵커, 체크박스, 줄 번호)
  math.ts          MathJax 설정·조판
  preview.ts       미리보기 렌더링, 이미지 처리, 스크롤 동기화
  explorer.ts      폴더 트리
  fs.ts            Rust 명령 호출, 경로 처리
src-tauri/src/lib.rs   파일 읽기·쓰기, 폴더 목록, 파일 연결 처리
```
