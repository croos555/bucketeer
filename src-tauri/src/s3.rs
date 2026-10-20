// S3 operations on top of the official AWS SDK for Rust: one cached client per connection,
// listing, buckets, delete/rename, ACLs, presigned links, and readable error messages.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use anyhow::{anyhow, bail};
use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region, RequestChecksumCalculation, ResponseChecksumValidation};
use aws_sdk_s3::error::{ProvideErrorMetadata, SdkError};
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{
    BucketLocationConstraint, CreateBucketConfiguration, Delete, ObjectCannedAcl, ObjectIdentifier, Permission,
};
use aws_sdk_s3::Client;
use futures::{stream, StreamExt, TryStreamExt};
use serde_json::{json, Value};

use crate::store::store;
use crate::util::Result;

static CLIENTS: LazyLock<Mutex<HashMap<String, Client>>> = LazyLock::new(Default::default);

const ALL_USERS: &str = "http://acs.amazonaws.com/groups/global/AllUsers";

#[cfg(test)]
pub fn register_client_for_tests(id: &str, c: Client) {
    CLIENTS.lock().unwrap().insert(id.to_string(), c);
}

pub fn forget_client(id: &str) {
    CLIENTS.lock().unwrap().remove(id);
}

// Proxy settings changed: every client is rebuilt on next use
pub fn forget_all_clients() {
    CLIENTS.lock().unwrap().clear();
}

fn s(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or_default().trim().to_string()
}

pub fn make_client(c: &Value) -> Client {
    let region = s(c, "region");
    let endpoint = s(c, "endpoint");
    let mut b = aws_sdk_s3::config::Builder::new()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new(if region.is_empty() { "us-east-1".to_string() } else { region }))
        .credentials_provider(Credentials::new(s(c, "accessKeyId"), s(c, "secretAccessKey"), None, None, "bucketeer"))
        .force_path_style(c["forcePathStyle"].as_bool().unwrap_or(false))
        .http_client(crate::proxy::http_client());
    if !endpoint.is_empty() {
        b = b.endpoint_url(endpoint);
    }
    // The SDK adds CRC32 checksums to every request by default; many S3-compatible stores (OVH, older
    // MinIO, R2…) reject or mishandle them, so only send/check them when the API requires it
    if s(c, "provider") != "aws" {
        b = b
            .request_checksum_calculation(RequestChecksumCalculation::WhenRequired)
            .response_checksum_validation(ResponseChecksumValidation::WhenRequired);
    }
    Client::from_conf(b.build())
}

pub fn connection(id: &str) -> anyhow::Result<Value> {
    store().find("connections", id).ok_or_else(|| anyhow!("Connection not found"))
}

pub fn client(id: &str) -> anyhow::Result<Client> {
    if let Some(c) = CLIENTS.lock().unwrap().get(id) {
        return Ok(c.clone());
    }
    let c = make_client(&connection(id)?);
    CLIENTS.lock().unwrap().insert(id.to_string(), c.clone());
    Ok(c)
}

// Turn SDK errors into something readable
pub fn err<E, R>(e: SdkError<E, R>) -> anyhow::Error
where
    E: ProvideErrorMetadata + std::error::Error + Send + Sync + 'static,
    R: std::fmt::Debug + Send + Sync + 'static,
{
    if let SdkError::DispatchFailure(d) = &e {
        let detail = d.as_connector_error().map(|c| c.to_string()).unwrap_or_default();
        return anyhow!("Cannot reach the endpoint{}", if detail.is_empty() { String::new() } else { format!(": {detail}") });
    }
    if let SdkError::TimeoutError(_) = &e {
        return anyhow!("The endpoint did not answer in time");
    }
    let code = e.code().unwrap_or_default();
    let msg = match code {
        "InvalidAccessKeyId" => "Unknown access key",
        "SignatureDoesNotMatch" => "Wrong secret key (signature mismatch)",
        "AccessDenied" => "Access denied for this key",
        "NoSuchBucket" => "Bucket not found",
        "NoSuchKey" | "NotFound" => "Object not found",
        "BucketNotEmpty" => "The bucket is not empty",
        "BucketAlreadyExists" => "This bucket name is already taken",
        "BucketAlreadyOwnedByYou" => "You already own a bucket with this name",
        "InvalidBucketName" => "Invalid bucket name (3-63 chars: lowercase letters, digits, dots, hyphens)",
        "PermanentRedirect" => "Wrong region or endpoint for this bucket",
        "AuthorizationHeaderMalformed" => "Wrong region for this endpoint",
        "AccessControlListNotSupported" => {
            "ACLs are disabled on this bucket (object ownership enforced): use a bucket policy instead"
        }
        "NotImplemented" => "This provider does not support this operation",
        _ => "",
    };
    if !msg.is_empty() {
        return anyhow!(msg);
    }
    let m = e.message().map(String::from).unwrap_or_else(|| if code.is_empty() { format!("{e}") } else { code.to_string() });
    anyhow!(m)
}

