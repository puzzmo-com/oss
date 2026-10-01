//! The staleness check: decides whether `regenerate` has anything to do, without booting Node.

use anyhow::Result;
use std::path::Path;

use crate::hash::hash_files;
use crate::manifest::{CACHE_DIR, Manifest};

pub struct Report {
    pub stale: Vec<String>,
}

impl Report {
    pub fn is_fresh(&self) -> bool {
        self.stale.is_empty()
    }
}

/// Checks every manifest step against its cached hash and its outputs on disk.
pub fn check(root: &Path) -> Result<Report> {
    let manifest = Manifest::load(root)?;
    let mut stale = Vec::new();

    for step in &manifest.steps {
        let inputs = step.resolve_inputs(root)?;
        let hash = hash_files(root, &inputs)?;

        if !step.outputs_exist(root) || cached_hash(root, &step.key).as_deref() != Some(hash.as_str()) {
            stale.push(step.key.clone());
        }
    }

    Ok(Report { stale })
}

/// The hash recorded by the last successful run of a step, if any.
fn cached_hash(root: &Path, key: &str) -> Option<String> {
    // Read-and-discard-errors rather than exists-then-read: a file vanishing mid-check
    // (concurrent run, partial node_modules clean) should read as a miss, not an error.
    std::fs::read_to_string(root.join(CACHE_DIR).join(format!("{key}.hash")))
        .ok()
        .map(|s| s.trim().to_string())
}
