#![deny(clippy::all)]

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use aho_corasick::{AhoCorasick, MatchKind};
use lazy_static::lazy_static;

lazy_static! {
    static ref GUILD_MATCHERS: Mutex<HashMap<String, GuildMatcher>> = Mutex::new(HashMap::new());
}

struct GuildMatcher {
    ac: AhoCorasick,
    original_keywords: Vec<String>,
    pattern_to_keyword: Vec<String>,
}

fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn check_boundaries(content: &str, start: usize, end: usize) -> bool {
    if !content.is_char_boundary(start) || !content.is_char_boundary(end) {
        return false;
    }

    let left_ok = if start == 0 {
        true
    } else {
        if let Some(prev_char) = content[..start].chars().next_back() {
            !is_word_char(prev_char)
        } else {
            true
        }
    };

    if !left_ok {
        return false;
    }

    let right_ok = if end == content.len() {
        true
    } else {
        if let Some(next_char) = content[end..].chars().next() {
            !is_word_char(next_char)
        } else {
            true
        }
    };

    right_ok
}

#[napi]
pub fn find_matches(guild_id: String, content: String, keywords: Vec<String>) -> Result<Vec<String>> {
    let mut matchers = GUILD_MATCHERS.lock().unwrap();

    let rebuild = match matchers.get(&guild_id) {
        Some(m) => m.original_keywords != keywords,
        None => true,
    };

    if rebuild {
        let mut patterns = Vec::new();
        let mut pattern_to_keyword = Vec::new();

        for kw in &keywords {
            patterns.push(kw.clone());
            pattern_to_keyword.push(kw.clone());

            patterns.push(format!("{}'s", kw));
            pattern_to_keyword.push(kw.clone());
        }

        let ac = AhoCorasick::builder()
            .ascii_case_insensitive(true)
            .match_kind(MatchKind::LeftmostFirst)
            .build(&patterns)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to build AhoCorasick: {}", e)))?;

        matchers.insert(guild_id.clone(), GuildMatcher {
            ac,
            original_keywords: keywords.clone(),
            pattern_to_keyword,
        });
    }

    let matcher = matchers.get(&guild_id).unwrap();
    let mut found = HashSet::new();

    for mat in matcher.ac.find_iter(&content) {
        if check_boundaries(&content, mat.start(), mat.end()) {
            let original = &matcher.pattern_to_keyword[mat.pattern()];
            found.insert(original.clone());
        }
    }

    Ok(found.into_iter().collect())
}
