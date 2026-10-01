//! Native front end for the API codegen pipeline.
//!
//! `gate` answers "does `yarn workspace api script regenerate` have anything to do?" fast enough
//! to sit in a post-merge hook, and `run` executes any of the seven steps, all of which live here.

use puzzmo_codegen::{gate, manifest, steps};

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "\
puzzmo-codegen - the API codegen pipeline

USAGE:
    puzzmo-codegen gate [--quiet]
    puzzmo-codegen run <step> [--check]

COMMANDS:
    gate    Exit 0 when every codegen artifact is up to date, 1 when something needs
            regenerating (the stale steps are listed on stderr). Any other exit code
            is a real failure and should not be treated as \"up to date\".

    run     Run one regenerate step:

              prisma-enums          enums.sdl.ts and studio's enums.ts
              api-schema            api-schema.graphql
              shared-flags          packages/shared flagsMetadata.generated.ts
              shared-stats-runtime  packages/shared statsAPIRuntime.ts
              sdl-codegen           the API's types/*.d.ts resolver types
              studio-json-schemas   the host API JSON schemas
              expression-schemas    studio's puzzle-daily-schema.json

OPTIONS:
    --quiet  Suppress the stale-step listing.
    --check  For `run`: report whether the step would change its outputs, and write
             nothing. Exits 1 when it would, which is how CI proves the port still
             matches the committed artifacts.
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    match run(&args) {
        Ok(code) => code,
        Err(err) => {
            eprintln!("puzzmo-codegen: {err:#}");
            // 2 keeps real failures distinguishable from "stale" so callers never
            // mistake a crash for a clean tree.
            ExitCode::from(2)
        }
    }
}

fn run(args: &[String]) -> Result<ExitCode> {
    // A mistyped `--chek` must not be ignored: it would turn a dry run into a real write.
    if let Some(unknown) = args.iter().find(|a| a.starts_with('-') && *a != "--quiet" && *a != "--check") {
        eprintln!("unknown option `{unknown}`; run with no arguments for usage");
        return Ok(ExitCode::from(2));
    }

    let quiet = args.iter().any(|a| a == "--quiet");
    let check = args.iter().any(|a| a == "--check");
    let mut positional = args.iter().filter(|a| !a.starts_with('-'));

    match positional.next().map(String::as_str) {
        Some("gate") => gate_command(quiet),
        Some("run") => run_command(positional.next().map(String::as_str), check),
        Some(other) => {
            eprintln!("unknown command `{other}`; run with no arguments for usage");
            Ok(ExitCode::from(2))
        }
        None => {
            eprint!("{USAGE}");
            Ok(ExitCode::from(2))
        }
    }
}

/// Runs (or, with --check, dry-runs) one ported step.
fn run_command(step: Option<&str>, check: bool) -> Result<ExitCode> {
    let Some(step) = step else {
        eprintln!("run needs a step name\n\n{USAGE}");
        return Ok(ExitCode::from(2));
    };
    let root = find_repo_root().context("locating the repo root")?;

    let outputs: Vec<(&str, String)> = match step {
        "prisma-enums" => {
            let (sdl, studio) = steps::prisma_enums::render(&root)?;
            vec![(steps::prisma_enums::SDL_OUTPUT, sdl), (steps::prisma_enums::STUDIO_OUTPUT, studio)]
        }
        "api-schema" => {
            vec![(steps::api_schema::OUTPUT, steps::api_schema::render(&root)?)]
        }
        "studio-json-schemas" => steps::studio_json_schemas::render(&root)?,
        "sdl-codegen" => steps::sdl_codegen::render(&root)?
            .files
            .into_iter()
            .map(|(path, contents)| (Box::leak(path.into_boxed_str()) as &'static str, contents))
            .collect(),
        "shared-stats-runtime" => {
            vec![(steps::shared_stats::OUTPUT, steps::shared_stats::render(&root)?)]
        }
        "shared-flags" => {
            vec![(steps::shared_flags::OUTPUT, steps::shared_flags::render(&root)?)]
        }
        "expression-schemas" => {
            vec![(steps::expression_schemas::OUTPUT, steps::expression_schemas::render(&root)?)]
        }
        other => {
            eprintln!("unknown step `{other}`; run with no arguments for the list");
            return Ok(ExitCode::from(2));
        }
    };

    if !check {
        for (path, contents) in &outputs {
            let full = root.join(path);
            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
            }
            std::fs::write(&full, contents).with_context(|| format!("writing {path}"))?;
        }
        return Ok(ExitCode::SUCCESS);
    }

    let mut differing = Vec::new();
    for (path, contents) in &outputs {
        // A missing output counts as differing, but an unreadable one is a real error: reading it
        // as empty would let a permissions problem pass as "would change" or, worse, pass as equal
        // when the expected output is itself empty.
        let on_disk = match std::fs::read_to_string(root.join(path)) {
            Ok(text) => Some(text),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error).with_context(|| format!("reading {path}")),
        };
        if on_disk.as_ref() != Some(contents) {
            differing.push(*path);
        }
    }

    if differing.is_empty() {
        return Ok(ExitCode::SUCCESS);
    }
    eprintln!("{step} would change: {}", differing.join(", "));
    Ok(ExitCode::FAILURE)
}

fn gate_command(quiet: bool) -> Result<ExitCode> {
    let root = find_repo_root().context("locating the repo root")?;
    let report = gate::check(&root)?;

    if report.is_fresh() {
        return Ok(ExitCode::SUCCESS);
    }

    if !quiet {
        let noun = if report.stale.len() == 1 { "step" } else { "steps" };
        eprintln!("Codegen is out of date ({} {noun}): {}", report.stale.len(), report.stale.join(", "));
    }
    Ok(ExitCode::FAILURE)
}

/// Walks up from the working directory looking for the checkout that holds the manifest.
fn find_repo_root() -> Result<PathBuf> {
    let start = std::env::current_dir()?;
    let mut dir: &Path = &start;

    loop {
        if dir.join(manifest::MANIFEST_PATH).is_file() {
            return Ok(dir.to_path_buf());
        }
        dir = dir.parent().with_context(|| format!("no repo root above {}", start.display()))?;
    }
}
