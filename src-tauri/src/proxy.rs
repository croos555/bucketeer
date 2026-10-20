// HTTP(S) proxy for S3 requests and URL checks, from Settings → Network:
// "system" follows the environment (HTTPS_PROXY, ALL_PROXY, HTTP_PROXY, NO_PROXY), then the OS setting
// (macOS network preferences, Windows Internet settings); "manual" uses the URL typed by the user; "none"
// always connects directly. Loopback addresses never go through the proxy (local test servers).

use aws_smithy_http_client::proxy::ProxyConfig;
use aws_smithy_http_client::tls::{self, rustls_provider::CryptoMode};
use aws_sdk_s3::config::SharedHttpClient;
use serde_json::{json, Value};

use crate::store::store;

const LOOPBACK: &str = "localhost,127.0.0.1,::1";

#[derive(Clone, Debug, PartialEq)]
pub struct Proxy {
    pub url: String,
    pub user: Option<String>,
    pub password: Option<String>,
    // Comma-separated hosts, domains (.example.com) or CIDR ranges that bypass the proxy
    pub no_proxy: String,
    // Where it came from: "manual", "environment" or "system"
    pub source: &'static str,
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

// "proxy:3128" → "http://proxy:3128"
fn with_scheme(url: &str) -> String {
    let url = url.trim();
    if url.contains("://") {
        url.to_string()
    } else {
        format!("http://{url}")
    }
}

fn join_no_proxy(rules: Option<String>) -> String {
    match non_empty(rules) {
        Some(r) => format!("{LOOPBACK},{r}"),
        None => LOOPBACK.to_string(),
    }
}

fn env(names: &[&str]) -> Option<String> {
    names.iter().find_map(|n| non_empty(std::env::var(n).ok()))
}

fn from_env() -> Option<Proxy> {
    let url = env(&["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy"])?;
    Some(Proxy {
        url: with_scheme(&url),
        user: None,
        password: None,
        no_proxy: join_no_proxy(env(&["NO_PROXY", "no_proxy"])),
        source: "environment",
    })
}

#[cfg(target_os = "macos")]
fn from_os() -> Option<Proxy> {
    use system_configuration::core_foundation::array::CFArray;
    use system_configuration::core_foundation::base::{CFType, CFTypeRef, TCFType};
    use system_configuration::core_foundation::number::CFNumber;
    use system_configuration::core_foundation::string::{CFString, CFStringRef};
    use system_configuration::dynamic_store::SCDynamicStoreBuilder;
    use system_configuration::sys::schema_definitions::*;

    let store = SCDynamicStoreBuilder::new("bucketeer").build()?;
    let map = store.get_proxies()?;
    let num = |k: CFStringRef| map.find(k).and_then(|v| v.downcast::<CFNumber>()).and_then(|n| n.to_i32());
    let text = |k: CFStringRef| map.find(k).and_then(|v| v.downcast::<CFString>()).map(|s| s.to_string());
    // HTTPS proxy first (S3 endpoints are HTTPS), then the HTTP one
    let (host, port) = unsafe {
        if num(kSCPropNetProxiesHTTPSEnable) == Some(1) {
            (text(kSCPropNetProxiesHTTPSProxy)?, num(kSCPropNetProxiesHTTPSPort))
        } else if num(kSCPropNetProxiesHTTPEnable) == Some(1) {
            (text(kSCPropNetProxiesHTTPProxy)?, num(kSCPropNetProxiesHTTPPort))
        } else {
            return None;
        }
    };
    let exceptions = unsafe { map.find(kSCPropNetProxiesExceptionsList) }
        .and_then(|v| v.downcast::<CFArray>())
        .map(|list| {
            list.get_all_values()
                .into_iter()
                // SAFETY: the array's items are CF objects, retained for the wrapper's lifetime
                .map(|item| unsafe { CFType::wrap_under_get_rule(item as CFTypeRef) })
                .filter_map(|item| item.downcast::<CFString>().map(|s| s.to_string()))
                // "*.local" → ".local" (suffix match), "169.254/16" is kept as is
                .map(|s| s.trim_start_matches('*').to_string())
                .collect::<Vec<_>>()
                .join(",")
        });
    Some(Proxy {
        url: with_scheme(&match port {
            Some(p) => format!("{host}:{p}"),
            None => host,
        }),
        user: None,
        password: None,
        no_proxy: join_no_proxy(exceptions),
        source: "system",
    })
}

#[cfg(windows)]
fn from_os() -> Option<Proxy> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let settings = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;
    if settings.get_value::<u32, _>("ProxyEnable").unwrap_or(0) == 0 {
        return None;
    }
    let server: String = settings.get_value("ProxyServer").ok()?;
    // Either "host:port" for every protocol, or "http=host:port;https=host:port;…"
    let url = if server.contains('=') {
        let entry = |proto: &str| {
            server.split(';').find_map(|e| e.trim().strip_prefix(&format!("{proto}=")).map(str::to_string))
        };
        entry("https").or_else(|| entry("http"))?
    } else {
        server
    };
    // "<local>" means plain host names; "*.corp" → ".corp", "10.*" → "10.0.0.0/8"
    let overrides = settings.get_value::<String, _>("ProxyOverride").ok().map(|o| {
        o.split(';')
            .map(str::trim)
            .filter(|e| !e.is_empty() && *e != "<local>")
            .map(|e| wildcard_to_cidr(e).unwrap_or_else(|| e.trim_start_matches('*').to_string()))
            .collect::<Vec<_>>()
            .join(",")
    });
    Some(Proxy {
        url: with_scheme(&url),
        user: None,
        password: None,
        no_proxy: join_no_proxy(overrides),
        source: "system",
    })
}

