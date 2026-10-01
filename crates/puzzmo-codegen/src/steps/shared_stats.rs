//! Generates packages/shared/statsAPIRuntime.ts from statsAPI.d.ts.
//!
//! Replaces packages/shared/scripts/syncStatsRuntime.ts, which walked the type aliases with
//! typescript-go's unstable AST API and used its emitter to print type nodes back to source.
//! The only types that need printing here are named tuple member annotations, which are simple
//! enough for the small printer in `print_type`.

use anyhow::{Context, Result, bail};
use oxc_allocator::Allocator;
use oxc_ast::ast::{Declaration, TSSignature, TSTupleElement, TSType};
use oxc_span::GetSpan;
use std::path::Path;

use crate::steps::collapse_empty;
use crate::ts;

pub const OUTPUT: &str = "packages/shared/statsAPIRuntime.ts";
const INPUT: &str = "packages/shared/statsAPI.d.ts";

/// Types excluded from codegen entirely.
const SKIP: [&str; 4] = ["GroupPlayRef", "GroupPlayRefs", "_", "DeedKeys"];
/// Types that are generated but not imported back from statsAPI.d.ts.
const NO_IMPORT: [&str; 3] = ["UserAwardsBitmap", "UserAwardsBitmap1", "RaptStatInfo"];

/// One `title: [name: type, ...]` member of a stats type.
struct Group {
    field: String,
    entries: Vec<Entry>,
}

struct Entry {
    name: String,
    type_text: String,
}

enum Alias {
    /// `type X = { field: [a: number, ...] }`
    Object { name: String, groups: Vec<Group> },
    /// `type XBitmap = [a: boolean, ...]`
    Bitmap { name: String, entries: Vec<Entry> },
    /// Something codegen does not emit for, but which still gets imported.
    Other { name: String },
}

impl Alias {
    fn name(&self) -> &str {
        match self {
            Alias::Object { name, .. } | Alias::Bitmap { name, .. } | Alias::Other { name } => name,
        }
    }
}

pub fn render(root: &Path) -> Result<String> {
    let path = root.join(INPUT);
    let source = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;

    let allocator = Allocator::default();
    let program = ts::parse(&allocator, INPUT, &source)?;

    let mut aliases = Vec::new();
    for declaration in ts::declarations(&program) {
        let Declaration::TSTypeAliasDeclaration(alias) = declaration else { continue };
        aliases.push(classify(alias.id.name.as_str(), &alias.type_annotation, &source)?);
    }

    Ok(collapse_empty(&generate(&aliases)))
}

fn classify(name: &str, annotation: &TSType, source: &str) -> Result<Alias> {
    let name = name.to_string();

    match annotation {
        // The TS keyed off the name rather than the shape: "Bitmap" in the name means enum output.
        TSType::TSTupleType(tuple) if name.contains("Bitmap") => {
            Ok(Alias::Bitmap { name, entries: tuple_entries(&tuple.element_types, source)? })
        }
        TSType::TSTypeLiteral(literal) => {
            let mut groups = Vec::new();
            for member in &literal.members {
                let TSSignature::TSPropertySignature(property) = member else { continue };

                let field = property
                    .key
                    .static_name()
                    .context("computed property names are not supported")?
                    .to_string();

                let entries = match property.type_annotation.as_ref().map(|a| &a.type_annotation) {
                    Some(TSType::TSTupleType(tuple)) => tuple_entries(&tuple.element_types, source)?,
                    _ => Vec::new(),
                };
                groups.push(Group { field, entries });
            }
            Ok(Alias::Object { name, groups })
        }
        _ => Ok(Alias::Other { name }),
    }
}

fn tuple_entries(elements: &[TSTupleElement], source: &str) -> Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for element in elements {
        // Only named members carry the name the runtime needs; anything else is skipped, as in the TS.
        if let TSTupleElement::TSNamedTupleMember(member) = element {
            entries.push(Entry {
                name: member.label.name.to_string(),
                type_text: print_tuple_element(&member.element_type, source)?,
            });
        }
    }
    Ok(entries)
}

/// A named member's annotation is itself a tuple element; unwrap it to the plain type.
fn print_tuple_element(element: &TSTupleElement, source: &str) -> Result<String> {
    match element {
        // `[number, number?]` keeps the optional marker on the way out.
        TSTupleElement::TSOptionalType(optional) => {
            Ok(format!("{}?", print_type(&optional.type_annotation, source)?))
        }
        other => match other.as_ts_type() {
            Some(ty) => print_type(ty, source),
            None => bail!("unsupported tuple element `{}`", ts::text(source, other.span())),
        },
    }
}

