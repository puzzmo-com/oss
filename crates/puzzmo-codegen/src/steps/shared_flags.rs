//! Generates packages/shared/flags/flagsMetadata.generated.ts from the flags enums.
//!
//! Replaces packages/shared/scripts/generateFlagsMetadata.ts, which walked the enums with
//! typescript-go's unstable AST API. The output is plain string building -- the file is in
//! oxfmt's ignorePatterns, so no formatter is involved.

use anyhow::{Context, Result};
use oxc_allocator::Allocator;
use oxc_ast::ast::{Declaration, Expression, TSEnumMemberName};
use oxc_span::GetSpan;
use std::path::Path;

use crate::steps::collapse_empty;
use crate::ts;

pub const OUTPUT: &str = "packages/shared/flags/flagsMetadata.generated.ts";
const FLAGS_DIR: &str = "packages/shared/flags";

struct FlagsEnum {
    name: String,
    index: i64,
    source_file: String,
    flags: Vec<Flag>,
}

struct Flag {
    name: String,
    description: String,
    deprecated: bool,
    deprecation_message: Option<String>,
    bit_position: i64,
}

pub fn render(root: &Path) -> Result<String> {
    let dir = root.join(FLAGS_DIR);
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .with_context(|| format!("reading {}", dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.ends_with(".ts") && !name.contains(".generated.")
        })
        .collect();
    files.sort();

    let mut enums = Vec::new();
    for file in &files {
        let source = std::fs::read_to_string(file).with_context(|| format!("reading {}", file.display()))?;
        let name = file.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
        enums.extend(parse_file(&name, &source)?);
    }

    // The TS sorted with localeCompare; these are ASCII identifiers, so a byte sort matches.
    enums.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(collapse_empty(&generate(&enums)))
}

fn parse_file(file_name: &str, source: &str) -> Result<Vec<FlagsEnum>> {
    let allocator = Allocator::default();
    let program = ts::parse(&allocator, file_name, source)?;

    let mut found = Vec::new();
    for declaration in ts::declarations(&program) {
        let Declaration::TSEnumDeclaration(decl) = declaration else { continue };
        let name = decl.id.name.to_string();

        // `GameFlags1` -> index 0. Without a trailing number the TS skipped the enum.
        let Some(index) = trailing_number(&name) else { continue };

        let mut flags = Vec::new();
        let mut previous_end = decl.body.span.start;

        for member in &decl.body.members {
            let comments = ts::leading_comments(&program, source, previous_end, member.span.start);
            previous_end = member.span.end;

            let (deprecated, deprecation_message) = deprecation(&comments);
            flags.push(Flag {
                name: member_name(&member.id, source),
                description: description(&comments),
                deprecated,
                deprecation_message,
                bit_position: bit_position(member.initializer.as_ref()),
            });
        }

        found.push(FlagsEnum { name, index: index - 1, source_file: file_name.to_string(), flags });
    }

    Ok(found)
}

fn member_name(id: &TSEnumMemberName, source: &str) -> String {
    match id {
        TSEnumMemberName::Identifier(ident) => ident.name.to_string(),
        other => ts::text(source, other.span()).to_string(),
    }
}

/// The bit position from `1 << n`, or log2 of a bare numeric value, matching the TS fallbacks.
fn bit_position(initializer: Option<&Expression>) -> i64 {
    match initializer {
        Some(Expression::BinaryExpression(binary)) => {
            if !matches!(binary.operator, oxc_ast::ast::BinaryOperator::ShiftLeft) {
                return -1;
            }
            match &binary.right {
                Expression::NumericLiteral(number) => number.value as i64,
                _ => -1,
            }
        }
        Some(Expression::NumericLiteral(number)) => (number.value as f64).log2() as i64,
        _ => -1,
    }
}

/// The first `/** */` block's text, with leading stars and any @deprecated line removed.
fn description(comments: &[&str]) -> String {
    for comment in comments {
        let Some(inner) = comment.strip_prefix("/**").and_then(|c| c.strip_suffix("*/")) else { continue };

        let cleaned: Vec<String> = inner
            .lines()
            .map(|line| strip_leading_star(line))
            // `.replace(/@deprecated.*$/gm, "")` drops from the tag to end of line.
            .map(|line| match line.find("@deprecated") {
                Some(at) => line[..at].to_string(),
                None => line.to_string(),
            })
            .collect();

        return cleaned.join("\n").trim().to_string();
    }
    String::new()
}