fn ms(d: Option<&aws_sdk_s3::primitives::DateTime>) -> i64 {
    d.and_then(|d| d.to_millis().ok()).unwrap_or(0)
}

// CopySource must be URL-encoded per path segment
pub fn copy_source(bucket: &str, key: &str) -> String {
    let enc = |seg: &str| {
        seg.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                _ => format!("%{b:02X}"),
            })
            .collect::<String>()
    };
    format!("{bucket}/{}", key.split('/').map(enc).collect::<Vec<_>>().join("/"))
}

pub async fn list_all(id: &str, bucket: &str, prefix: &str) -> anyhow::Result<Vec<(String, i64)>> {
    let cl = client(id)?;
    let mut out = vec![];
    let mut token: Option<String> = None;
    loop {
        let res = cl
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix)
            .set_continuation_token(token.clone())
            .send()
            .await
            .map_err(err)?;
        for o in res.contents() {
            out.push((o.key().unwrap_or_default().to_string(), o.size().unwrap_or(0)));
        }
        token = if res.is_truncated().unwrap_or(false) { res.next_continuation_token().map(String::from) } else { None };
        if token.is_none() {
            break;
        }
    }
    Ok(out)
}

// Expand a mix of keys and "folder/" prefixes into concrete objects
pub async fn expand(id: &str, bucket: &str, keys: &[String]) -> anyhow::Result<Vec<(String, i64)>> {
    let cl = client(id)?;
    let mut out = vec![];
    for k in keys {
        if k.ends_with('/') {
            out.extend(list_all(id, bucket, k).await?);
        } else {
            let h = cl.head_object().bucket(bucket).key(k).send().await.map_err(err)?;
            out.push((k.clone(), h.content_length().unwrap_or(0)));
        }
    }
    Ok(out)
}

pub async fn delete_keys(id: &str, bucket: &str, keys: &[String]) -> anyhow::Result<usize> {
    let mut all: Vec<String> = expand(id, bucket, keys).await?.into_iter().map(|(k, _)| k).collect();
    // Folder markers ("a/b/") that listings may not return for empty folders
    for k in keys {
        if k.ends_with('/') && !all.contains(k) {
            all.push(k.clone());
        }
    }
    let cl = client(id)?;
    for batch in all.chunks(1000) {
        let objects = batch
            .iter()
            .map(|k| ObjectIdentifier::builder().key(k).build())
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let res = cl
            .delete_objects()
            .bucket(bucket)
            .delete(Delete::builder().set_objects(Some(objects)).quiet(true).build()?)
            .send()
            .await
            .map_err(err)?;
        if let Some(e) = res.errors().first() {
            bail!("Could not delete {} object(s): {}", res.errors().len(), e.message().unwrap_or_default());
        }
    }
    Ok(all.len())
}

// ---------- commands ----------

#[tauri::command]
pub async fn s3_test(c: Value) -> Result<Value> {
    let cl = make_client(&c);
    match cl.list_buckets().send().await {
        Ok(res) => {
            let n = res.buckets().len();
            Ok(json!({ "buckets": n, "message": format!("Connected: {n} bucket(s)") }))
        }
        Err(e) => {
            // Keys scoped to one bucket often can't list buckets: try the default bucket instead
            let def = s(&c, "defaultBucket");
            if e.code() == Some("AccessDenied") && !def.is_empty() {
                cl.list_objects_v2().bucket(&def).max_keys(1).send().await.map_err(err)?;
                return Ok(json!({ "buckets": null, "message": format!("Connected to bucket {def} (this key can't list buckets)") }));
            }
            Err(err(e).into())
        }
    }
}

