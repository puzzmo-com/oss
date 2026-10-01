//! The two files every generated service type imports.
//!
//! shared-schema-types.d.ts describes each GraphQL type as written; shared-return-types.d.ts
//! describes it in return position, where a type backed by a Prisma model is that model instead.
//! Replaces sharedSchema.ts.

use anyhow::Result;
use graphql_parser::schema::TypeDefinition;
use std::collections::{BTreeMap, BTreeSet};

use super::FieldFacts;
use super::typemap::{MapConfig, TypeMapper};
use crate::gqlschema::Schema;
use crate::prisma::Model;

pub const SCHEMA_TYPES: &str = "apps/api.puzzmo.com/types/shared-schema-types.d.ts";
pub const RETURN_TYPES: &str = "apps/api.puzzmo.com/types/shared-return-types.d.ts";

/// Types with a TypeScript equivalent, which never get an interface of their own.
const KNOWN_PRIMITIVES: [&str; 3] = ["String", "Boolean", "Int"];

pub fn render(
    schema: &Schema,
    prisma: &BTreeMap<String, Model>,
    field_facts: &FieldFacts,
) -> Result<Vec<(String, String)>> {
    let model_names: BTreeSet<String> = prisma.keys().cloned().collect();

    // Babel printed the last statement without a trailing newline, so neither file ends in one.
    let trim = |text: String| text.trim_end_matches('\n').to_string();

    Ok(vec![
        (SCHEMA_TYPES.to_string(), trim(external(schema, prisma, &model_names, field_facts))),
        (RETURN_TYPES.to_string(), trim(returns(schema, &model_names, field_facts))),
    ])
}

/// Every GraphQL type as the schema declares it.
fn external(
    schema: &Schema,
    prisma: &BTreeMap<String, Model>,
    model_names: &BTreeSet<String>,
    field_facts: &FieldFacts,
) -> String {
    let mut mapper = TypeMapper::new(schema, model_names, false);
    let mut out = String::new();

    for definition in schema.definitions() {
        let name = crate::gqlschema::type_name(definition);
        if KNOWN_PRIMITIVES.contains(&name) {
            continue;
        }

        match definition {
            TypeDefinition::Object(_) | TypeDefinition::Interface(_) | TypeDefinition::InputObject(_) => {
                let model = prisma.get(name);
                let mut docs = Vec::new();
                if let Some(model) = model {
                    if !model.leading_comments.is_empty() {
                        docs.push(model.leading_comments.clone());
                    }
                }
                if let Some(description) = description_of(definition) {
                    docs.push(description.clone());
                }
                if !docs.is_empty() {
                    out.push_str(&format!("/*{}*/\n", docs.join(" ")));
                }

                out.push_str(&interface(schema, &mut mapper, definition, model, field_facts, true));
            }
            TypeDefinition::Enum(enumeration) => {
                let members: Vec<String> = enumeration.values.iter().map(|v| format!("\"{}\"", v.name)).collect();
                out.push_str(&format!("export type {name} = {};\n", members.join(" | ")));
            }
            TypeDefinition::Union(union) => {
                out.push_str(&format!("export type {name} = {};\n", union.types.join(" | ")));
            }
            TypeDefinition::Scalar(_) => {}
        }
    }

    for scalar in mapper.referenced().scalars.clone() {
        out.push_str(&format!("type {scalar} = any;\n"));
    }
    out
}