/// Whether any leading comment carries @deprecated, and the message after it.
fn deprecation(comments: &[&str]) -> (bool, Option<String>) {
    for comment in comments {
        let Some(at) = comment.find("@deprecated") else { continue };

        let rest = &comment[at + "@deprecated".len()..];
        // The TS regex `@deprecated\s*(.*)` stops at the end of that line.
        let line = rest.lines().next().unwrap_or("");
        let message = line.trim_start().trim_end().trim_end_matches("*/").trim();

        return (true, (!message.is_empty()).then(|| message.to_string()));
    }
    (false, None)
}

/// Removes the ` * ` a JSDoc line starts with, keeping at most one following space consumed.
fn strip_leading_star(line: &str) -> String {
    let trimmed = line.trim_start();
    match trimmed.strip_prefix('*') {
        Some(rest) => rest.strip_prefix(' ').unwrap_or(rest).to_string(),
        None => line.to_string(),
    }
}

fn trailing_number(name: &str) -> Option<i64> {
    let digits: String = name.chars().rev().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        return None;
    }
    digits.chars().rev().collect::<String>().parse().ok()
}

/// JSON.stringify of a string, which is what the TS used for every emitted literal.
fn json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| format!("{value:?}"))
}

fn generate(enums: &[FlagsEnum]) -> String {
    let mut lines: Vec<String> = vec![
        "/* This file is codegen'd - do not edit manually!".into(),
        "   Run: yarn workspace @puzzmo-com/shared codegen:flags".into(),
        " */".into(),
        String::new(),
        "/** Information about a single flag in a flags enum */".into(),
        "export type FlagInfo = {".into(),
        "  /** The flag name as it appears in the enum */".into(),
        "  name: string".into(),
        "  /** Description from JSDoc comment */".into(),
        "  description: string".into(),
        "  /** Whether this flag is deprecated */".into(),
        "  deprecated: boolean".into(),
        "  /** Deprecation message if deprecated */".into(),
        "  deprecationMessage?: string".into(),
        "  /** The bit position (e.g., 3 for 1 << 3) */".into(),
        "  bitPosition: number".into(),
        "}".into(),
        String::new(),
        "/** Metadata about a flags enum */".into(),
        "export type FlagsEnumMetadata = {".into(),
        "  /** The enum name (e.g., \"PublishingPartnerFlags1\") */".into(),
        "  enumName: string".into(),
        "  /** The index in the flags array (0 for Flags1, 1 for Flags2, etc.) */".into(),
        "  index: number".into(),
        "  /** Source file this enum is defined in */".into(),
        "  sourceFile: string".into(),
        "  /** All flags in this enum */".into(),
        "  flags: FlagInfo[]".into(),
        "}".into(),
        String::new(),
    ];

    for meta in enums {
        lines.push(format!("export const {}: FlagsEnumMetadata = {{", var_name(&meta.name)));
        lines.push(format!("  enumName: {},", json_string(&meta.name)));
        lines.push(format!("  index: {},", meta.index));
        lines.push(format!("  sourceFile: {},", json_string(&meta.source_file)));
        lines.push("  flags: [".into());

        for flag in &meta.flags {
            lines.push("    {".into());
            lines.push(format!("      name: {},", json_string(&flag.name)));
            lines.push(format!("      description: {},", json_string(&flag.description)));
            lines.push(format!("      deprecated: {},", flag.deprecated));
            if let Some(message) = &flag.deprecation_message {
                lines.push(format!("      deprecationMessage: {},", json_string(message)));
            }
            lines.push(format!("      bitPosition: {},", flag.bit_position));
            lines.push("    },".into());
        }

        lines.push("  ],".into());
        lines.push("}".into());
        lines.push(String::new());
    }

    lines.push("/** All flags metadata indexed by enum name */".into());
    lines.push("export const allFlagsMetadata: Record<string, FlagsEnumMetadata> = {".into());
    for meta in enums {
        lines.push(format!("  {}: {},", meta.name, var_name(&meta.name)));
    }
    lines.push("}".into());

    format!("{}\n", lines.join("\n"))
}

fn var_name(enum_name: &str) -> String {
    let mut chars = enum_name.chars();
    match chars.next() {
        Some(first) => format!("{}{}Metadata", first.to_lowercase(), chars.as_str()),
        None => "Metadata".into(),
    }
}
