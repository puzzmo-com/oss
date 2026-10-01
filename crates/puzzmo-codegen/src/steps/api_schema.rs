//! Exports api-schema.graphql from the SDL and directive files.
//!
//! Replaces the generateApiSchema half of scripts/regenerate.ts, which imported all 206 modules
//! through tsx purely to read static strings out of them, then merged and printed with graphql-js.
//! Every `*.sdl.ts` holds a plain `gql` template with no interpolation, so oxc lifts the SDL
//! straight out of the source and no JavaScript needs to run.
//!
//! Output order is deterministic (grouped by kind, then by name) rather than matching the order
//! graphql-js happened to emit. The file is generated and consumed by tools that parse it, so a
//! stable order is what matters, not the previous one.

use anyhow::{Context, Result, bail};
use graphql_parser::schema::{Definition, Document, TypeDefinition, TypeExtension};
use oxc_allocator::Allocator;
use oxc_ast::ast::{Declaration, Expression};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use crate::ts;

pub const OUTPUT: &str = "api-schema.graphql";

/// Spec scalars, which a printed schema never declares.
const BUILT_IN_SCALARS: [&str; 5] = ["ID", "String", "Int", "Float", "Boolean"];
const SDL_DIR: &str = "apps/api.puzzmo.com/src/graphql";
const DIRECTIVES_DIR: &str = "apps/api.puzzmo.com/src/directives";

/// burr's rootSchema, which the TS pulled in as a module rather than from an SDL file.
///
/// The two @specifiedBy directives come from graphql-scalars' resolvers at schema-build time, not
/// from burr's own SDL text, so they are spelled out here to keep the exported schema faithful.
const ROOT_SCHEMA: &str = r#"
scalar BigInt
scalar Date
scalar Time
scalar DateTime
scalar JSON @specifiedBy(url: "http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf")
scalar JSONObject @specifiedBy(url: "http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf")
scalar Byte
scalar File

"""
The Burr Root Schema
"""
type Burr {
  "The version of Burr."
  version: String
  "The version of Prisma."
  prismaVersion: String
}

type Query {
  burr: Burr
}
"#;

pub fn render(root: &Path) -> Result<String> {
    let mut sources = vec![ROOT_SCHEMA.to_string()];

    for file in sdl_files(root)? {
        let source = std::fs::read_to_string(&file).with_context(|| format!("reading {}", file.display()))?;
        let name = file.strip_prefix(root).unwrap_or(&file).display().to_string();
        if let Some(sdl) = extract_gql_schema(&name, &source)? {
            sources.push(sdl);
        }
    }

    let combined = sources.join("\n");
    let document = graphql_parser::parse_schema::<String>(&combined).context("parsing the merged SDL")?.into_static();

    Ok(print_merged(merge(document)?))
}

/// Every `*.sdl.ts` and directive file, excluding tests, in sorted order.
fn sdl_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();

    for (dir, suffix) in [(SDL_DIR, ".sdl.ts"), (DIRECTIVES_DIR, ".ts")] {
        collect(&root.join(dir), suffix, &mut files)?;
    }

    files.sort();
    Ok(files)
}

fn collect(dir: &Path, suffix: &str, into: &mut Vec<PathBuf>) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }

    for entry in std::fs::read_dir(dir).with_context(|| format!("reading {}", dir.display()))? {
        let path = entry?.path();
        if path.is_dir() {
            collect(&path, suffix, into)?;
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.ends_with(suffix) && !name.ends_with(".test.ts") {
            into.push(path);
        }
    }

    Ok(())
}

/// The SDL inside `export const schema = gql`...``, or None when the file has no such export.
fn extract_gql_schema(path: &str, source: &str) -> Result<Option<String>> {
    let allocator = Allocator::default();
    let program = ts::parse(&allocator, path, source)?;

    for declaration in ts::declarations(&program) {
        let Declaration::VariableDeclaration(variables) = declaration else { continue };

        for declarator in &variables.declarations {
            if declarator.id.get_identifier_name().as_deref() != Some("schema") {
                continue;
            }
            let Some(Expression::TaggedTemplateExpression(tagged)) = &declarator.init else { continue };

            // Interpolation would mean the SDL is not knowable without running the module. None of
            // the files use it, and silently dropping a chunk of schema would be far worse than
            // stopping, so refuse rather than guess.
            if !tagged.quasi.expressions.is_empty() {
                bail!("{path}: the gql template interpolates, so its SDL cannot be read statically");
            }

            let quasi = tagged.quasi.quasis.first().context("empty gql template")?;
            return Ok(Some(quasi.value.raw.to_string()));
        }
    }

    Ok(None)
}

