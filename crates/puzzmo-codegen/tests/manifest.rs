//! Validates regenerate.manifest.json against the real checkout.
//!
//! The gate treats a missing input as "stale" rather than an error, so a typo in the manifest
//! would otherwise degrade silently into "regenerate runs on every pull". These tests are what
//! actually catch that, and they rely on the generated artifacts being committed.
//!
//! The crate is mirrored into puzzmo-com/oss to be built and published from there, and that
//! checkout holds only the crate -- no manifest, no generated artifacts. So every test here
//! no-ops when the manifest is absent: these assert things about the monorepo, and the
//! monorepo's own CI is where they are meant to run.

use std::path::{Path, PathBuf};

#[path = "../src/hash.rs"]
mod hash;
#[path = "../src/manifest.rs"]
mod manifest;

use manifest::{MANIFEST_PATH, Manifest};

/// The monorepo root, or None when the crate is being built outside it (the OSS mirror).
fn monorepo_root() -> Option<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().ok()?;
    root.join(MANIFEST_PATH).is_file().then_some(root)
}

/// Returns the repo root, or skips the test when there is no monorepo around the crate.
macro_rules! root_or_skip {
    () => {
        match monorepo_root() {
            Some(root) => root,
            None => {
                eprintln!("skipping: no monorepo around the crate (OSS mirror build)");
                return;
            }
        }
    };
}

#[test]
fn every_literal_input_exists() {
    let root = root_or_skip!();
    let manifest = Manifest::load(&root).expect("manifest loads");

    for step in &manifest.steps {
        for input in &step.inputs {
            if input.contains(['*', '?', '[', '{']) {
                continue;
            }
            assert!(root.join(input).is_file(), "step {}: input {input} does not exist", step.key);
        }
    }
}

#[test]
fn every_glob_input_matches_something() {
    let root = root_or_skip!();
    let manifest = Manifest::load(&root).expect("manifest loads");

    for step in &manifest.steps {
        let resolved = step.resolve_inputs(&root).expect("inputs resolve");
        assert!(!resolved.is_empty(), "step {}: no inputs matched, has a directory moved?", step.key);
    }
}

#[test]
fn every_output_is_committed() {
    let root = root_or_skip!();
    let manifest = Manifest::load(&root).expect("manifest loads");

    for step in &manifest.steps {
        for output in &step.outputs {
            assert!(root.join(output).is_file(), "step {}: output {output} is missing", step.key);
        }
    }
}

#[test]
fn excludes_keep_test_files_out() {
    let root = root_or_skip!();
    let manifest = Manifest::load(&root).expect("manifest loads");
    let sdl = manifest.steps.iter().find(|s| s.key == "sdl-codegen").expect("sdl-codegen step");

    let resolved = sdl.resolve_inputs(&root).expect("inputs resolve");
    assert!(resolved.iter().any(|f| f.contains("/services/")), "expected service files in the input set");
    assert!(!resolved.iter().any(|f| f.ends_with(".test.ts")), "test files should be excluded");
}

#[test]
fn hashing_is_stable_and_order_independent() {
    let root = root_or_skip!();
    let manifest = Manifest::load(&root).expect("manifest loads");
    let step = &manifest.steps[0];

    let inputs = step.resolve_inputs(&root).expect("inputs resolve");
    let mut reversed = inputs.clone();
    reversed.reverse();

    let once = hash::hash_files(&root, &inputs).expect("hash");
    let twice = hash::hash_files(&root, &inputs).expect("hash");
    let backwards = hash::hash_files(&root, &reversed).expect("hash");

    assert_eq!(once, twice, "hashing is not deterministic");
    assert_eq!(once, backwards, "hashing depends on input order");
}
