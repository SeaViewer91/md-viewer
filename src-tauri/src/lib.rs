use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

/// 앱 시작 시 (파일 더블클릭·명령줄 인자로) 전달된 파일 경로
#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

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

const TEXT_EXTS: &[&str] = &["md", "markdown", "mdx", "txt"];

fn mtime_of(path: &Path) -> Result<u64, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = meta.modified().map_err(|e| e.to_string())?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0))
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| TEXT_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 폴더 내용 (숨김 파일 제외, 폴더 먼저, 마크다운/텍스트 파일만)
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let rd = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut entries: Vec<Entry> = Vec::new();
    for item in rd.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "__pycache__" {
            continue;
        }
        let p = item.path();
        let is_dir = p.is_dir();
        if !is_dir && !is_markdown(&p) {
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
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
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
    fs::write(&path, content).map_err(|e| e.to_string())?;
    mtime_of(Path::new(&path))
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
        .invoke_handler(tauri::generate_handler![
            list_dir,
            read_text_file,
            write_text_file,
            file_mtime,
            path_kind,
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
    use tauri::{Emitter, Manager};
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