#[tauri::command]
pub async fn s3_buckets(id: String) -> Result<Value> {
    match client(&id)?.list_buckets().send().await {
        Ok(res) => {
            store().touch(&id);
            let mut b: Vec<Value> = res
                .buckets()
                .iter()
                .map(|b| json!({ "name": b.name().unwrap_or_default(), "created": ms(b.creation_date()) }))
                .collect();
            b.sort_by(|a, z| a["name"].as_str().cmp(&z["name"].as_str()));
            Ok(json!({ "canList": true, "buckets": b }))
        }
        Err(e) => {
            let def = s(&connection(&id)?, "defaultBucket");
            if e.code() == Some("AccessDenied") && !def.is_empty() {
                return Ok(json!({ "canList": false, "buckets": [{ "name": def }] }));
            }
            Err(err(e).into())
        }
    }
}

#[tauri::command]
pub async fn s3_create_bucket(id: String, name: String) -> Result<()> {
    let c = connection(&id)?;
    let region = s(&c, "region");
    let mut req = client(&id)?.create_bucket().bucket(name.trim());
    // AWS wants the region spelled out except in us-east-1; other providers infer it from the endpoint
    if s(&c, "provider") == "aws" && !region.is_empty() && region != "us-east-1" {
        req = req.create_bucket_configuration(
            CreateBucketConfiguration::builder().location_constraint(BucketLocationConstraint::from(region.as_str())).build(),
        );
    }
    req.send().await.map_err(err)?;
    Ok(())
}

#[tauri::command]
pub async fn s3_delete_bucket(id: String, name: String) -> Result<()> {
    let cl = client(&id)?;
    // Some S3-compatible servers delete non-empty buckets: never rely on the server for that
    let probe = cl.list_objects_v2().bucket(&name).max_keys(1).send().await.map_err(err)?;
    if probe.key_count().unwrap_or(0) > 0 || !probe.contents().is_empty() {
        crate::bail!("The bucket is not empty");
    }
    cl.delete_bucket().bucket(&name).send().await.map_err(err)?;
    Ok(())
}

// One level of a "folder": common prefixes become folders, objects become files
#[tauri::command]
pub async fn s3_list(id: String, bucket: String, prefix: String, token: Option<String>) -> Result<Value> {
    let res = client(&id)?
        .list_objects_v2()
        .bucket(&bucket)
        .prefix(&prefix)
        .delimiter("/")
        .max_keys(1000)
        .set_continuation_token(token)
        .send()
        .await
        .map_err(err)?;
    let mut entries: Vec<Value> = res
        .common_prefixes()
        .iter()
        .filter_map(|p| p.prefix())
        .map(|p| {
            json!({ "name": p[prefix.len().min(p.len())..].trim_end_matches('/'), "path": p, "isDir": true, "size": 0, "mtime": 0 })
        })
        .collect();
    for o in res.contents() {
        let key = o.key().unwrap_or_default();
        // The "folder marker" object for the current prefix itself
        if key == prefix {
            continue;
        }
        entries.push(json!({
            "name": &key[prefix.len().min(key.len())..],
            "path": key,
            "isDir": false,
            "size": o.size().unwrap_or(0),
            "mtime": ms(o.last_modified()),
            "storageClass": o.storage_class().map(|c| c.as_str()),
            "etag": o.e_tag().map(|e| e.replace('"', ""))
        }));
    }
    let next = if res.is_truncated().unwrap_or(false) { res.next_continuation_token() } else { None };
    Ok(json!({ "entries": entries, "nextToken": next }))
}

#[tauri::command]
pub async fn s3_delete(id: String, bucket: String, keys: Vec<String>) -> Result<usize> {
    Ok(delete_keys(&id, &bucket, &keys).await?)
}

