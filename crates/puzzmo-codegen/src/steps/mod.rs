//! The regenerate pipeline's steps, ported from apps/api.puzzmo.com/scripts one at a time.
//!
//! Each step owns its own inputs and outputs, which must stay in sync with the matching entry
//! in regenerate.manifest.json -- the gate decides whether to run from that file, not from here.

pub mod api_schema;
pub mod expression_schemas;
pub mod prisma_enums;
pub mod sdl_codegen;
pub mod shared_flags;
pub mod shared_stats;
pub mod studio_json_schemas;

/// Collapses empty arrays and objects onto one line, as both shared codegen scripts did.
/// Mirrors their collapseEmpty: `[\s*]` and `{\s*}` close up, and 3+ newlines become 2.
pub fn collapse_empty(source: &str) -> String {
    let mut out = collapse_pair(source, '[', ']');
    out = collapse_pair(&out, '{', '}');

    // `.replace(/\n{3,}/g, "\n\n")`
    while out.contains("\n\n\n") {
        out = out.replace("\n\n\n", "\n\n");
    }
    out
}

/// Replaces `open` + whitespace + `close` with `open``close`.
fn collapse_pair(source: &str, open: char, close: char) -> String {
    let bytes: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == open {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j].is_whitespace() {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == close {
                out.push(open);
                out.push(close);
                i = j + 1;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }

    out
}
