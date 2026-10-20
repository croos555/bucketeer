// Uploads, downloads and bucket-to-bucket copies with progress events and cancellation.
// Large uploads use multipart (part size / parallelism from Settings); copies inside one
// connection are server-side, across providers the data is streamed through this machine.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart, ObjectCannedAcl};
use aws_sdk_s3::Client;
use futures::{stream, StreamExt, TryStreamExt};
use serde::Deserialize;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use crate::s3::{client, connection, copy_source, err, expand};
use crate::store::store;
use crate::util::{emit, uuid, Result};

static CANCEL: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = LazyLock::new(Default::default);
const FIVE_GB: i64 = 5 * 1024 * 1024 * 1024;

#[derive(Clone)]
struct Progress {
    id: String,
    direction: &'static str,
    name: String,
    transferred: Arc<Mutex<u64>>,
    total: u64,
    files: usize,
    files_done: usize,
    last: Arc<Mutex<Instant>>,
    cancel: Arc<AtomicBool>,
}

impl Progress {
    fn send(&self, status: &str, error: Option<String>) {
        emit(
            "transfer:progress",
            json!({
                "transferId": self.id, "direction": self.direction, "name": self.name,
                "transferred": *self.transferred.lock().unwrap(), "total": self.total,
                "files": self.files, "filesDone": self.files_done, "status": status, "error": error
            }),
        );
    }
    fn add(&self, n: u64) {
        *self.transferred.lock().unwrap() += n;
        let mut last = self.last.lock().unwrap();
        if last.elapsed() > Duration::from_millis(120) {
            *last = Instant::now();
            drop(last);
            self.send("running", None);
        }
    }
    fn check(&self) -> anyhow::Result<()> {
        if self.cancel.load(Ordering::Relaxed) {
            bail!("Cancelled")
        }
        Ok(())
    }
}

