// Bucketeer: Rust backend (vault, S3, transfers, local files) behind the React renderer.
// Commands and events used by window.api (src/renderer/src/api.ts).

mod local;
mod s3;
mod secrets;
mod store;
mod transfers;
mod util;

#[cfg(test)]
mod s3_tests;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            util::set_app(app.handle().clone());
            store::store().load();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store::vault_get,
            store::vault_upsert,
            store::vault_remove,
            store::vault_settings,
            store::vault_storage_info,
            s3::s3_test,
            s3::s3_buckets,
            s3::s3_create_bucket,
            s3::s3_delete_bucket,
            s3::s3_list,
            s3::s3_delete,
            s3::s3_mkdir,
            s3::s3_rename,
            s3::s3_info,
            s3::s3_is_public,
            s3::s3_set_public,
            s3::s3_check_url,
            s3::s3_presign,
            transfers::transfer_upload,
            transfers::transfer_download,
            transfers::transfer_copy,
            transfers::transfer_cancel,
            local::local_home,
            local::local_list,
            local::local_parent,
            local::local_mkdir,
            local::local_rename,
            local::local_delete,
            local::local_open,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