#[cfg(windows)]
fn wildcard_to_cidr(value: &str) -> Option<String> {
    let parts: Vec<&str> = value.split('.').collect();
    let first = parts.iter().position(|p| *p == "*")?;
    if first == 0 || parts.len() != 4 || parts[first..].iter().any(|p| *p != "*") {
        return None;
    }
    let mut octets = [0u8; 4];
    for (i, p) in parts[..first].iter().enumerate() {
        octets[i] = p.parse().ok()?;
    }
    Some(format!("{}.{}.{}.{}/{}", octets[0], octets[1], octets[2], octets[3], first * 8))
}

// Linux desktops have no common API for this: the environment is the system setting there
#[cfg(not(any(target_os = "macos", windows)))]
fn from_os() -> Option<Proxy> {
    None
}

pub fn system() -> Option<Proxy> {
    from_env().or_else(from_os)
}

// The proxy to use now, according to the settings
pub fn current() -> Option<Proxy> {
    let s = store().vault["settings"].clone();
    let get = |k: &str| non_empty(s[k].as_str().map(str::to_string));
    match s["proxyMode"].as_str().unwrap_or("system") {
        "none" => None,
        "manual" => Some(Proxy {
            url: with_scheme(&get("proxyUrl")?),
            user: get("proxyUser"),
            password: get("proxyPassword"),
            no_proxy: join_no_proxy(get("proxyNoProxy")),
            source: "manual",
        }),
        _ => system(),
    }
}

// HTTP client for the AWS SDK: same TLS as the SDK's default client, with our proxy rules
pub fn http_client() -> SharedHttpClient {
    let config = match current() {
        Some(p) => match ProxyConfig::all(p.url.as_str()) {
            Ok(mut c) => {
                if let Some(user) = p.user {
                    c = c.with_basic_auth(user, p.password.unwrap_or_default());
                }
                c.no_proxy(p.no_proxy)
            }
            Err(_) => ProxyConfig::disabled(),
        },
        None => ProxyConfig::disabled(),
    };
    aws_smithy_http_client::Builder::new().build_with_connector_fn(move |settings, components| {
        let mut b = aws_smithy_http_client::Connector::builder()
            .tls_provider(tls::Provider::Rustls(CryptoMode::AwsLc))
            .proxy_config(config.clone());
        b.set_connector_settings(settings.cloned());
        if let Some(c) = components {
            b.set_sleep_impl(c.sleep_impl());
        }
        b.build()
    })
}

// reqwest client builder with the same proxy rules (reqwest would otherwise apply its own detection)
pub fn reqwest_builder() -> reqwest::ClientBuilder {
    let b = reqwest::Client::builder().no_proxy();
    let Some(p) = current() else { return b };
    match reqwest::Proxy::all(&p.url) {
        Ok(mut proxy) => {
            if let Some(user) = &p.user {
                proxy = proxy.basic_auth(user, p.password.as_deref().unwrap_or(""));
            }
            b.proxy(proxy.no_proxy(reqwest::NoProxy::from_string(&p.no_proxy)))
        }
        Err(_) => b,
    }
}

// What Settings shows: the proxy in use (never the password) or the system one
#[tauri::command]
pub fn proxy_status() -> Value {
    let describe = |p: &Option<Proxy>| match p {
        Some(p) => json!({ "url": p.url, "source": p.source, "noProxy": p.no_proxy }),
        None => Value::Null,
    };
    json!({ "current": describe(&current()), "system": describe(&system()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheme_and_bypass() {
        assert_eq!(with_scheme("proxy:3128"), "http://proxy:3128");
        assert_eq!(with_scheme(" https://p:443 "), "https://p:443");
        assert_eq!(join_no_proxy(Some(" .corp ".into())), "localhost,127.0.0.1,::1,.corp");
        assert_eq!(join_no_proxy(Some("".into())), LOOPBACK);
    }
}
