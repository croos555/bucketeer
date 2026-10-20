// Local file pane: listing, folders, rename, delete (to the trash), open with the system

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri_plugin_opener::OpenerExt;

use crate::util::{app, Result};

#[tauri::command]
pub fn local_home() -> String {
    dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| "/".into())
}

#[tauri::command]
pub fn local_list(dir: String) -> Result<Vec<Value>> {
    let mut out = vec![];
    for entry in std::fs::read_dir(&dir)?.filter_map(|e| e.ok()) {
        let path = entry.path();
        // Follow symlinks so folders behind them are browsable; skip unreadable entries
        let Ok(meta) = std::fs::metadata(&path).or_else(|_| std::fs::symlink_metadata(&path)) else { continue };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(json!({
            "name": entry.file_name().to_string_lossy(),
            "path": path.to_string_lossy(),
            "isDir": meta.is_dir(),
            "size": meta.len(),
            "mtime": mtime
        }));
    }
    Ok(out)
}

#[tauri::command]
pub fn local_parent(path: String) -> String {
    Path::new(&path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or(path)
}

#[tauri::command]
pub fn local_mkdir(path: String) -> Result<()> {
    Ok(std::fs::create_dir(path)?)
}

#[tauri::command]
pub fn local_rename(from: String, to: String) -> Result<()> {
    Ok(std::fs::rename(from, to)?)
}

#[tauri::command]
pub fn local_delete(paths: Vec<String>) -> Result<()> {
    Ok(trash::delete_all(paths.iter().map(PathBuf::from))?)
}

#[tauri::command]
pub fn local_open(path: String) -> Result<String> {
    app().opener().open_path(path, None::<&str>)?;
    Ok(String::new())
}
