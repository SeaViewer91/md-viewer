use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebouncedEvent, Debouncer};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};
use tauri::Emitter;

/// 앱 시작 시 (파일 더블클릭·명령줄 인자로) 전달된 파일 경로
#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

/// 탐색기 루트 폴더 감시기
#[derive(Default)]
struct Watcher(Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>);

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
struct FileData {
    content: String,
    mtime: u64,
}

const TEXT_EXTS: &[&str] = &["md", "markdown", "mdx", "txt", "bib"];
const IGNORED_DIRS: &[&str] = &["node_modules", "__pycache__", "target", "dist"];

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

fn mtime_of(path: &Path) -> Result<u64, String> {
    let meta = fs::metadata(path).map_err(err)?;
    let modified = meta.modified().map_err(err)?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0))
}

fn is_text_doc(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| TEXT_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_ignored(path: &Path) -> bool {
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        (s.starts_with('.') && s.len() > 1 && s != "..") || IGNORED_DIRS.contains(&s.as_ref())
    })
}

/* ---------------- 읽기 / 쓰기 ---------------- */

/// 폴더 내용 (숨김 파일 제외, 폴더 먼저, 마크다운/텍스트 파일만)
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let rd = fs::read_dir(&path).map_err(err)?;
    let mut entries: Vec<Entry> = Vec::new();
    for item in rd.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }
        let p = item.path();
        let is_dir = p.is_dir();
        if !is_dir && !is_text_doc(&p) {
            continue;
        }
        entries.push(Entry {
            name,
            path: p.to_string_lossy().to_string(),
            is_dir,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<FileData, String> {
    let bytes = fs::read(&path).map_err(err)?;
    let mut content = String::from_utf8_lossy(&bytes).to_string();
    if content.starts_with('\u{feff}') {
        content.remove(0);
    }
    Ok(FileData {
        content,
        mtime: mtime_of(Path::new(&path))?,
    })
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<u64, String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(&path, content).map_err(err)?;
    mtime_of(Path::new(&path))
}

/// 붙여넣은 이미지 저장 (base64). 폴더가 없으면 만든다.
#[tauri::command]
fn write_binary_file(path: String, data: String) -> Result<(), String> {
    let bytes = B64.decode(data.as_bytes()).map_err(err)?;
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(&path, bytes).map_err(err)
}

/// HTML 내보내기에서 이미지를 문서 안에 넣을 때 사용
#[tauri::command]
fn read_binary_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(err)?;
    Ok(B64.encode(bytes))
}

#[tauri::command]
fn copy_file(from: String, to: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&to).parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::copy(&from, &to).map(|_| ()).map_err(err)
}

#[tauri::command]
fn file_mtime(path: String) -> Result<u64, String> {
    mtime_of(Path::new(&path))
}

/// "dir" | "file" | "missing"
#[tauri::command]
fn path_kind(path: String) -> String {
    let p = PathBuf::from(path);
    if p.is_dir() {
        "dir".into()
    } else if p.is_file() {
        "file".into()
    } else {
        "missing".into()
    }
}

/* ---------------- 탐색기 파일 조작 ---------------- */

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err("같은 이름의 파일이 이미 있습니다".into());
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(p, "").map_err(err)
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err("같은 이름의 폴더가 이미 있습니다".into());
    }
    fs::create_dir_all(p).map_err(err)
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err("같은 이름이 이미 있습니다".into());
    }
    fs::rename(&from, &to).map_err(err)
}

/// 휴지통으로 이동 (영구 삭제 아님)
#[tauri::command]
fn trash_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(err)
}

/* ---------------- 폴더 감시 ---------------- */

#[tauri::command]
fn watch_dir(app: tauri::AppHandle, state: tauri::State<Watcher>, path: String) -> Result<(), String> {
    let handle = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |res: Result<Vec<DebouncedEvent>, _>| {
            if let Ok(events) = res {
                let paths: Vec<String> = events
                    .iter()
                    .filter(|e| !is_ignored(&e.path))
                    .map(|e| e.path.to_string_lossy().to_string())
                    .collect();
                if !paths.is_empty() {
                    let _ = handle.emit("fs-change", paths);
                }
            }
        },
    )
    .map_err(err)?;
    debouncer
        .watcher()
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(err)?;
    let mut guard = state.0.lock().map_err(err)?;
    *guard = Some(debouncer); // 이전 감시기는 여기서 해제됨
    Ok(())
}

/* ---------------- 기타 ---------------- */

/// 인쇄 / PDF 저장. macOS는 네이티브 인쇄, 그 외는 false를 돌려주고 JS에서 window.print()
#[tauri::command]
fn print_page(webview: tauri::Webview) -> bool {
    if cfg!(target_os = "macos") {
        webview.print().is_ok()
    } else {
        false
    }
}

#[tauri::command]
fn take_pending_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

pub fn run() {
    // Windows / Linux: 파일 연결로 실행되면 첫 번째 인자로 경로가 들어옴
    let arg_file = std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && Path::new(a).exists());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFile(Mutex::new(arg_file)))
        .manage(Watcher::default())
        .invoke_handler(tauri::generate_handler![
            list_dir,
            read_text_file,
            write_text_file,
            write_binary_file,
            read_binary_base64,
            copy_file,
            file_mtime,
            path_kind,
            create_file,
            create_dir,
            rename_path,
            trash_path,
            watch_dir,
            print_page,
            take_pending_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        handle_opened(_app, &_event);
    });
}

/// macOS: Finder에서 .md 파일을 더블클릭하면 Opened 이벤트로 전달됨
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn handle_opened(app: &tauri::AppHandle, event: &tauri::RunEvent) {
    use tauri::Manager;
    if let tauri::RunEvent::Opened { urls } = event {
        let path = urls
            .iter()
            .find_map(|u| u.to_file_path().ok())
            .map(|p| p.to_string_lossy().to_string());
        if let Some(path) = path {
            if let Some(state) = app.try_state::<PendingFile>() {
                if let Ok(mut g) = state.0.lock() {
                    *g = Some(path.clone());
                }
            }
            let _ = app.emit("open-file", path);
        }
    }
}