// Starts the work in the background and returns its transfer id right away
fn start<F, Fut>(direction: &'static str, name: String, work: F) -> String
where
    F: FnOnce(Progress) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = anyhow::Result<()>> + Send,
{
    let id = uuid();
    let cancel = Arc::new(AtomicBool::new(false));
    CANCEL.lock().unwrap().insert(id.clone(), cancel.clone());
    let p = Progress {
        id: id.clone(),
        direction,
        name,
        transferred: Default::default(),
        total: 0,
        files: 0,
        files_done: 0,
        last: Arc::new(Mutex::new(Instant::now())),
        cancel,
    };
    p.send("running", None);
    let tid = id.clone();
    tauri::async_runtime::spawn(async move {
        let pc = p.clone();
        let res = work(p).await;
        let cancelled = pc.cancel.load(Ordering::Relaxed);
        match res {
            Ok(()) => pc.send(if cancelled { "cancelled" } else { "done" }, None),
            Err(e) => pc.send(if cancelled { "cancelled" } else { "error" }, Some(format!("{e:#}"))),
        }
        CANCEL.lock().unwrap().remove(&tid);
    });
    id
}

fn part_size() -> u64 {
    store().setting_u64("partSizeMB", 16).clamp(5, 512) * 1024 * 1024
}
fn concurrency() -> usize {
    store().setting_u64("concurrency", 4).clamp(1, 16) as usize
}

// Connection setting "new uploads are public"
fn acl_for(conn_id: &str) -> Option<ObjectCannedAcl> {
    connection(conn_id).ok().filter(|c| c["uploadAcl"] == "public-read").map(|_| ObjectCannedAcl::PublicRead)
}

fn base_name(p: &str) -> String {
    p.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or(p).to_string()
}

// Selected "a/b/c.txt" lands as "c.txt"; selected folder "a/b/" lands as "b/…"
fn relative_to(selected: &str, key: &str) -> String {
    let trimmed = selected.trim_end_matches('/');
    let base = &trimmed[..trimmed.rfind('/').map(|i| i + 1).unwrap_or(0)];
    key[base.len().min(key.len())..].to_string()
}

struct LocalFile {
    path: PathBuf,
    rel: String,
    // None = empty folder (uploaded as a "folder/" marker)
    size: Option<u64>,
}

fn walk(path: &Path, base: &Path, out: &mut Vec<LocalFile>) -> anyhow::Result<()> {
    let meta = std::fs::metadata(path)?;
    let rel = path.strip_prefix(base).unwrap_or(path).components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
    if meta.is_dir() {
        let mut children: Vec<_> = std::fs::read_dir(path)?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
        children.sort();
        if children.is_empty() {
            out.push(LocalFile { path: path.to_path_buf(), rel: format!("{rel}/"), size: None });
        }
        for c in children {
            walk(&c, base, out)?;
        }
    } else {
        out.push(LocalFile { path: path.to_path_buf(), rel, size: Some(meta.len()) });
    }
    Ok(())
}

async fn upload_file(cl: &Client, bucket: &str, key: &str, f: &LocalFile, p: &Progress, acl: Option<ObjectCannedAcl>) -> anyhow::Result<()> {
    let size = f.size.unwrap_or(0);
    let content_type = mime_guess::from_path(&f.path).first_or_octet_stream().to_string();
    let part = part_size();
    if size <= part {
        // Known length: a plain PUT instead of a chunked stream some providers refuse
        let body = ByteStream::from_path(&f.path).await?;
        cl.put_object()
            .bucket(bucket)
            .key(key)
            .content_length(size as i64)
            .content_type(content_type)
            .set_acl(acl)
            .body(body)
            .send()
            .await
            .map_err(err)?;
        p.add(size);
        return Ok(());
    }
    let up = cl
        .create_multipart_upload()
        .bucket(bucket)
        .key(key)
        .content_type(content_type)
        .set_acl(acl)
        .send()
        .await
        .map_err(err)?;
    let upload_id = up.upload_id().ok_or_else(|| anyhow!("No upload id"))?.to_string();
    let parts = size.div_ceil(part);
    let result = stream::iter(0..parts)
        .map(|i| {
            let (cl, bucket, key, upload_id, path, p) = (cl.clone(), bucket.to_string(), key.to_string(), upload_id.clone(), f.path.clone(), p.clone());
            async move {
                p.check()?;
                let start = i * part;
                let len = part.min(size - start) as usize;
                let mut file = tokio::fs::File::open(&path).await?;
                file.seek(std::io::SeekFrom::Start(start)).await?;
                let mut buf = vec![0u8; len];
                file.read_exact(&mut buf).await?;
                let res = cl
                    .upload_part()
                    .bucket(bucket)
                    .key(key)
                    .upload_id(upload_id)
                    .part_number(i as i32 + 1)
                    .content_length(len as i64)
                    .body(ByteStream::from(buf))
                    .send()
                    .await
                    .map_err(err)?;
                p.add(len as u64);
                Ok::<_, anyhow::Error>(CompletedPart::builder().part_number(i as i32 + 1).set_e_tag(res.e_tag().map(String::from)).build())
            }
        })
        .buffer_unordered(concurrency())
        .try_collect::<Vec<_>>()
        .await;
    match result {
        Ok(mut done) => {
            done.sort_by_key(|p| p.part_number());
            cl.complete_multipart_upload()
                .bucket(bucket)
                .key(key)
                .upload_id(&upload_id)
                .multipart_upload(CompletedMultipartUpload::builder().set_parts(Some(done)).build())
                .send()
                .await
                .map_err(err)?;
            Ok(())
        }
        Err(e) => {
            // Don't leave orphaned parts (they are billed) behind
            let _ = cl.abort_multipart_upload().bucket(bucket).key(key).upload_id(&upload_id).send().await;
            Err(e)
        }
    }
}

#[tauri::command]
pub fn transfer_upload(id: String, bucket: String, prefix: String, paths: Vec<String>) -> Result<String> {
    let name = if paths.len() == 1 { base_name(&paths[0]) } else { format!("{} items", paths.len()) };
    Ok(start("upload", name, move |mut p| async move {
        let mut files = vec![];
        for path in &paths {
            let path = PathBuf::from(path);
            let base = path.parent().map(Path::to_path_buf).unwrap_or_default();
            walk(&path, &base, &mut files)?;
        }
        p.files = files.len();
        p.total = files.iter().map(|f| f.size.unwrap_or(0)).sum();
        p.send("running", None);
        let cl = client(&id)?;
        let acl = acl_for(&id);
        for f in &files {
            p.check()?;
            let key = format!("{prefix}{}", f.rel);
            if f.size.is_none() {
                cl.put_object().bucket(&bucket).key(&key).content_length(0).body(ByteStream::from_static(b"")).send().await.map_err(err)?;
            } else {
                upload_file(&cl, &bucket, &key, f, &p, acl.clone()).await?;
            }
            p.files_done += 1;
            p.send("running", None);
        }
        Ok(())
    }))
}

#[tauri::command]
pub fn transfer_download(id: String, bucket: String, keys: Vec<String>, dir: String) -> Result<String> {
    let name = if keys.len() == 1 { base_name(&keys[0]) } else { format!("{} items", keys.len()) };
    Ok(start("download", name, move |mut p| async move {
        let mut plan = vec![];
        for sel in &keys {
            for (k, size) in expand(&id, &bucket, std::slice::from_ref(sel)).await? {
                let rel = relative_to(sel, &k);
                plan.push((k, size, rel));
            }
        }
        p.files = plan.len();
        p.total = plan.iter().map(|(_, s, _)| *s as u64).sum();
        p.send("running", None);
        let cl = client(&id)?;
        for (key, _, rel) in &plan {
            p.check()?;
            let dest = rel.split('/').filter(|s| !s.is_empty()).fold(PathBuf::from(&dir), |acc, s| acc.join(s));
            if key.ends_with('/') {
                tokio::fs::create_dir_all(&dest).await?;
            } else {
                if let Some(parent) = dest.parent() {
                    tokio::fs::create_dir_all(parent).await?;
                }
                let mut body = cl.get_object().bucket(&bucket).key(key).send().await.map_err(err)?.body;
                let mut file = tokio::fs::File::create(&dest).await?;
                while let Some(chunk) = body.try_next().await? {
                    p.check()?;
                    file.write_all(&chunk).await?;
                    p.add(chunk.len() as u64);
                }
                file.flush().await?;
            }
            p.files_done += 1;
            p.send("running", None);
        }
        Ok(())
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Src {
    conn_id: String,
    bucket: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dst {
    conn_id: String,
    bucket: String,
    prefix: String,
}

// Streams an object from one client to another, as multipart when it is larger than one part
async fn stream_copy(src: &Client, s_bucket: &str, s_key: &str, dst: &Client, d_bucket: &str, d_key: &str, size: i64, p: &Progress, acl: Option<ObjectCannedAcl>) -> anyhow::Result<()> {
    let obj = src.get_object().bucket(s_bucket).key(s_key).send().await.map_err(err)?;
    let content_type = obj.content_type().map(String::from);
    let mut body = obj.body;
    let part = part_size() as usize;
    if size as usize <= part {
        let data = body.collect().await?.into_bytes();
        dst.put_object()
            .bucket(d_bucket)
            .key(d_key)
            .content_length(data.len() as i64)
            .set_content_type(content_type)
            .set_acl(acl)
            .body(ByteStream::from(data.to_vec()))
            .send()
            .await
            .map_err(err)?;
        p.add(size as u64);
        return Ok(());
    }
    let up = dst.create_multipart_upload().bucket(d_bucket).key(d_key).set_content_type(content_type).set_acl(acl).send().await.map_err(err)?;
    let upload_id = up.upload_id().ok_or_else(|| anyhow!("No upload id"))?.to_string();
    let result: anyhow::Result<Vec<CompletedPart>> = async {
        let mut parts = vec![];
        let mut buf: Vec<u8> = Vec::with_capacity(part);
        let mut n = 1;
        loop {
            p.check()?;
            let chunk = body.try_next().await?;
            if let Some(c) = &chunk {
                buf.extend_from_slice(c);
            }
            if buf.len() >= part || (chunk.is_none() && !buf.is_empty()) {
                let data = std::mem::replace(&mut buf, Vec::with_capacity(part));
                let len = data.len();
                let res = dst
                    .upload_part()
                    .bucket(d_bucket)
                    .key(d_key)
                    .upload_id(&upload_id)
                    .part_number(n)
                    .content_length(len as i64)
                    .body(ByteStream::from(data))
                    .send()
                    .await
                    .map_err(err)?;
                parts.push(CompletedPart::builder().part_number(n).set_e_tag(res.e_tag().map(String::from)).build());
                p.add(len as u64);
                n += 1;
            }
            if chunk.is_none() {
                break;
            }
        }
        Ok(parts)
    }
    .await;
    match result {
        Ok(parts) => {
            dst.complete_multipart_upload()
                .bucket(d_bucket)
                .key(d_key)
                .upload_id(&upload_id)
                .multipart_upload(CompletedMultipartUpload::builder().set_parts(Some(parts)).build())
                .send()
                .await
                .map_err(err)?;
            Ok(())
        }
        Err(e) => {
            let _ = dst.abort_multipart_upload().bucket(d_bucket).key(d_key).upload_id(&upload_id).send().await;
            Err(e)
        }
    }
}

// S3 → S3. Same connection: server-side copy (no data through this machine, objects up to 5 GB).
// Otherwise the object is streamed from one provider to the other.
#[tauri::command]
pub fn transfer_copy(src: Src, keys: Vec<String>, dst: Dst) -> Result<String> {
    let name = if keys.len() == 1 { base_name(&keys[0]) } else { format!("{} items", keys.len()) };
    Ok(start("copy", name, move |mut p| async move {
        let mut plan = vec![];
        for sel in &keys {
            for (k, size) in expand(&src.conn_id, &src.bucket, std::slice::from_ref(sel)).await? {
                let rel = relative_to(sel, &k);
                plan.push((k, size, rel));
            }
        }
        p.files = plan.len();
        p.total = plan.iter().map(|(_, s, _)| *s as u64).sum();
        p.send("running", None);
        let (s_cl, d_cl) = (client(&src.conn_id)?, client(&dst.conn_id)?);
        // A copy doesn't keep the source ACL: apply the destination connection's choice
        let acl = acl_for(&dst.conn_id);
        for (key, size, rel) in &plan {
            p.check()?;
            let dest_key = format!("{}{rel}", dst.prefix);
            if src.conn_id == dst.conn_id && *size < FIVE_GB {
                d_cl.copy_object()
                    .bucket(&dst.bucket)
                    .key(&dest_key)
                    .copy_source(copy_source(&src.bucket, key))
                    .set_acl(acl.clone())
                    .send()
                    .await
                    .map_err(err)?;
                p.add(*size as u64);
            } else {
                stream_copy(&s_cl, &src.bucket, key, &d_cl, &dst.bucket, &dest_key, *size, &p, acl.clone()).await?;
            }
            p.files_done += 1;
            p.send("running", None);
        }
        Ok(())
    }))
}

#[tauri::command]
pub fn transfer_cancel(id: String) {
    if let Some(c) = CANCEL.lock().unwrap().get(&id) {
        c.store(true, Ordering::Relaxed);
    }
}