/// Every GraphQL type in return position, where a Prisma-backed type becomes the Prisma model.
fn returns(schema: &Schema, model_names: &BTreeSet<String>, field_facts: &FieldFacts) -> String {
    let mut mapper = TypeMapper::new(schema, model_names, true);
    let mut out = String::new();
    let mut to_import: Vec<String> = Vec::new();

    for definition in schema.definitions() {
        let name = crate::gqlschema::type_name(definition);
        if KNOWN_PRIMITIVES.contains(&name) {
            continue;
        }

        match definition {
            TypeDefinition::Object(_) | TypeDefinition::Interface(_) | TypeDefinition::InputObject(_) => {
                // A type backed by Prisma is imported rather than described.
                if model_names.contains(name) {
                    to_import.push(name.to_string());
                    continue;
                }
                out.push_str(&interface(schema, &mut mapper, definition, None, field_facts, false));
            }
            TypeDefinition::Enum(enumeration) => {
                let members: Vec<String> = enumeration.values.iter().map(|v| format!("\"{}\"", v.name)).collect();
                out.push_str(&format!("export type {name} = {};\n", members.join(" | ")));
            }
            TypeDefinition::Union(union) => {
                out.push_str(&format!("export type {name} = {};\n", union.types.join(" | ")));
            }
            TypeDefinition::Scalar(_) => {}
        }
    }

    for scalar in mapper.referenced().scalars.clone() {
        out.push_str(&format!("type {scalar} = any;\n"));
    }

    let mut all: BTreeSet<String> = mapper.referenced().prisma.iter().cloned().collect();
    all.extend(to_import);
    if !all.is_empty() {
        let subs: Vec<String> = all.iter().map(|name| format!("{name} as P{name}")).collect();
        out.push_str(&format!("import {{ {} }} from \"@prisma/client\";\n", subs.join(", ")));
        for name in &all {
            out.push_str(&format!("type {name} = P{name};\n"));
        }
    }

    out
}

/// One interface, with `__typename` first and a field per schema field.
fn interface(
    schema: &Schema,
    mapper: &mut TypeMapper,
    definition: &TypeDefinition<'static, String>,
    model: Option<&Model>,
    field_facts: &FieldFacts,
    with_field_docs: bool,
) -> String {
    let name = crate::gqlschema::type_name(definition);
    let mut out = format!("export interface {name} {{\n  __typename?: \"{name}\";\n");

    let resolved = field_facts.get(name);
    for field in fields_of(schema, definition) {
        if with_field_docs {
            if let Some(comments) = model.and_then(|m| m.fields.iter().find(|f| f.name == field.name)) {
                let trimmed = comments.leading_comments.trim();
                if !trimmed.is_empty() {
                    // Babel wrote field comments with a leading space; type-level ones have none.
                    out.push_str(&format!("  /* {}*/\n", crate::gqlschema::indent_continuations(trimmed, "  ")));
                }
            }
        }

        // A field a service file resolves is optional here, because the resolver supplies it.
        // Otherwise it follows the schema. The fallback is per-field: a type having *some*
        // resolvers says nothing about the fields it does not resolve.
        let has_resolver = resolved.is_some_and(|names| names.contains(field.name));
        let optional =
            has_resolver || !matches!(field.field_type, graphql_parser::schema::Type::NonNullType(_));

        let mapped = mapper.map(&field.field_type, MapConfig {
            prefer_null_over_undefined: true,
            ..MapConfig::default()
        });
        out.push_str(&format!("  {}{}: {mapped};\n", field.name, if optional { "?" } else { "" }));
    }

    out.push_str("}\n");
    out
}

fn fields_of<'a>(
    schema: &'a Schema,
    definition: &'a TypeDefinition<'static, String>,
) -> Vec<FieldLike<'a>> {
    match definition {
        TypeDefinition::Object(object) => {
            object.fields.iter().map(|f| FieldLike { name: &f.name, field_type: &f.field_type }).collect()
        }
        TypeDefinition::Interface(interface) => {
            interface.fields.iter().map(|f| FieldLike { name: &f.name, field_type: &f.field_type }).collect()
        }
        TypeDefinition::InputObject(input) => {
            input.fields.iter().map(|f| FieldLike { name: &f.name, field_type: &f.value_type }).collect()
        }
        _ => {
            let _ = schema;
            Vec::new()
        }
    }
}

pub struct FieldLike<'a> {
    pub name: &'a str,
    pub field_type: &'a graphql_parser::schema::Type<'static, String>,
}

fn description_of<'a>(definition: &'a TypeDefinition<'static, String>) -> Option<&'a String> {
    match definition {
        TypeDefinition::Object(t) => t.description.as_ref(),
        TypeDefinition::Interface(t) => t.description.as_ref(),
        TypeDefinition::InputObject(t) => t.description.as_ref(),
        TypeDefinition::Enum(t) => t.description.as_ref(),
        TypeDefinition::Union(t) => t.description.as_ref(),
        TypeDefinition::Scalar(t) => t.description.as_ref(),
    }
}
