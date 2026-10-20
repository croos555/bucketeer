// Integration tests against a local S3-compatible server. Ignored by default:
//   docker run -d -p 127.0.0.1:8333:8333 chrislusf/seaweedfs server -s3 -s3.port=8333
//   cargo test -- --ignored --test-threads=1

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

use crate::s3::*;
use crate::transfers::*;

const CONN: &str = "test-conn";

fn setup() {
    let c = json!({ "id": CONN, "label": "test", "provider": "minio", "endpoint": "http://127.0.0.1:8333", "region": "us-east-1",
                    "accessKeyId": "any", "secretAccessKey": "any", "forcePathStyle": true });
    // In memory only: Store::upsert would write vault.json
    crate::store::store().vault["connections"] = json!([c.clone()]);
    register_client_for_tests(CONN, make_client(&c));
}

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("bucketeer-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

// Transfers run in the background and report through events; poll the object listing instead
async fn wait_until<F: Fn() -> Fut, Fut: std::future::Future<Output = bool>>(f: F) {
    for _ in 0..300 {
        if f().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("timed out");
}

async fn keys(bucket: &str, prefix: &str) -> Vec<(String, i64)> {
    list_all(CONN, bucket, prefix).await.unwrap()
}

#[tokio::test]
#[ignore]
async fn s3_end_to_end() {
    setup();
    let b = format!("rs-{}", std::process::id());
    let b2 = format!("{b}-two");
    s3_create_bucket(CONN.into(), b.clone()).await.unwrap();
    s3_create_bucket(CONN.into(), b2.clone()).await.unwrap();

    // Local tree: small file, 40 MB file (multipart with 16 MB parts), nested accented name, empty folder
    let src = tmp("src").join("src");
    std::fs::create_dir_all(src.join("sub")).unwrap();
    std::fs::create_dir_all(src.join("empty")).unwrap();
    std::fs::write(src.join("a.txt"), "hello bucketeer").unwrap();
    let big: Vec<u8> = (0..40 * 1024 * 1024u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(src.join("big.bin"), &big).unwrap();
    std::fs::write(src.join("sub").join("été 2026.txt"), "nested é").unwrap();

    transfer_upload(CONN.into(), b.clone(), "up/".into(), vec![src.to_string_lossy().into()]).unwrap();
    wait_until(|| async { keys(&b, "up/src/").await.len() == 4 }).await;
    let listed = s3_list(CONN.into(), b.clone(), "up/src/".into(), None).await.unwrap();
    let names: Vec<String> = listed["entries"].as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap().to_string()).collect();
    println!("listing: {names:?}");
    assert!(names.contains(&"sub".to_string()) && names.contains(&"empty".to_string()) && names.contains(&"big.bin".to_string()));
    let big_size = listed["entries"].as_array().unwrap().iter().find(|e| e["name"] == "big.bin").unwrap()["size"].clone();
    assert_eq!(big_size, json!(big.len()));

    let dl = tmp("dl");
    transfer_download(CONN.into(), b.clone(), vec!["up/src/".into()], dl.to_string_lossy().into()).unwrap();
    let got = dl.join("src").join("big.bin");
    wait_until(|| async { std::fs::metadata(dl.join("src").join("sub").join("été 2026.txt")).is_ok() && std::fs::metadata(&got).map(|m| m.len() == big.len() as u64).unwrap_or(false) }).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(std::fs::read(&got).unwrap(), big, "downloaded big.bin differs");

    // Server-side copy into another bucket
    transfer_copy(
        serde_json::from_value(json!({ "connId": CONN, "bucket": b })).unwrap(),
        vec!["up/src/sub/".into()],
        serde_json::from_value(json!({ "connId": CONN, "bucket": b2, "prefix": "copied/" })).unwrap(),
    )
    .unwrap();
    wait_until(|| async { keys(&b2, "copied/").await.iter().any(|(k, _)| k == "copied/sub/été 2026.txt") }).await;

    s3_rename(CONN.into(), b.clone(), "up/src/a.txt".into(), "up/src/renamed.txt".into()).await.unwrap();
    s3_rename(CONN.into(), b.clone(), "up/src/sub/".into(), "up/src/moved/".into()).await.unwrap();
    assert!(keys(&b, "up/src/sub/").await.is_empty() && keys(&b, "up/src/moved/").await.len() == 1);

    let info: Value = s3_info(CONN.into(), b.clone(), "up/src/renamed.txt".into()).await.unwrap();
    println!("info content-type: {}", info["contentType"]);
    assert!(info["contentType"].as_str().unwrap_or_default().starts_with("text/plain"));

    let url = s3_presign(CONN.into(), b.clone(), "up/src/renamed.txt".into(), 600).await.unwrap();
    let body = reqwest::get(&url).await.unwrap().text().await.unwrap();
    assert_eq!(body, "hello bucketeer", "signed link");
    let check = s3_check_url(format!("http://127.0.0.1:8333/{b}/nope.txt")).await;
    assert_eq!(check["status"], 404);

    s3_mkdir(CONN.into(), b.clone(), "up/newdir/".into()).await.unwrap();
    let up = s3_list(CONN.into(), b.clone(), "up/".into(), None).await.unwrap();
    assert!(up["entries"].as_array().unwrap().iter().any(|e| e["name"] == "newdir" && e["isDir"] == true));

    // Bucketeer refuses to delete a non-empty bucket even when the server would
    let refused = s3_delete_bucket(CONN.into(), b.clone()).await;
    assert!(refused.is_err());
    let n = s3_delete(CONN.into(), b.clone(), vec!["up/".into()]).await.unwrap();
    println!("deleted {n} objects");
    assert!(keys(&b, "").await.is_empty());
    s3_delete(CONN.into(), b2.clone(), vec!["copied/".into()]).await.unwrap();
    s3_delete_bucket(CONN.into(), b.clone()).await.unwrap();
    s3_delete_bucket(CONN.into(), b2.clone()).await.unwrap();
}

// A minimal forward proxy: accepts connections, counts them and pipes the bytes to the local S3 server,
// whatever host the request names. The endpoint's host only exists for this proxy, so a request that
// bypassed the proxy could not resolve it.
async fn start_proxy() -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let seen = count.clone();
    tokio::spawn(async move {
        while let Ok((mut client, _)) = listener.accept().await {
            seen.fetch_add(1, Ordering::SeqCst);
            tokio::spawn(async move {
                if let Ok(mut server) = tokio::net::TcpStream::connect("127.0.0.1:8333").await {
                    let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
                }
            });
        }
    });
    (format!("http://{addr}"), count)
}

#[tokio::test]
#[ignore]
async fn s3_through_manual_proxy() {
    use std::sync::atomic::Ordering;
    let (proxy_url, count) = start_proxy().await;
    let c = json!({ "id": "proxy-conn", "label": "proxied", "provider": "minio",
                    "endpoint": "http://s3.only-the-proxy-knows.invalid:8333", "region": "us-east-1",
                    "accessKeyId": "any", "secretAccessKey": "any", "forcePathStyle": true });
    {
        let mut st = crate::store::store();
        st.vault["connections"] = json!([c.clone()]);
        st.vault["settings"]["proxyMode"] = json!("manual");
        st.vault["settings"]["proxyUrl"] = json!(proxy_url.trim_start_matches("http://"));
    }
    register_client_for_tests("proxy-conn", make_client(&c));

    let b = format!("px-{}", std::process::id());
    s3_create_bucket("proxy-conn".into(), b.clone()).await.unwrap();
    s3_mkdir("proxy-conn".into(), b.clone(), "via-proxy/".into()).await.unwrap();
    let listed = list_all("proxy-conn", &b, "").await.unwrap();
    assert!(listed.iter().any(|(k, _)| k == "via-proxy/"));
    s3_delete("proxy-conn".into(), b.clone(), vec!["via-proxy/".into()]).await.unwrap();
    s3_delete_bucket("proxy-conn".into(), b).await.unwrap();
    assert!(count.load(Ordering::SeqCst) > 0, "no request went through the proxy");

    // "none" connects directly: the made-up host cannot be resolved
    crate::store::store().vault["settings"]["proxyMode"] = json!("none");
    register_client_for_tests("proxy-conn", make_client(&c));
    assert!(s3_buckets("proxy-conn".into()).await.is_err());
}
