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


use puzzmo_codegen::hash;
use puzzmo_codegen::manifest::{MANIFEST_PATH, Manifest};
use puzzmo_codegen::steps;

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

/// The port is only correct if it reproduces what the TypeScript committed, byte for byte.
/// This is the regression test for every step as it moves across; a failure means the Rust
/// drifted from the artifacts in git, not that the artifacts are stale.
#[test]
fn prisma_enums_matches_the_committed_output() {
    let root = root_or_skip!();
    let (sdl, studio) = steps::prisma_enums::render(&root).expect("renders");

    for (path, rendered) in [(steps::prisma_enums::SDL_OUTPUT, sdl), (steps::prisma_enums::STUDIO_OUTPUT, studio)] {
        let committed = std::fs::read_to_string(root.join(path)).expect("committed artifact exists");
        assert_eq!(rendered, committed, "{path} differs from the committed artifact");
    }
}

#[test]
fn expression_schemas_matches_the_committed_output() {
    let root = root_or_skip!();
    let rendered = steps::expression_schemas::render(&root).expect("renders");
    let committed =
        std::fs::read_to_string(root.join(steps::expression_schemas::OUTPUT)).expect("committed artifact exists");

    assert_eq!(rendered, committed, "the expression schema differs from the committed artifact");
}

#[test]
fn shared_flags_matches_the_committed_output() {
    let root = root_or_skip!();
    let rendered = steps::shared_flags::render(&root).expect("renders");
    let committed = std::fs::read_to_string(root.join(steps::shared_flags::OUTPUT)).expect("committed artifact exists");

    assert_eq!(rendered, committed, "the flags metadata differs from the committed artifact");
}

/// api-schema is the one step whose output is deliberately not byte-identical: it is printed in a
/// deterministic order rather than the order graphql-js happened to emit. So this checks the
/// properties that matter instead -- it re-parses, every type appears once, and no type carries a
/// duplicate member (the bug that made graphql-js reject an earlier version of the merge).
#[test]
fn api_schema_is_valid_and_deduplicated() {
    let root = root_or_skip!();
    let rendered = steps::api_schema::render(&root).expect("renders");

    let document = graphql_parser::parse_schema::<String>(&rendered).expect("output re-parses as SDL");

    let mut names = std::collections::HashSet::new();
    for definition in &document.definitions {
        use graphql_parser::schema::{Definition, TypeDefinition};
        let (name, members) = match definition {
            Definition::TypeDefinition(TypeDefinition::Object(t)) => {
                (&t.name, t.fields.iter().map(|f| f.name.clone()).collect::<Vec<_>>())
            }
            Definition::TypeDefinition(TypeDefinition::InputObject(t)) => {
                (&t.name, t.fields.iter().map(|f| f.name.clone()).collect())
            }
            Definition::TypeDefinition(TypeDefinition::Enum(t)) => {
                (&t.name, t.values.iter().map(|v| v.name.clone()).collect())
            }
            _ => continue,
        };

        assert!(names.insert(name.clone()), "{name} is defined more than once");

        let unique: std::collections::HashSet<_> = members.iter().collect();
        assert_eq!(unique.len(), members.len(), "{name} has duplicate members");
    }

    assert!(rendered.contains("type Query"), "the schema has no Query type");
    assert!(!rendered.contains("scalar ID"), "built-in scalars should not be declared");
}

#[test]
fn shared_stats_matches_the_committed_output() {
    let root = root_or_skip!();
    let rendered = steps::shared_stats::render(&root).expect("renders");
    let committed = std::fs::read_to_string(root.join(steps::shared_stats::OUTPUT)).expect("committed artifact exists");

    assert_eq!(rendered, committed, "the stats runtime differs from the committed artifact");
}

/// The studio schemas are checked semantically rather than byte for byte: descriptions are
/// annotations with no effect on what a document validates against, and reproducing the exact
/// prose wrapping ts-json-schema-generator produced is not worth the machinery. Anything that
/// changes what the schema accepts is a failure.
#[test]
fn studio_json_schemas_still_validate_the_same_documents() {
    let root = root_or_skip!();
    let outputs = steps::studio_json_schemas::render(&root).expect("renders");

    for (path, contents) in outputs {
        if !path.ends_with(".json") {
            continue;
        }
        let mut generated: serde_json::Value = serde_json::from_str(&contents).expect("valid JSON");
        let mut committed: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(path)).expect("artifact exists")).unwrap();
        strip_annotations(&mut generated);
        strip_annotations(&mut committed);

        let changes = json_schema_diff::diff(committed, generated).expect("schemas are comparable");
        assert!(changes.is_empty(), "{path} changed what it accepts: {changes:?}");
    }
}

/// Removes keywords that describe a schema without constraining it.
fn strip_annotations(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for key in ["description", "examples", "title"] {
                map.remove(key);
            }
            for (_, child) in map.iter_mut() {
                strip_annotations(child);
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(strip_annotations),
        _ => {}
    }
}

/// Every generated resolver type, byte for byte. These feed tsc for the whole API, so unlike the
/// JSON schemas there is no room for "equivalent": a changed type is a changed build.
#[test]
fn sdl_codegen_matches_the_committed_output() {
    let root = root_or_skip!();
    let generated = steps::sdl_codegen::render(&root).expect("renders");
    assert!(generated.files.len() > 100, "expected the full set of service types, got {}", generated.files.len());

    for (path, contents) in &generated.files {
        let committed = std::fs::read_to_string(root.join(path)).unwrap_or_else(|_| panic!("{path} is not committed"));
        assert_eq!(*contents, committed, "{path} differs from the committed artifact");
    }
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
