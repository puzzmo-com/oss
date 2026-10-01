//! Native front end for the API codegen pipeline.
//!
//! Today it only answers "does `yarn workspace api script regenerate` have anything to do?",
//! fast enough to sit in a post-merge hook. The regenerate steps themselves move here over time.

mod gate;
mod hash;
mod manifest;

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "\
puzzmo-codegen - native front end for the API codegen pipeline

USAGE:
    puzzmo-codegen gate [--quiet]

COMMANDS:
    gate    Exit 0 when every codegen artifact is up to date, 1 when something needs
            regenerating (the stale steps are listed on stderr). Any other exit code
            is a real failure and should not be treated as \"up to date\".

OPTIONS:
    --quiet  Suppress the stale-step listing.
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
    let quiet = args.iter().any(|a| a == "--quiet");
    let command = args.iter().find(|a| !a.starts_with('-'));

    match command.map(String::as_str) {
        Some("gate") => gate_command(quiet),
        Some(other) => {
            eprintln!("unknown command: {other}\n\n{USAGE}");
            Ok(ExitCode::from(2))
        }
        None => {
            eprint!("{USAGE}");
            Ok(ExitCode::from(2))
        }
    }
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
