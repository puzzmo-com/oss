//! Generates the PuzzleDaily JSON Schema that studio's Monaco expression editor autocompletes from.
//!
//! Replaces the generateExpressionSchemas half of scripts/regenerate.ts, which built a TypeScript
//! interface from the Prisma models and fed it to ts-json-schema-generator. The interface only ever
//! existed to be converted, so this goes straight from Prisma to JSON Schema and skips TypeScript
//! entirely. The mapping below reproduces what tsj emitted, including where it merges null into a
//! type array and where it falls back to anyOf.

use anyhow::{Context, Result, bail};
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::prisma::{self, Field, Model};

pub const OUTPUT: &str = "apps/studio/public/schema/puzzle-daily-schema.json";
const SCHEMA_DIR: &str = "apps/api.puzzmo.com/prisma/schema";

/// The model exposed to the expression editor, and which of its relations to inline.
const ROOT: &str = "PuzzleDaily";
const RELATIONS: [(&str, &str, &[(&str, &str)]); 2] =
    [("daily", "Daily", &[]), ("puzzle", "Puzzle", &[("game", "Game")])];

/// Returns the schema JSON exactly as it should be written.
pub fn render(root: &Path) -> Result<String> {
    let schema = prisma::read_schema_dir(&root.join(SCHEMA_DIR))?;
    let models: HashMap<String, Model> =
        prisma::models(&schema)?.into_iter().map(|m| (m.name.clone(), m)).collect();
    let enums: HashMap<String, Vec<String>> =
        prisma::enums(&schema)?.into_iter().map(|e| (e.name, e.values)).collect();

    let ctx = Ctx { models: &models, enums: &enums };
    let root_model = ctx.model(ROOT)?;

    let inlined: HashMap<&str, (&str, &[(&str, &str)])> =
        RELATIONS.iter().map(|(field, model, nested)| (*field, (*model, *nested))).collect();

    let mut properties = Map::new();
    let mut required = Vec::new();

    for field in &root_model.fields {
        let value = match inlined.get(field.name.as_str()) {
            Some((model, nested)) => ctx.object(model, nested)?,
            // Unconfigured relations are not part of the expression scope, so they are dropped.
            None if ctx.is_relation(field) => continue,
            None => ctx.scalar(field)?,
        };
        required.push(Value::String(field.name.clone()));
        properties.insert(field.name.clone(), value);
    }

    let document = json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$ref": format!("#/definitions/{ROOT}"),
        "definitions": {
            ROOT: {
                "type": "object",
                "properties": Value::Object(properties),
                "required": Value::Array(required),
                "additionalProperties": false,
            }
        }
    });

    // JSON.stringify(schema, null, 2) plus the trailing newline writeFileSync did not add.
    Ok(serde_json::to_string_pretty(&document)?)
}

struct Ctx<'a> {
    models: &'a HashMap<String, Model>,
    enums: &'a HashMap<String, Vec<String>>,
}

impl Ctx<'_> {
    fn model(&self, name: &str) -> Result<&Model> {
        self.models.get(name).with_context(|| format!("model {name} not found in the Prisma schema"))
    }

    fn is_relation(&self, field: &Field) -> bool {
        !prisma::SCALARS.contains(&field.type_name.as_str()) && !self.enums.contains_key(&field.type_name)
    }

    /// An inlined relation: its scalar fields, then any nested relations, in declaration order.
    fn object(&self, model_name: &str, nested: &[(&str, &str)]) -> Result<Value> {
        let model = self.model(model_name)?;
        let nested_by_field: HashMap<&str, &str> = nested.iter().copied().collect();

        let mut properties = Map::new();
        let mut required = Vec::new();

        for field in &model.fields {
            if self.is_relation(field) {
                continue;
            }
            required.push(Value::String(field.name.clone()));
            properties.insert(field.name.clone(), self.scalar(field)?);
        }

        for (field_name, nested_model) in nested {
            if !nested_by_field.contains_key(field_name) {
                continue;
            }
            // Nested relations carry only their scalars; the TS never recursed further. They are
            // emitted as non-optional interface members, so they are required like the scalars.
            required.push(Value::String((*field_name).to_string()));
            properties.insert((*field_name).to_string(), self.object(nested_model, &[])?);
        }

        Ok(json!({
            "type": "object",
            "properties": Value::Object(properties),
            "required": Value::Array(required),
            "additionalProperties": false,
        }))
    }

    /// One scalar or enum field, with nullability applied the way ts-json-schema-generator did.
    fn scalar(&self, field: &Field) -> Result<Value> {
        let base = self.base_type(&field.type_name)?;

        if field.array {
            // Prisma list fields are never null, so arrays ignore `optional`.
            return Ok(json!({ "type": "array", "items": base }));
        }
        if !field.optional {
            return Ok(base);
        }

        Ok(nullable(base))
    }

    /// The non-null schema for a type name.
    fn base_type(&self, type_name: &str) -> Result<Value> {
        if let Some(values) = self.enums.get(type_name) {
            let members: Vec<Value> = values.iter().map(|v| Value::String(v.clone())).collect();
            return Ok(json!({ "type": "string", "enum": members }));
        }

        Ok(match type_name {
            "String" => json!({ "type": "string" }),
            "Int" | "Float" | "Decimal" => json!({ "type": "number" }),
            "Boolean" => json!({ "type": "boolean" }),
            "DateTime" => json!({ "type": "string", "format": "date-time" }),
            // `Json` became `any` in the generated interface, which tsj emits as an empty schema.
            "Json" => json!({}),
            // BigInt and Bytes have never appeared in the exposed models. Rather than guess at
            // what tsj would have emitted, stop so somebody checks against the real generator.
            other => bail!("no JSON Schema mapping for the Prisma type {other}; add one deliberately"),
        })
    }
}

/// Adds null to a schema the way ts-json-schema-generator did for `T | null`.
///
/// A plain `{"type": X}` grows a type array, and an enum additionally gains a null member. Anything
/// carrying another keyword (`format`) or no keywords at all (`{}`, from Json) cannot merge without
/// that keyword applying to null too, so it becomes an anyOf instead.
fn nullable(base: Value) -> Value {
    let keys: HashSet<&str> = base.as_object().map(|o| o.keys().map(String::as_str).collect()).unwrap_or_default();
    let mergeable = keys == HashSet::from(["type"]) || keys == HashSet::from(["type", "enum"]);

    if !mergeable {
        return json!({ "anyOf": [base, { "type": "null" }] });
    }

    let mut object = base.as_object().cloned().unwrap_or_default();
    let type_name = object.get("type").and_then(Value::as_str).unwrap_or("string").to_string();
    object.insert("type".into(), json!([type_name, "null"]));

    if let Some(Value::Array(members)) = object.get_mut("enum") {
        members.push(Value::Null);
    }

    Value::Object(object)
}