/// Collapses repeated definitions and `extend type` blocks into one definition per name.
///
/// Two things make this necessary: 76 of the SDL files each declare their own `type Query`, and 20
/// use `extend type` against a base defined elsewhere. graphql-tools did this in the TS.
fn merge(document: Document<'static, String>) -> Result<Vec<Definition<'static, String>>> {
    let mut types: BTreeMap<String, TypeDefinition<'static, String>> = BTreeMap::new();
    let mut directives = BTreeMap::new();
    let mut extensions = Vec::new();

    for definition in document.definitions {
        match definition {
            Definition::TypeDefinition(def) => {
                let name = type_name(&def).to_string();
                // graphql-js omitted the built-in scalars even where the SDL redeclares them
                // (objectIdentity.sdl.ts spells out `scalar ID`), so they stay out of the export.
                if BUILT_IN_SCALARS.contains(&name.as_str()) {
                    continue;
                }
                match types.remove(&name) {
                    Some(existing) => types.insert(name.clone(), merge_types(&name, existing, def)?),
                    None => types.insert(name, def),
                };
            }
            Definition::TypeExtension(ext) => extensions.push(ext),
            Definition::DirectiveDefinition(dir) => {
                directives.insert(dir.name.clone(), dir);
            }
            Definition::SchemaDefinition(_) => {}
        }
    }

    // Extensions apply once every base definition is known, so a file order that puts the
    // extension first still lands in the right place.
    for extension in extensions {
        let name = extension_name(&extension).to_string();
        let base = types
            .remove(&name)
            .with_context(|| format!("`extend` targets {name}, which nothing defines"))?;
        types.insert(name.clone(), apply_extension(&name, base, extension)?);
    }

    let mut out: Vec<Definition<'static, String>> = Vec::new();
    out.extend(directives.into_values().map(Definition::DirectiveDefinition));
    out.extend(types.into_values().map(Definition::TypeDefinition));
    Ok(out)
}

fn type_name<'a>(def: &'a TypeDefinition<'static, String>) -> &'a str {
    match def {
        TypeDefinition::Scalar(t) => &t.name,
        TypeDefinition::Object(t) => &t.name,
        TypeDefinition::Interface(t) => &t.name,
        TypeDefinition::Union(t) => &t.name,
        TypeDefinition::Enum(t) => &t.name,
        TypeDefinition::InputObject(t) => &t.name,
    }
}

fn extension_name<'a>(ext: &'a TypeExtension<'static, String>) -> &'a str {
    match ext {
        TypeExtension::Scalar(t) => &t.name,
        TypeExtension::Object(t) => &t.name,
        TypeExtension::Interface(t) => &t.name,
        TypeExtension::Union(t) => &t.name,
        TypeExtension::Enum(t) => &t.name,
        TypeExtension::InputObject(t) => &t.name,
    }
}

/// Folds a repeated definition of the same name into the first one.
fn merge_types(
    name: &str,
    mut into: TypeDefinition<'static, String>,
    from: TypeDefinition<'static, String>,
) -> Result<TypeDefinition<'static, String>> {
    match (&mut into, from) {
        (TypeDefinition::Object(a), TypeDefinition::Object(b)) => {
            extend_unique(&mut a.fields, b.fields, field_name);
            a.directives.extend(b.directives);
            for interface in b.implements_interfaces {
                if !a.implements_interfaces.contains(&interface) {
                    a.implements_interfaces.push(interface);
                }
            }
            if a.description.is_none() {
                a.description = b.description;
            }
        }
        (TypeDefinition::InputObject(a), TypeDefinition::InputObject(b)) => {
            extend_unique(&mut a.fields, b.fields, input_name)
        }
        (TypeDefinition::Interface(a), TypeDefinition::Interface(b)) => {
            extend_unique(&mut a.fields, b.fields, field_name)
        }
        (TypeDefinition::Enum(a), TypeDefinition::Enum(b)) => {
            extend_unique(&mut a.values, b.values, enum_value_name)
        }
        (TypeDefinition::Union(a), TypeDefinition::Union(b)) => {
            extend_unique(&mut a.types, b.types, |t| t.clone())
        }
        (TypeDefinition::Scalar(_), TypeDefinition::Scalar(_)) => {}
        _ => bail!("{name} is declared twice with different kinds"),
    }
    Ok(into)
}

