// Local vault: vault.json in the app data folder, secrets encrypted at rest (see secrets.rs).
// Items are kept as JSON objects so the renderer's types stay the single source of truth.

use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, MutexGuard};

use serde_json::{json, Map, Value};
use tauri::Manager;

use crate::secrets;
use crate::util::{app, emit, now_ms, uuid};

pub const COLLECTIONS: [&str; 3] = ["groups", "connections", "bookmarks"];

// Fields that hold secrets, per collection
fn secret_fields(col: &str) -> &'static [&'static str] {
    match col {
        "connections" => &["secretAccessKey"],
        _ => &[],
    }
}

fn default_settings() -> Value {
    json!({
        "appearance": "system",
        "partSizeMB": 16,
        "concurrency": 4,
        "confirmDelete": true,
        "showHidden": true,
        "keepRunningInBackground": false
    })
}

fn empty_vault() -> Value {
    let mut v = json!({ "version": 1, "settings": default_settings() });
    for c in COLLECTIONS {
        v[c] = json!([]);
    }
    v
}

fn map_secrets(vault: &Value, f: fn(&str) -> String) -> Value {
    let mut out = vault.clone();
    for col in COLLECTIONS {
        let fields = secret_fields(col);
        if fields.is_empty() {
            continue;
        }
        if let Some(items) = out[col].as_array_mut() {
            for item in items {
                for field in fields {
                    if let Some(s) = item.get(*field).and_then(Value::as_str).filter(|s| !s.is_empty()) {
                        item[*field] = Value::String(f(s));
                    }
                }
            }
        }
    }
    out
}

pub struct Store {
    pub vault: Value,
    file: PathBuf,
}

static STORE: LazyLock<Mutex<Store>> = LazyLock::new(|| Mutex::new(Store { vault: empty_vault(), file: PathBuf::new() }));

pub fn store() -> MutexGuard<'static, Store> {
    STORE.lock().unwrap_or_else(|e| e.into_inner())
}

// Vault of the Electron builds (0.1.0), imported once when this build starts without a vault of its own
fn electron_vault() -> Option<PathBuf> {
    let p = dirs::config_dir()?.join("bucketeer").join("vault.json");
    p.exists().then_some(p)
}

impl Store {
    pub fn load(&mut self) {
        let dir = app().path().app_data_dir().expect("app data dir");
        let _ = fs::create_dir_all(&dir);
        self.file = dir.join("vault.json");
        let source = if self.file.exists() { Some(self.file.clone()) } else { electron_vault() };
        let Some(source) = source else {
            self.save();
            return;
        };
        match fs::read_to_string(&source).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
            Some(raw) => {
                let mut v = empty_vault();
                for (k, val) in raw.as_object().cloned().unwrap_or_default() {
                    if k == "settings" {
                        for (sk, sv) in val.as_object().cloned().unwrap_or_default() {
                            v["settings"][sk] = sv;
                        }
                    } else {
                        v[k] = val;
                    }
                }
                self.vault = map_secrets(&v, secrets::decrypt);
                if source != self.file {
                    self.save();
                }
            }
            None if source == self.file => {
                // Keep the unreadable file around rather than silently overwriting it
                let _ = fs::rename(&self.file, self.file.with_extension(format!("json.corrupt-{}", now_ms())));
                self.save();
            }
            None => self.save(),
        }
    }

    fn save(&self) {
        let tmp = self.file.with_extension("json.tmp");
        let data = serde_json::to_string_pretty(&map_secrets(&self.vault, secrets::encrypt)).unwrap_or_default();
        if fs::write(&tmp, data).is_ok() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
            }
            let _ = fs::rename(&tmp, &self.file);
        }
    }

    pub fn list(&self, col: &str) -> &Vec<Value> {
        static EMPTY: Vec<Value> = Vec::new();
        self.vault[col].as_array().unwrap_or(&EMPTY)
    }

    fn list_mut(&mut self, col: &str) -> &mut Vec<Value> {
        if !self.vault[col].is_array() {
            self.vault[col] = json!([]);
        }
        self.vault[col].as_array_mut().unwrap()
    }

    pub fn find(&self, col: &str, id: &str) -> Option<Value> {
        self.list(col).iter().find(|x| x["id"] == id).cloned()
    }

    pub fn upsert(&mut self, col: &str, item: Value) -> Value {
        let mut obj = item.as_object().cloned().unwrap_or_default();
        let id = obj.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(uuid);
        let mut next = Map::new();
        next.insert("createdAt".into(), json!(now_ms()));
        next.append(&mut obj);
        next.insert("id".into(), json!(id));
        let list = self.list_mut(col);
        match list.iter_mut().find(|x| x["id"] == id.as_str()) {
            Some(existing) => {
                if let Some(e) = existing.as_object_mut() {
                    for (k, v) in next.clone() {
                        e.insert(k, v);
                    }
                }
            }
            None => list.push(Value::Object(next.clone())),
        }
        self.save();
        if col == "connections" {
            crate::s3::forget_client(&id);
        }
        Value::Object(next)
    }

    pub fn remove(&mut self, col: &str, id: &str) {
        let removed = self.find(col, id);
        self.list_mut(col).retain(|x| x["id"] != id);
        match col {
            "groups" => {
                // Orphaned connections and subgroups move up to the deleted group's parent
                let parent = removed.map(|g| g["parentId"].clone()).filter(|p| !p.is_null()).unwrap_or(Value::Null);
                for (c, field) in [("connections", "groupId"), ("groups", "parentId")] {
                    for x in self.list_mut(c).iter_mut().filter(|x| x[field] == id) {
                        x[field] = parent.clone();
                    }
                }
            }
            "connections" => {
                self.list_mut("bookmarks").retain(|b| b["connectionId"] != id);
                crate::s3::forget_client(id);
            }
            _ => {}
        }
        self.save();
    }

    pub fn update_settings(&mut self, patch: Value) -> Value {
        for (k, v) in patch.as_object().cloned().unwrap_or_default() {
            self.vault["settings"][k] = v;
        }
        self.save();
        self.vault["settings"].clone()
    }

    pub fn touch(&mut self, id: &str) {
        if let Some(c) = self.list_mut("connections").iter_mut().find(|c| c["id"] == id) {
            c["lastUsedAt"] = json!(now_ms());
            self.save();
        }
    }

    pub fn setting_u64(&self, key: &str, default: u64) -> u64 {
        self.vault["settings"][key].as_u64().unwrap_or(default)
    }
}

#[allow(dead_code)]
pub fn notify_changed() {
    emit("vault:changed", ());
}

// ---------- commands ----------

#[tauri::command]
pub fn vault_get() -> Value {
    store().vault.clone()
}

#[tauri::command]
pub fn vault_upsert(col: String, item: Value) -> crate::util::Result<Value> {
    if !COLLECTIONS.contains(&col.as_str()) {
        crate::bail!("Unknown collection");
    }
    Ok(store().upsert(&col, item))
}

#[tauri::command]
pub fn vault_remove(col: String, id: String) {
    store().remove(&col, &id)
}

#[tauri::command]
pub fn vault_settings(patch: Value) -> Value {
    store().update_settings(patch)
}

#[tauri::command]
pub fn vault_storage_info() -> Value {
    json!({ "encrypted": secrets::available(), "backend": secrets::backend() })
}
