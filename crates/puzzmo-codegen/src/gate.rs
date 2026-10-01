//! The staleness check: decides whether `regenerate` has anything to do, without booting Node.

use anyhow::{Context, Result};
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
        // The key becomes a filename under the cache directory, so a separator in it would
        // write outside that directory.
        if step.key.contains('/') || step.key.contains('\\') || step.key.contains("..") {
            anyhow::bail!("manifest step key `{}` is not usable as a filename", step.key);
        }
        let inputs = step.resolve_inputs(root)?;
        let hash = hash_files(root, &inputs)?;

        if !step.outputs_exist(root) || cached_hash(root, &step.key)?.as_deref() != Some(hash.as_str()) {
            stale.push(step.key.clone());
        }
    }

    Ok(Report { stale })
}

/// The hash recorded by the last successful run of a step, if any.
fn cached_hash(root: &Path, key: &str) -> Result<Option<String>> {
    // A missing file means the step has never run. Anything else -- permissions, a bad
    // encoding -- is surfaced rather than silently reported as stale on every run.
    match std::fs::read_to_string(root.join(CACHE_DIR).join(format!("{key}.hash"))) {
        Ok(text) => Ok(Some(text.trim().to_string())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("reading the cached hash for {key}")),
    }
}