#[tauri::command]
pub async fn s3_mkdir(id: String, bucket: String, prefix: String) -> Result<()> {
    let key = if prefix.ends_with('/') { prefix } else { format!("{prefix}/") };
    client(&id)?
        .put_object()
        .bucket(bucket)
        .key(key)
        .content_length(0)
        .body(ByteStream::from_static(b""))
        .send()
        .await
        .map_err(err)?;
    Ok(())
}

// Rename = server-side copy then delete, recursively for folders
#[tauri::command]
pub async fn s3_rename(id: String, bucket: String, from: String, to: String) -> Result<()> {
    // list_all includes the "folder/" marker object when one exists; implicit folders have none
    let objects = if from.ends_with('/') { list_all(&id, &bucket, &from).await? } else { vec![(from.clone(), 0)] };
    let cl = client(&id)?;
    for (key, _) in &objects {
        let dest = format!("{to}{}", &key[from.len()..]);
        cl.copy_object().bucket(&bucket).key(dest).copy_source(copy_source(&bucket, key)).send().await.map_err(err)?;
    }
    delete_keys(&id, &bucket, &objects.into_iter().map(|(k, _)| k).collect::<Vec<_>>()).await?;
    Ok(())
}

#[tauri::command]
pub async fn s3_info(id: String, bucket: String, key: String) -> Result<Value> {
    let h = client(&id)?.head_object().bucket(&bucket).key(&key).send().await.map_err(err)?;
    Ok(json!({
        "key": key,
        "size": h.content_length().unwrap_or(0),
        "mtime": ms(h.last_modified()),
        "etag": h.e_tag().map(|e| e.replace('"', "")),
        "contentType": h.content_type(),
        "storageClass": h.storage_class().map(|c| c.as_str()),
        "cacheControl": h.cache_control(),
        "contentEncoding": h.content_encoding(),
        "versionId": h.version_id(),
        "metadata": h.metadata().cloned().unwrap_or_default()
    }))
}

// Public = anyone (AllUsers) may READ the object
#[tauri::command]
pub async fn s3_is_public(id: String, bucket: String, key: String) -> Result<bool> {
    let acl = client(&id)?.get_object_acl().bucket(bucket).key(key).send().await.map_err(err)?;
    Ok(acl.grants().iter().any(|g| {
        g.grantee().and_then(|x| x.uri()) == Some(ALL_USERS)
            && matches!(g.permission(), Some(Permission::Read) | Some(Permission::FullControl))
    }))
}

// Apply a canned ACL to objects (folders recursively), a few requests in parallel
#[tauri::command]
pub async fn s3_set_public(id: String, bucket: String, keys: Vec<String>, on: bool) -> Result<usize> {
    let objects: Vec<String> =
        expand(&id, &bucket, &keys).await?.into_iter().map(|(k, _)| k).filter(|k| !k.ends_with('/')).collect();
    let cl = client(&id)?;
    let acl = if on { ObjectCannedAcl::PublicRead } else { ObjectCannedAcl::Private };
    let n = objects.len();
    stream::iter(objects)
        .map(|k| {
            let (cl, bucket, acl) = (cl.clone(), bucket.clone(), acl.clone());
            async move { cl.put_object_acl().bucket(bucket).key(k).acl(acl).send().await.map_err(err) }
        })
        .buffer_unordered(8)
        .try_collect::<Vec<_>>()
        .await?;
    Ok(n)
}

// Ask the public URL itself, without credentials, whether it answers
#[tauri::command]
pub async fn s3_check_url(url: String) -> Value {
    let client = crate::proxy::reqwest_builder().timeout(Duration::from_secs(15)).build();
    match client {
        Ok(c) => match c.head(&url).send().await {
            Ok(r) => json!({ "ok": r.status().is_success(), "status": r.status().as_u16() }),
            Err(_) => json!({ "ok": false, "status": 0 }),
        },
        Err(_) => json!({ "ok": false, "status": 0 }),
    }
}

#[tauri::command]
pub async fn s3_presign(id: String, bucket: String, key: String, seconds: u64) -> Result<String> {
    let req = client(&id)?
        .get_object()
        .bucket(bucket)
        .key(key)
        .presigned(PresigningConfig::expires_in(Duration::from_secs(seconds))?)
        .await
        .map_err(err)?;
    Ok(req.uri().to_string())
}
