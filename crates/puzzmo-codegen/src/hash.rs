//! Source hashing, byte-compatible with hashFiles() in scripts/lib/regenCache.ts.
//!
//! The digest covers each file's repo-relative path and its contents, over a sorted
//! file list, so renames and reorderings both invalidate. Paths are repo-relative
//! (not absolute) so a cache stays valid when the checkout moves.

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Returns a sha256 digest of the contents (and paths) of the given repo-relative files.
pub fn hash_files(root: &Path, relative_paths: &[String]) -> Result<String> {
    let mut sorted: Vec<&String> = relative_paths.iter().collect();
    sorted.sort();

    let mut hasher = Sha256::new();
    for rel in sorted {
        let bytes = std::fs::read(root.join(rel)).with_context(|| format!("hashing {rel}"))?;
        hasher.update(rel.as_bytes());
        hasher.update(&bytes);
    }

    Ok(format!("{:x}", hasher.finalize()))
}