/// Folds an `extend` block into the definition it targets.
fn apply_extension(
    name: &str,
    mut base: TypeDefinition<'static, String>,
    extension: TypeExtension<'static, String>,
) -> Result<TypeDefinition<'static, String>> {
    match (&mut base, extension) {
        (TypeDefinition::Object(a), TypeExtension::Object(b)) => {
            extend_unique(&mut a.fields, b.fields, field_name);
            a.directives.extend(b.directives);
            for interface in b.implements_interfaces {
                if !a.implements_interfaces.contains(&interface) {
                    a.implements_interfaces.push(interface);
                }
            }
        }
        (TypeDefinition::InputObject(a), TypeExtension::InputObject(b)) => {
            extend_unique(&mut a.fields, b.fields, input_name)
        }
        (TypeDefinition::Interface(a), TypeExtension::Interface(b)) => {
            extend_unique(&mut a.fields, b.fields, field_name)
        }
        (TypeDefinition::Enum(a), TypeExtension::Enum(b)) => {
            extend_unique(&mut a.values, b.values, enum_value_name)
        }
        (TypeDefinition::Union(a), TypeExtension::Union(b)) => {
            extend_unique(&mut a.types, b.types, |t| t.clone())
        }
        (TypeDefinition::Scalar(a), TypeExtension::Scalar(b)) => a.directives.extend(b.directives),
        _ => bail!("`extend` on {name} does not match the kind it was defined with"),
    }
    Ok(base)
}


/// Adds only the members whose names are not already present.
///
/// The same type is often declared in several SDL files (every enum also appears in the generated
/// enums.sdl.ts), so a straight concatenation produces duplicate fields and a schema graphql-js
/// rejects. graphql-tools deduplicated by name; first declaration wins.
fn extend_unique<T, F>(into: &mut Vec<T>, from: Vec<T>, name_of: F)
where
    F: Fn(&T) -> String,
{
    let mut seen: HashSet<String> = into.iter().map(&name_of).collect();
    for item in from {
        let key = name_of(&item);
        if seen.insert(key) {
            into.push(item);
        }
    }
}

fn field_name(field: &graphql_parser::schema::Field<'static, String>) -> String {
    field.name.clone()
}

fn input_name(field: &graphql_parser::schema::InputValue<'static, String>) -> String {
    field.name.clone()
}

fn enum_value_name(value: &graphql_parser::schema::EnumValue<'static, String>) -> String {
    value.name.clone()
}


/// Directive applications a printed schema keeps. graphql-js's printSchema rebuilds the SDL from
/// the schema object, which only retains these two, so every @requireAuth/@skipAuth/@ownerOrAdminOnly
/// application was dropped from the exported file. Keeping them would change what sdl-codegen reads
/// (it embeds the field's SDL in a comment), so they are dropped here too. The `directive @...`
/// definitions themselves stay.
const PRINTED_DIRECTIVES: [&str; 2] = ["deprecated", "specifiedBy"];

fn strip_directives(definitions: &mut [Definition<'static, String>]) {
    for definition in definitions {
        let Definition::TypeDefinition(def) = definition else { continue };
        match def {
            TypeDefinition::Object(t) => {
                keep_printable(&mut t.directives);
                for field in &mut t.fields {
                    keep_printable(&mut field.directives);
                    for argument in &mut field.arguments {
                        keep_printable(&mut argument.directives);
                    }
                }
            }
            TypeDefinition::Interface(t) => {
                keep_printable(&mut t.directives);
                for field in &mut t.fields {
                    keep_printable(&mut field.directives);
                    for argument in &mut field.arguments {
                        keep_printable(&mut argument.directives);
                    }
                }
            }
            TypeDefinition::InputObject(t) => {
                keep_printable(&mut t.directives);
                for field in &mut t.fields {
                    keep_printable(&mut field.directives);
                }
            }
            TypeDefinition::Enum(t) => {
                keep_printable(&mut t.directives);
                for value in &mut t.values {
                    keep_printable(&mut value.directives);
                }
            }
            TypeDefinition::Union(t) => keep_printable(&mut t.directives),
            TypeDefinition::Scalar(t) => keep_printable(&mut t.directives),
        }
    }
}

fn keep_printable(directives: &mut Vec<graphql_parser::schema::Directive<'static, String>>) {
    directives.retain(|d| PRINTED_DIRECTIVES.contains(&d.name.as_str()));
}

fn print_merged(mut definitions: Vec<Definition<'static, String>>) -> String {
    strip_directives(&mut definitions);
    let document = Document { definitions };
    format!("{document}")
}