/// Prints a tuple member's type the way the TypeScript emitter did.
///
/// Only the forms statsAPI.d.ts actually uses are handled: keywords, type references, arrays and
/// unions. Anything else stops the build rather than emitting a guess that silently type-checks.
fn print_type(ty: &TSType, source: &str) -> Result<String> {
    Ok(match ty {
        TSType::TSNumberKeyword(_) => "number".into(),
        TSType::TSStringKeyword(_) => "string".into(),
        TSType::TSBooleanKeyword(_) => "boolean".into(),
        TSType::TSAnyKeyword(_) => "any".into(),
        TSType::TSNullKeyword(_) => "null".into(),
        TSType::TSUndefinedKeyword(_) => "undefined".into(),
        TSType::TSTypeReference(reference) => ts::text(source, reference.span).trim().to_string(),
        TSType::TSArrayType(array) => format!("{}[]", print_type(&array.element_type, source)?),
        // Parens are preserved: the source writes `(number | undefined)[]` and needs them, while
        // a bare `number | undefined` has none to begin with.
        TSType::TSParenthesizedType(inner) => format!("({})", print_type(&inner.type_annotation, source)?),
        // A nested tuple always came out multi-line: members indented four spaces, the closing
        // bracket at column zero and no trailing comma on the last one.
        TSType::TSTupleType(tuple) => {
            let mut members = Vec::new();
            for element in &tuple.element_types {
                members.push(match element {
                    TSTupleElement::TSNamedTupleMember(named) => {
                        format!("    {}: {}", named.label.name, print_tuple_element(&named.element_type, source)?)
                    }
                    other => format!("    {}", print_tuple_element(other, source)?),
                });
            }
            format!("[\n{}\n]", members.join(",\n"))
        }
        TSType::TSUnionType(union) => {
            let parts: Result<Vec<String>> = union.types.iter().map(|t| print_type(t, source)).collect();
            parts?.join(" | ")
        }
        other => bail!("no printer for the type `{}`; add one deliberately", ts::text(source, other.span())),
    })
}

fn generate(aliases: &[Alias]) -> String {
    let mut out = String::from(
        "/* This file is codegen'd in shared package of the monorepo:\n  yarn workspace @puzzmo-com/shared codegen\n */\n",
    );

    let imports: Vec<&str> = aliases
        .iter()
        .map(Alias::name)
        .filter(|n| !SKIP.contains(n) && !NO_IMPORT.contains(n))
        .collect();
    out.push_str(&format!("\nimport type {{ {} }} from \"./statsAPI.d.ts\"\n", imports.join(", ")));

    for alias in aliases {
        if SKIP.contains(&alias.name()) {
            continue;
        }
        match alias {
            Alias::Bitmap { name, entries } => out.push_str(&format!("\n{}\n", bitmap(name, entries))),
            Alias::Object { name, groups } => {
                out.push_str(&format!(
                    "\n{}\n{}\n{}\n",
                    runtime(name, groups),
                    keys(name, groups),
                    obj_to_array(name, groups)
                ));
            }
            Alias::Other { .. } => out.push_str("\n\n\n"),
        }
    }

    out
}

fn lower_first(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_lowercase(), chars.as_str()),
        None => String::new(),
    }
}

fn upper_first(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

fn runtime(name: &str, groups: &[Group]) -> String {
    // The TS pushed each piece separately and joined with "\n  ", so an entry's own four spaces
    // end up as six. Build the same flat list rather than nesting the indentation by hand.
    let mut pieces = Vec::new();

    for group in groups {
        pieces.push(format!("\n  {{\n    title: \"{}\",\n    values: [", group.field));
        for (i, entry) in group.entries.iter().enumerate() {
            pieces.push(format!(
                "    {{ name: \"{}\", value: u.{}?.[{i}], i: {i} }},",
                entry.name, group.field
            ));
        }
        pieces.push("  ],\n  },".into());
    }

    format!(
        "\nexport const {}Runtime = (u: {name}) => [{}\n]",
        lower_first(name),
        pieces.join("\n  ")
    )
}

fn keys(name: &str, groups: &[Group]) -> String {
    let mut lines = vec![format!("export const {}Keys = {{", lower_first(name))];
    for group in groups {
        lines.push(format!("  {}: {{", group.field));
        for (i, entry) in group.entries.iter().enumerate() {
            lines.push(format!("    {}: {i},", entry.name));
        }
        lines.push("  },".into());
    }
    lines.push("} as const".into());

    format!("\n{}", lines.join("\n"))
}

fn obj_to_array(name: &str, groups: &[Group]) -> String {
    let mut sections = Vec::new();

    for group in groups {
        if group.entries.is_empty() {
            continue;
        }
        let mut lines = vec![format!("\ntype {name}{}Input = {{", upper_first(&group.field))];
        for entry in &group.entries {
            lines.push(format!("  \"{}\":  {}", entry.name, entry.type_text));
        }
        lines.push("   }".into());
        sections.push(lines.join("\n"));
    }

    for group in groups {
        if group.entries.is_empty() {
            continue;
        }
        let upper = upper_first(&group.field);
        let mut lines = vec![format!(
            "\n    export const {}{upper}ObjToArr = (i: {name}{upper}Input): NonNullable<{name}[\"{}\"]> => [",
            lower_first(name),
            group.field
        )];
        for entry in &group.entries {
            lines.push(format!("i.{},", entry.name));
        }
        lines.push("] ".into());
        sections.push(lines.join("\n"));
    }

    format!("{}\n", sections.join("\n  "))
}

fn bitmap(name: &str, entries: &[Entry]) -> String {
    let mut lines = vec![format!("export enum {name}Keys {{")];
    for (i, entry) in entries.iter().enumerate() {
        lines.push(format!("    {} = 1 << {i},", entry.name));
    }
    lines.push("} ".into());

    format!("\n{}", lines.join("\n"))
}
