//! A small reader for the split Prisma schema.
//!
//! Deliberately not a full PSL parser: the codegen steps need enum names and values, and model
//! fields with their doc comments, and nothing else. Anything richer belongs in a real parser.

use anyhow::{Context, Result, bail};
use std::path::Path;

#[derive(Debug, PartialEq)]
pub struct Enum {
    pub name: String,
    pub values: Vec<String>,
}

#[derive(Debug, PartialEq)]
pub struct Model {
    pub name: String,
    pub fields: Vec<Field>,
    /// Doc comments sitting above the model, newline-joined with their marker stripped.
    pub leading_comments: String,
}

#[derive(Debug, PartialEq)]
pub struct Field {
    pub name: String,
    /// The declared type with `?` and `[]` stripped, e.g. `String`, `DateTime`, `Game`.
    pub type_name: String,
    pub optional: bool,
    pub array: bool,
    /// Doc comments above the field; a blank line contributes an empty entry, as in the TS.
    pub leading_comments: String,
}

/// Prisma's built-in scalars. Anything else is an enum or a relation.
pub const SCALARS: [&str; 9] =
    ["String", "Int", "Float", "Boolean", "DateTime", "Json", "Decimal", "BigInt", "Bytes"];

/// Reads every `.prisma` file in a directory, filename-sorted and concatenated as the TS did.
pub fn read_schema_dir(dir: &Path) -> Result<String> {
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .with_context(|| format!("reading {}", dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "prisma"))
        .collect();
    files.sort();

    if files.is_empty() {
        bail!("no .prisma files in {}", dir.display());
    }

    let mut parts = Vec::with_capacity(files.len());
    for file in &files {
        parts.push(std::fs::read_to_string(file).with_context(|| format!("reading {}", file.display()))?);
    }
    Ok(parts.join("\n"))
}

/// Every enum in the schema, sorted by name, values in declaration order.
///
/// Comment handling matches the TypeScript this replaces: everything from the first `//` on a
/// line is dropped, which covers whole-line `///` docs and trailing notes alike, and blank
/// results are skipped.
pub fn enums(schema: &str) -> Result<Vec<Enum>> {
    let mut found = Vec::new();
    let mut lines = schema.lines();

    while let Some(line) = lines.next() {
        let Some(name) = enum_header(line) else { continue };

        let mut values = Vec::new();
        let mut closed = false;
        for body in lines.by_ref() {
            if body.trim_start().starts_with('}') {
                closed = true;
                break;
            }
            let value = body.split("//").next().unwrap_or("").trim();
            if !value.is_empty() {
                values.push(value.to_string());
            }
        }

        if !closed {
            bail!("enum {name} is never closed");
        }
        found.push(Enum { name: name.to_string(), values });
    }

    if found.is_empty() {
        bail!("no enums found, has the schema layout changed again?");
    }

    // localeCompare in the TS; these names are ASCII identifiers, so a byte sort matches.
    found.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(found)
}

/// Every model in the schema, in declaration order, with its fields in declaration order.
///
/// Block attributes (`@@index`, `@@unique`), comments and blanks are skipped, as are lines
/// whose type is not a plain identifier -- the TS this replaces skipped those too.
pub fn models(schema: &str) -> Result<Vec<Model>> {
    let mut found = Vec::new();
    let mut lines = schema.lines();
    // Top-level comments accumulate until a model claims them, which is what the TS did -- a
    // comment above an enum therefore carries down to the next model.
    let mut pending: Vec<String> = Vec::new();

    while let Some(line) = lines.next() {
        let Some(name) = block_header(line, "model ") else {
            // Only comments at the top level attach to the next model; one inside an enum body
            // belongs to that enum, so skip the whole block.
            if line.trim_end().ends_with('{') {
                for inner in lines.by_ref() {
                    if inner.trim_start().starts_with('}') {
                        break;
                    }
                }
                continue;
            }
            if let Some(text) = comment_text(line) {
                pending.push(text);
            }
            continue;
        };

        let mut fields = Vec::new();
        let mut field_comments: Vec<String> = Vec::new();
        let mut closed = false;

        for body in lines.by_ref() {
            if body.trim_start().starts_with('}') {
                closed = true;
                break;
            }
            if let Some(text) = comment_text(body) {
                field_comments.push(text);
                continue;
            }
            if body.trim().is_empty() {
                field_comments.push(String::new());
                continue;
            }
            if let Some(mut field) = parse_field(body) {
                field.leading_comments = field_comments.join("\n");
                fields.push(field);
            }
            field_comments.clear();
        }

        if !closed {
            bail!("model {name} is never closed");
        }
        found.push(Model { name: name.to_string(), fields, leading_comments: pending.join("\n") });
        pending.clear();
    }

    Ok(found)
}

/// A comment line's text with its marker removed, matching the TS's single replace of
/// "/// " then "// ".
fn comment_text(line: &str) -> Option<String> {
    // Start at the marker but keep everything after it verbatim: trailing whitespace inside a
    // doc block survives into the generated comment, so trimming here loses bytes.
    let trimmed = line.trim_start();
    if !trimmed.starts_with("//") {
        return None;
    }
    Some(trimmed.replacen("/// ", "", 1).replacen("// ", "", 1))
}

/// A `name Type` field line, or None for attributes, comments, blanks and anything odd.
fn parse_field(line: &str) -> Option<Field> {
    let line = line.split("//").next().unwrap_or("").trim();
    if line.is_empty() || line.starts_with("@@") {
        return None;
    }

    let mut parts = line.split_whitespace();
    let name = parts.next()?;
    let declared = parts.next()?;

    if !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return None;
    }

    let optional = declared.ends_with('?');
    let base = declared.trim_end_matches('?');
    let array = base.ends_with("[]");
    let type_name = base.trim_end_matches("[]");

    // A composite or unsupported type (`Unsupported("...")`, a function) is not a plain name.
    if type_name.is_empty() || !type_name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return None;
    }

    Some(Field {
        name: name.to_string(),
        type_name: type_name.to_string(),
        optional,
        array,
        leading_comments: String::new(),
    })
}

/// The enum's name when a line opens an enum block, e.g. `enum ActivityKind {`.
fn enum_header(line: &str) -> Option<&str> {
    block_header(line, "enum ")
}

/// The block's name when a line opens a `<keyword> Name {` block.
fn block_header<'a>(line: &'a str, keyword: &str) -> Option<&'a str> {
    let rest = line.strip_prefix(keyword)?;
    let (name, after) = rest.split_once('{')?;
    let name = name.trim();
    if name.is_empty() || !after.trim().is_empty() {
        return None;
    }
    if !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return None;
    }
    Some(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_values_and_strips_comments() {
        let schema = "\
enum Colour {
  // a leading note
  Red
  /// a doc comment
  Green

  Blue
}
";
        let found = enums(schema).unwrap();
        assert_eq!(found, vec![Enum {
            name: "Colour".into(),
            values: vec!["Red".into(), "Green".into(), "Blue".into()],
        }]);
    }

    #[test]
    fn sorts_by_name_and_keeps_declaration_order() {
        let schema = "enum Beta {\n  Two\n  One\n}\nenum Alpha {\n  Z\n  A\n}\n";
        let found = enums(schema).unwrap();
        assert_eq!(found.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["Alpha", "Beta"]);
        assert_eq!(found[0].values, ["Z", "A"]);
    }

    #[test]
    fn ignores_models_and_unclosed_blocks() {
        assert!(enums("model User {\n  id String\n}\n").is_err());
        assert!(enums("enum Open {\n  A\n").is_err());
    }
}
