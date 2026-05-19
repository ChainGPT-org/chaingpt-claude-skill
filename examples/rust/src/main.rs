// ChainGPT AI News fetch — minimal Rust example.
//
// Demonstrates calling the public ChainGPT AI News endpoint with reqwest (blocking)
// + serde. No SDK dependency. Single source file.
//
// Run:
//   cd examples/rust
//   CHAINGPT_API_KEY=… cargo run --release
//
// Endpoint reference: https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk

use serde::{Deserialize, Serialize};
use std::env;
use std::process;
use std::time::Duration;

const NEWS_API_BASE: &str = "https://api.chaingpt.org/news/getNews";

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct NewsRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort_by: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort_order: Option<&'static str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    languages: Vec<&'static str>,
}

#[derive(Deserialize, Debug)]
struct NewsItem {
    #[allow(dead_code)] // surfaced via Debug, not the printout below
    id: i64,
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default, rename = "publishedAt")]
    published_at: String,
}

#[derive(Deserialize, Debug)]
struct NewsResponse {
    data: Vec<NewsItem>,
}

fn main() {
    let api_key = match env::var("CHAINGPT_API_KEY") {
        Ok(v) if !v.is_empty() => v,
        _ => {
            eprintln!("CHAINGPT_API_KEY not set. Get one at https://app.chaingpt.org");
            process::exit(1);
        }
    };
    let api_base = env::var("CHAINGPT_API_BASE").unwrap_or_else(|_| NEWS_API_BASE.to_string());

    let req = NewsRequest {
        limit: Some(5),
        sort_by: Some("publishedAt"),
        sort_order: Some("DESC"),
        languages: vec!["en"],
    };

    match fetch_news(&api_base, &api_key, &req) {
        Ok(resp) => {
            println!("=== Latest {} crypto-news items ===\n", resp.data.len());
            for (i, item) in resp.data.iter().enumerate() {
                println!("[{}] {}", i + 1, item.title);
                if !item.url.is_empty() {
                    println!("    {}", item.url);
                }
                if !item.published_at.is_empty() {
                    println!("    {}", item.published_at);
                }
                println!();
            }
        }
        Err(err) => {
            eprintln!("error: {err}");
            process::exit(1);
        }
    }
}

fn fetch_news(api_base: &str, api_key: &str, req: &NewsRequest) -> Result<NewsResponse, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("chaingpt-news-example-rs/1.0")
        .build()
        .map_err(|e| format!("build client: {e}"))?;

    let res = client
        .post(api_base)
        .bearer_auth(api_key)
        .header("Accept", "application/json")
        .json(req)
        .send()
        .map_err(|e| format!("http: {e}"))?;

    let status = res.status();
    let body = res.text().map_err(|e| format!("read body: {e}"))?;

    if !status.is_success() {
        // Surface the upstream message verbatim so the developer can debug auth issues etc.
        return Err(format!("HTTP {status}: {body}"));
    }

    serde_json::from_str::<NewsResponse>(&body)
        .map_err(|e| format!("decode JSON: {e} (body={body})"))
}
