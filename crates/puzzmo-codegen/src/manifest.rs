//! Loads regenerate.manifest.json and resolves each step's globs to concrete files.

use anyhow::{Context, Result};
use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Where the manifest lives, relative to the repo root.
pub const MANIFEST_PATH: &str = "apps/api.puzzmo.com/scripts/lib/regenerate.manifest.json";

/// Cache directory holding one `<key>.hash` per step, relative to the repo root.
pub const CACHE_DIR: &str = "apps/api.puzzmo.com/node_modules/.cache/regenerate";

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub steps: Vec<Step>,
}

#[derive(Debug, Deserialize)]
pub struct Step {
    pub key: String,
    pub inputs: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
    pub outputs: Vec<String>,
}

impl Manifest {
    /// Reads and parses the manifest from a repo root.
    pub fn load(root: &Path) -> Result<Manifest> {
        let path = root.join(MANIFEST_PATH);
        let raw = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
        serde_json::from_str(&raw).with_context(|| format!("parsing {}", path.display()))
    }
}

impl Step {
    /// Every input file for this step, repo-relative and sorted, with excludes applied.
    pub fn resolve_inputs(&self, root: &Path) -> Result<Vec<String>> {
        let excludes = build_globset(&self.exclude)?;
        let mut found = Vec::new();

        for pattern in &self.inputs {
            // A missing input is not an error: api-schema.graphql is one step's output and
            // another's input, so it is legitimately absent before the first run. Hashing
            // skips it, which reads as stale against any cache written while it existed.
            for rel in expand(root, pattern)? {
                if !excludes.is_match(&rel) {
                    found.push(rel);
                }
            }
        }

        found.sort();
        found.dedup();
        Ok(found)
    }

    /// True when every declared output is present on disk.
    pub fn outputs_exist(&self, root: &Path) -> bool {
        self.outputs.iter().all(|o| root.join(o).exists())
    }
}

/// Resolves one pattern to repo-relative paths, walking only the directory the pattern is rooted in.
fn expand(root: &Path, pattern: &str) -> Result<Vec<String>> {
    if !is_glob(pattern) {
        let path = root.join(pattern);
        return Ok(if path.is_file() { vec![pattern.to_string()] } else { vec![] });
    }

    let glob = Glob::new(pattern).with_context(|| format!("bad glob {pattern}"))?.compile_matcher();
    let base = root.join(literal_prefix(pattern));
    if !base.is_dir() {
        return Ok(vec![]);
    }

    let mut found = Vec::new();
    let walk = WalkDir::new(&base)
        .into_iter()
        .filter_entry(|e| e.file_name() != "node_modules" && e.file_name() != ".git");

    for entry in walk {
        let entry = entry.context("walking the repo")?;
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry.path().strip_prefix(root).context("path escaped the repo root")?;
        let rel = rel.to_str().context("non-UTF8 path")?;
        if glob.is_match(rel) {
            found.push(rel.to_string());
        }
    }

    Ok(found)
}

/// The leading path components of a pattern that contain no glob metacharacters.
fn literal_prefix(pattern: &str) -> PathBuf {
    pattern.split('/').take_while(|c| !is_glob(c)).collect()
}

fn is_glob(s: &str) -> bool {
    s.contains(['*', '?', '[', '{'])
}

fn build_globset(patterns: &[String]) -> Result<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for p in patterns {
        builder.add(Glob::new(p).with_context(|| format!("bad exclude glob {p}"))?);
    }
    builder.build().context("building exclude globset")
}
