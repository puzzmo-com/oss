//! Generates the host API JSON schemas studio, workshop and the CLI validate against.
//!
//! Replaces the generateStudioJSONSchemas half of scripts/regenerate.ts, which ran
//! ts-json-schema-generator over packages/shared/hostAPI.d.ts. There is no TypeScript type
//! checker in Rust, but none is needed: the closure reachable from the four root types is a
//! dozen aliases using object types, unions, intersections, two utility types and `keyof`, so
//! this expands them directly.
//!
//! Output is verified semantically rather than byte for byte -- descriptions are annotations and
//! carry no validation meaning, so the exact prose wrapping ts-json-schema-generator produced is
//! not reproduced. See the json_schema_diff assertions in tests/.

use anyhow::{Context, Result, bail};
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Declaration, TSInterfaceDeclaration, TSLiteral, TSSignature, TSType, TSTypeName, TSTypeOperatorOperator,
};
use oxc_span::GetSpan;
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;
use std::path::Path;

use crate::jsfmt::{Flavour, print, print_inline};
use crate::ts;

pub const HOST_API_SCHEMA: &str = "apps/studio/src/components/Admin/Game/hostAPISchema.ts";
pub const AUGMENTS_SCHEMA: &str = "apps/studio/public/schema/augments-schema.json";
pub const WORKSHOP_PUZZMO_FILE: &str = "apps/workshop.puzzmo.com/public/schema/puzzmo-file-schema.json";
pub const CLI_PUZZMO_FILE: &str = "packages/cli/schemas/puzzmo-file-schema.json";

/// Files holding the type closure. hostAPI.d.ts's imports are all leaf files.
const SOURCES: [&str; 4] = [
    "packages/shared/hostAPI.d.ts",
    "packages/shared/haptics.ts",
    "packages/shared/statsAPI.d.ts",
    "packages/keyboard/src/types.ts",
];

/// Every output, as (path, contents).
pub fn render(root: &Path) -> Result<Vec<(&'static str, String)>> {
    let mut sources = Vec::new();
    for relative in SOURCES {
        let path = root.join(relative);
        sources.push(std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?);
    }

    let allocator = Allocator::default();
    let mut programs = Vec::new();
    for (i, source) in sources.iter().enumerate() {
        programs.push(ts::parse(&allocator, SOURCES[i], source)?);
    }

    let mut registry = Registry::default();
    for (i, program) in programs.iter().enumerate() {
        registry.collect(program, &sources[i]);
    }

    let front_matter = registry.schema_document("PuzzleFrontMatter")?;
    let augmentations = registry.schema_document("Augmentations")?;
    let host_context = registry.schema_document("HostContext")?;
    let puzzmo_file = registry.schema_document("PuzzmoFile")?;

    let host_api_file = format!(
        "// Codegen'd from 'yarn workspace api script regenerate'\n\nexport const puzzleFrontMatterSchema = {}\n\nexport const augmentSchema = {}\n\nexport const embedHostContext = {}\n",
        print_inline(&front_matter, 0, Flavour::TypeScript),
        print_inline(&augmentations, 0, Flavour::TypeScript),
        print_inline(&host_context, 0, Flavour::TypeScript),
    );

    let puzzmo_file_json = print(&puzzmo_file, Flavour::Json);

    Ok(vec![
        (HOST_API_SCHEMA, host_api_file),
        (AUGMENTS_SCHEMA, print(&augmentations, Flavour::Json)),
        (WORKSHOP_PUZZMO_FILE, puzzmo_file_json.clone()),
        (CLI_PUZZMO_FILE, puzzmo_file_json),
    ])
}

/// A named type alias or interface, with the source it came from so comments can be read back.
struct Entry<'a> {
    annotation: Option<&'a TSType<'a>>,
    interface: Option<&'a TSInterfaceDeclaration<'a>>,
    source: &'a str,
    /// Start of the whole statement, including `export`, so a leading JSDoc block is findable.
    doc_position: u32,
}

#[derive(Default)]
struct Registry<'a> {
    types: std::collections::HashMap<String, Entry<'a>>,
    definitions: Map<String, Value>,
    /// Names currently being expanded, so a self-referential type does not recurse forever.
    in_progress: BTreeSet<String>,
}

impl<'a> Registry<'a> {
    fn collect(&mut self, program: &'a oxc_ast::ast::Program<'a>, source: &'a str) {
        for statement in &program.body {
            // The JSDoc sits before `export`, so the statement's span is the anchor, not the
            // declaration's -- otherwise the search backwards runs into the keyword.
            let (declaration, doc_position) = match statement {
                oxc_ast::ast::Statement::ExportDeclaration(export) => (&export.declaration, export.span.start),
                other => match other.as_declaration() {
                    Some(declaration) => (declaration, other.span().start),
                    None => continue,
                },
            };

            match declaration {
                Declaration::TSTypeAliasDeclaration(alias) => {
                    self.types.insert(alias.id.name.to_string(), Entry {
                        annotation: Some(&alias.type_annotation),
                        interface: None,
                        source,
                        doc_position,
                    });
                }
                Declaration::TSInterfaceDeclaration(interface) => {
                    self.types.insert(interface.id.name.to_string(), Entry {
                        annotation: None,
                        interface: Some(interface),
                        source,
                        doc_position,
                    });
                }
                _ => {}
            }
        }
    }

    /// A complete schema document rooted at `name`.
    fn schema_document(&mut self, name: &str) -> Result<Value> {
        self.definitions = Map::new();
        self.in_progress.clear();
        self.ensure_definition(name)?;

        Ok(json!({
            "$schema": "http://json-schema.org/draft-07/schema#",
            "$ref": format!("#/definitions/{name}"),
            "definitions": Value::Object(std::mem::take(&mut self.definitions)),
        }))
    }

    /// Adds `name` to definitions if it is not already there, then returns a reference to it.
    fn ensure_definition(&mut self, name: &str) -> Result<Value> {
        let reference = json!({ "$ref": format!("#/definitions/{name}") });
        if self.definitions.contains_key(name) || self.in_progress.contains(name) {
            return Ok(reference);
        }

        let entry = self.types.get(name).with_context(|| format!("no type named {name} in the closure"))?;
        let (annotation, interface, source, doc_position) =
            (entry.annotation, entry.interface, entry.source, entry.doc_position);

        self.in_progress.insert(name.to_string());
        let mut schema = match (annotation, interface) {
            (Some(ty), _) => self.schema_for(ty, source)?,
            (_, Some(decl)) => self.object_from_members(&decl.body.body, source)?,
            _ => bail!("{name} has neither a type annotation nor an interface body"),
        };
        self.in_progress.remove(name);

        // A type's own JSDoc documents its definition; studio reads these back off the schema.
        if let Some(docs) = doc_comment(source, doc_position) {
            apply_docs(&mut schema, &docs);
        }

        self.definitions.insert(name.to_string(), schema);
        Ok(reference)
    }

    fn schema_for(&mut self, ty: &'a TSType<'a>, source: &'a str) -> Result<Value> {
        Ok(match ty {
            TSType::TSStringKeyword(_) => json!({ "type": "string" }),
            TSType::TSNumberKeyword(_) => json!({ "type": "number" }),
            TSType::TSBooleanKeyword(_) => json!({ "type": "boolean" }),
            TSType::TSNullKeyword(_) => json!({ "type": "null" }),
            // `any` and `unknown` accept anything, which an empty schema expresses.
            TSType::TSAnyKeyword(_) | TSType::TSUnknownKeyword(_) => json!({}),
            TSType::TSObjectKeyword(_) => json!({ "type": "object" }),
            // `undefined` has no JSON representation at all, so it matches nothing. An empty
            // schema would be the opposite -- it matches everything -- and would quietly widen
            // every union it appears in.
            TSType::TSUndefinedKeyword(_) | TSType::TSVoidKeyword(_) | TSType::TSNeverKeyword(_) => {
                json!({ "not": {} })
            }
            // A function cannot be represented in JSON Schema; the TS config mapped it to {}.
            TSType::TSFunctionType(_) => json!({}),

            TSType::TSLiteralType(literal) => literal_schema(&literal.literal)?,
            // A template literal type constrains a string in ways JSON Schema cannot express
            // without a regex, and the generator it replaces widened it to a plain string.
            TSType::TSTemplateLiteralType(_) => json!({ "type": "string" }),
            TSType::TSArrayType(array) => {
                json!({ "type": "array", "items": self.schema_for(&array.element_type, source)? })
            }
            TSType::TSTypeLiteral(literal) => self.object_from_members(&literal.members, source)?,
            TSType::TSParenthesizedType(inner) => self.schema_for(&inner.type_annotation, source)?,

            TSType::TSUnionType(union) => {
                let mut parts = Vec::new();
                for member in &union.types {
                    parts.push(self.schema_for(member, source)?);
                }
                combine_union(parts)
            }
            TSType::TSIntersectionType(intersection) => {
                // An intersection has to see through a $ref to merge the properties behind it,
                // so members resolve to their bodies rather than to a reference.
                let mut parts = Vec::new();
                for member in &intersection.types {
                    parts.push(self.resolve(member, source)?);
                }
                combine_intersection(parts)
            }

            TSType::TSTypeOperatorType(operator) if operator.operator == TSTypeOperatorOperator::Keyof => {
                let keys = self.keys_of(&operator.type_annotation, source)?;
                json!({ "type": "string", "enum": keys })
            }

            TSType::TSTypeReference(reference) => self.reference_schema(reference, source)?,

            other => bail!("no JSON Schema mapping for `{}`; add one deliberately", ts::text(source, other.span())),
        })
    }

    /// A named reference: a utility type is expanded inline, anything else becomes a $ref.
    fn reference_schema(
        &mut self,
        reference: &'a oxc_ast::ast::TSTypeReference<'a>,
        source: &'a str,
    ) -> Result<Value> {
        let TSTypeName::IdentifierReference(identifier) = &reference.type_name else {
            bail!("qualified type names are not supported: {}", ts::text(source, reference.span))
        };
        let name = identifier.name.as_str();
        let arguments: Vec<&TSType> =
            reference.type_arguments.as_ref().map(|a| a.params.iter().collect()).unwrap_or_default();

        match (name, arguments.len()) {
            // Scalars TypeScript knows that JSON Schema has no notion of.
            ("Date", _) => return Ok(json!({ "type": "string", "format": "date-time" })),
            ("Array", 1) => {
                return Ok(json!({ "type": "array", "items": self.schema_for(arguments[0], source)? }));
            }
            ("Partial", 1) => {
                let inner = self.resolve(arguments[0], source)?;
                return Ok(make_partial(inner));
            }
            ("Pick", 2) => {
                let inner = self.resolve(arguments[0], source)?;
                let keys = self.literal_key_set(arguments[1], source)?;
                return Ok(pick(inner, &keys));
            }
            ("Omit", 2) => {
                let inner = self.resolve(arguments[0], source)?;
                let keys = self.literal_key_set(arguments[1], source)?;
                return Ok(omit(inner, &keys));
            }
            ("Record", 2) => {
                let values = self.schema_for(arguments[1], source)?;
                return Ok(json!({ "type": "object", "additionalProperties": values }));
            }
            _ => {}
        }

        if !self.types.contains_key(name) {
            bail!("unknown type `{name}`; it is outside the closure, so add it deliberately");
        }
        self.ensure_definition(name)
    }

    /// Expands a type to its schema without going through a $ref, for utility type operands.
    fn resolve(&mut self, ty: &'a TSType<'a>, source: &'a str) -> Result<Value> {
        if let TSType::TSTypeReference(reference) = ty {
            if let TSTypeName::IdentifierReference(identifier) = &reference.type_name {
                let name = identifier.name.to_string();
                if let Some(entry) = self.types.get(&name) {
                    let (annotation, interface, entry_source) = (entry.annotation, entry.interface, entry.source);
                    return match (annotation, interface) {
                        (Some(inner), _) => self.schema_for(inner, entry_source),
                        (_, Some(decl)) => self.object_from_members(&decl.body.body, entry_source),
                        _ => bail!("{name} has no body"),
                    };
                }
            }
        }
        self.schema_for(ty, source)
    }

    /// The property names of a type, for `keyof`.
    fn keys_of(&mut self, ty: &'a TSType<'a>, source: &'a str) -> Result<Vec<Value>> {
        let schema = self.resolve(ty, source)?;
        let properties = schema
            .get("properties")
            .and_then(Value::as_object)
            .with_context(|| format!("keyof needs an object type, got {}", ts::text(source, ty.span())))?;
        Ok(properties.keys().map(|k| Value::String(k.clone())).collect())
    }

    /// The string literals in `"a" | "b"`, for Pick and Omit.
    fn literal_key_set(&mut self, ty: &'a TSType<'a>, source: &'a str) -> Result<BTreeSet<String>> {
        let mut keys = BTreeSet::new();
        let mut push = |ty: &TSType| -> Result<()> {
            if let TSType::TSLiteralType(literal) = ty {
                if let TSLiteral::StringLiteral(string) = &literal.literal {
                    keys.insert(string.value.to_string());
                    return Ok(());
                }
            }
            bail!("expected a string literal key, got `{}`", ts::text(source, ty.span()))
        };

        match ty {
            TSType::TSUnionType(union) => {
                for member in &union.types {
                    push(member)?;
                }
            }
            single => push(single)?,
        }
        Ok(keys)
    }

    /// An object schema from interface or type-literal members.
    fn object_from_members(&mut self, members: &'a [TSSignature<'a>], source: &'a str) -> Result<Value> {
        let mut properties = Map::new();
        let mut required = Vec::new();
        let mut additional: Option<Value> = None;

        for member in members {
            match member {
                TSSignature::TSPropertySignature(property) => {
                    let Some(name) = property.key.static_name() else {
                        bail!("computed property names are not supported")
                    };
                    let annotation = property
                        .type_annotation
                        .as_ref()
                        .with_context(|| format!("property {name} has no type"))?;

                    let mut schema = self.schema_for(&annotation.type_annotation, source)?;
                    if let Some(docs) = doc_comment(source, property.span.start) {
                        apply_docs(&mut schema, &docs);
                    }

                    if !property.optional {
                        required.push(Value::String(name.to_string()));
                    }
                    properties.insert(name.to_string(), schema);
                }
                // `[key: string]: T` becomes additionalProperties.
                TSSignature::TSIndexSignature(index) => {
                    additional = Some(self.schema_for(&index.type_annotation.type_annotation, source)?);
                }
                _ => {}
            }
        }

        let mut object = Map::new();
        object.insert("type".into(), json!("object"));
        object.insert("properties".into(), Value::Object(properties));
        if !required.is_empty() {
            object.insert("required".into(), Value::Array(required));
        }
        object.insert("additionalProperties".into(), additional.unwrap_or(json!(false)));
        Ok(Value::Object(object))
    }
}

fn literal_schema(literal: &TSLiteral) -> Result<Value> {
    Ok(match literal {
        TSLiteral::StringLiteral(string) => json!({ "type": "string", "const": string.value.as_str() }),
        TSLiteral::NumericLiteral(number) => json!({ "type": "number", "const": number.value }),
        TSLiteral::BooleanLiteral(boolean) => json!({ "type": "boolean", "const": boolean.value }),
        other => bail!("unsupported literal type {:?}", std::mem::discriminant(other)),
    })
}

/// Collapses a union, matching how the TypeScript generator simplified them.
///
/// A union of same-typed literals becomes a single enum, `T | null` folds null into the type
/// array where it can, and `string & {}` (the autocomplete-hint idiom) widens the whole thing
/// back to a plain string.
fn combine_union(parts: Vec<Value>) -> Value {
    // A nested union is still one union: `(a | b) | c` has three members, not two.
    let mut flattened = Vec::new();
    for part in parts {
        match part.get("anyOf").and_then(Value::as_array) {
            Some(inner) if part.as_object().is_some_and(|o| o.len() == 1) => flattened.extend(inner.iter().cloned()),
            _ => flattened.push(part),
        }
    }

    // Identical members collapse: `\`game-${string}\` | string` is two plain strings by the time
    // each side has been mapped.
    let mut unique: Vec<Value> = Vec::new();
    for part in flattened {
        if !unique.contains(&part) {
            unique.push(part);
        }
    }

    // Members that say nothing but `type` merge into a single type array, so `string | null`
    // and `["string","null"] | string` both land on ["string","null"].
    if unique.len() > 1 && unique.iter().all(is_type_only) {
        let mut names: Vec<Value> = Vec::new();
        for part in &unique {
            match part.get("type") {
                Some(Value::String(name)) => push_unique(&mut names, json!(name)),
                Some(Value::Array(items)) => items.iter().for_each(|i| push_unique(&mut names, i.clone())),
                _ => {}
            }
        }
        let mut merged = Map::new();
        merged.insert("type".into(), if names.len() == 1 { names.remove(0) } else { Value::Array(names) });
        for part in &unique {
            for annotation in ANNOTATIONS {
                if let Some(value) = part.get(annotation) {
                    merged.entry(annotation.to_string()).or_insert_with(|| value.clone());
                }
            }
        }
        return Value::Object(merged);
    }

    // `"a" | "b" | (string & {})` widens: the open-ended member subsumes the literals.
    let has_open_string = unique
        .iter()
        .any(|p| p.get("type").and_then(Value::as_str) == Some("string") && p.get("const").is_none() && p.get("enum").is_none());
    if has_open_string && unique.iter().any(|p| p.get("const").is_some()) {
        unique.retain(|p| p.get("const").is_none());
    }

    let (nulls, mut rest): (Vec<Value>, Vec<Value>) =
        unique.into_iter().partition(|p| p.get("type").and_then(Value::as_str) == Some("null"));

    // String literals gather into one enum.
    let all_string_literals = rest.len() > 1
        && rest.iter().all(|p| {
            p.get("type").and_then(Value::as_str) == Some("string")
                && (p.get("const").is_some() || p.get("enum").is_some())
        });
    if all_string_literals {
        let mut members = Vec::new();
        for part in &rest {
            match (part.get("const"), part.get("enum")) {
                (Some(value), _) => members.push(value.clone()),
                (_, Some(Value::Array(values))) => members.extend(values.clone()),
                _ => {}
            }
        }
        rest = vec![json!({ "type": "string", "enum": members })];
    }

    if nulls.is_empty() {
        return match rest.len() {
            0 => json!({}),
            1 => rest.into_iter().next().unwrap_or(json!({})),
            _ => json!({ "anyOf": rest }),
        };
    }

    // One simple member plus null folds into a type array; anything richer stays an anyOf,
    // because a sibling keyword like `format` would otherwise apply to null as well.
    if rest.len() == 1 {
        let single = &rest[0];
        let keys: BTreeSet<&str> = single.as_object().map(|o| o.keys().map(String::as_str).collect()).unwrap_or_default();
        let mergeable = keys == BTreeSet::from(["type"]) || keys == BTreeSet::from(["type", "enum"]);

        if mergeable {
            let mut object = single.as_object().cloned().unwrap_or_default();
            let name = object.get("type").and_then(Value::as_str).unwrap_or("string").to_string();
            object.insert("type".into(), json!([name, "null"]));
            if let Some(Value::Array(members)) = object.get_mut("enum") {
                members.push(Value::Null);
            }
            return Value::Object(object);
        }
    }

    if rest.is_empty() {
        return json!({ "type": "null" });
    }
    rest.push(json!({ "type": "null" }));
    json!({ "anyOf": rest })
}

/// Annotation keywords, which describe a schema without constraining what it accepts.
const ANNOTATIONS: [&str; 3] = ["description", "examples", "title"];

/// True when a schema constrains nothing but the JSON type, ignoring annotations.
fn is_type_only(value: &Value) -> bool {
    value.as_object().is_some_and(|o| {
        o.contains_key("type") && o.keys().all(|k| k == "type" || ANNOTATIONS.contains(&k.as_str()))
    })
}

fn push_unique(into: &mut Vec<Value>, value: Value) {
    if !into.contains(&value) {
        into.push(value);
    }
}

/// Merges an intersection of object schemas into one.
fn combine_intersection(parts: Vec<Value>) -> Value {
    // `string & {}` is TypeScript's "any string, but keep the suggestions" idiom; the object half
    // carries no constraints, so the result is just the string.
    if let Some(primitive) = parts.iter().find(|p| p.get("type").and_then(Value::as_str) == Some("string")) {
        if parts.iter().all(|p| p.get("type").and_then(Value::as_str) != Some("object") || is_empty_object(p)) {
            return primitive.clone();
        }
    }

    // TypeScript would distribute a union across the intersection, giving an anyOf of ten
    // branches for `{ id } & Partial<GameSettingsUIComponents>`. The generator this replaces
    // flattened them into one object instead, and following suit keeps the schema accepting
    // exactly what it accepted before -- distributing would be stricter and would start
    // rejecting partner configs that validate today.
    let mut flattened = Vec::new();
    for part in parts {
        match part.get("anyOf").and_then(Value::as_array) {
            Some(branches) => flattened.extend(branches.iter().cloned()),
            None => flattened.push(part),
        }
    }

    merge_objects(flattened)
}

fn merge_objects(parts: Vec<Value>) -> Value {
    let mut properties = Map::new();
    let mut required: Vec<Value> = Vec::new();
    let mut additional = json!(false);

    for part in parts {
        if let Some(props) = part.get("properties").and_then(Value::as_object) {
            for (key, value) in props {
                // A property declared in more than one member takes the union of its forms, so
                // `ExpressionSetup & { stableID: string }` keeps the nullable stableID and the
                // ten settings variants collapse their `type` literals into one enum.
                match properties.remove(key) {
                    Some(existing) => {
                        properties.insert(key.clone(), combine_union(vec![existing, value.clone()]));
                    }
                    None => {
                        properties.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        if let Some(Value::Array(names)) = part.get("required") {
            for name in names {
                if !required.contains(name) {
                    required.push(name.clone());
                }
            }
        }
        if let Some(extra) = part.get("additionalProperties") {
            if extra != &json!(false) {
                additional = extra.clone();
            }
        }
    }

    let mut object = Map::new();
    object.insert("type".into(), json!("object"));
    object.insert("properties".into(), Value::Object(properties));
    if !required.is_empty() {
        object.insert("required".into(), Value::Array(required));
    }
    object.insert("additionalProperties".into(), additional);
    Value::Object(object)
}

fn is_empty_object(value: &Value) -> bool {
    value.get("properties").and_then(Value::as_object).is_none_or(Map::is_empty)
}

/// `Partial<T>` drops every requirement, distributing over a union the way TypeScript does.
fn make_partial(schema: Value) -> Value {
    if let Some(Value::Array(branches)) = schema.get("anyOf") {
        let relaxed: Vec<Value> = branches.iter().cloned().map(make_partial).collect();
        return json!({ "anyOf": relaxed });
    }

    let mut object = schema.as_object().cloned().unwrap_or_default();
    object.remove("required");
    Value::Object(object)
}

fn pick(schema: Value, keys: &BTreeSet<String>) -> Value {
    filter_properties(schema, |name| keys.contains(name))
}

fn omit(schema: Value, keys: &BTreeSet<String>) -> Value {
    filter_properties(schema, |name| !keys.contains(name))
}

fn filter_properties(schema: Value, keep: impl Fn(&str) -> bool + Copy) -> Value {
    if let Some(Value::Array(branches)) = schema.get("anyOf") {
        let filtered: Vec<Value> = branches.iter().cloned().map(|b| filter_properties(b, keep)).collect();
        return json!({ "anyOf": filtered });
    }

    let mut object = schema.as_object().cloned().unwrap_or_default();
    if let Some(Value::Object(properties)) = object.get_mut("properties") {
        properties.retain(|name, _| keep(name));
    }
    if let Some(Value::Array(required)) = object.get_mut("required") {
        required.retain(|name| name.as_str().is_some_and(keep));
        if required.is_empty() {
            object.remove("required");
        }
    }
    Value::Object(object)
}

/// The JSDoc block immediately before `position`, if there is one.
fn doc_comment(source: &str, position: u32) -> Option<String> {
    let before = &source[..position as usize];
    let end = before.rfind("*/")?;
    // Only count it when nothing but whitespace sits between the comment and the member.
    if !before[end + 2..].trim().is_empty() {
        return None;
    }
    let start = before[..end].rfind("/**")?;
    Some(before[start + 3..end].to_string())
}

/// Turns a JSDoc body into description, examples and pattern.
fn apply_docs(schema: &mut Value, body: &str) {
    let cleaned: Vec<String> = body
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            match trimmed.strip_prefix('*') {
                Some(rest) => rest.strip_prefix(' ').unwrap_or(rest).to_string(),
                None => trimmed.to_string(),
            }
        })
        .collect();

    let mut description: Vec<String> = Vec::new();
    let mut examples: Vec<String> = Vec::new();
    let mut pattern: Option<String> = None;
    let mut current: Option<Vec<String>> = None;

    for line in cleaned {
        let tag = line.trim_start();
        if let Some(rest) = tag.strip_prefix("@example") {
            if let Some(previous) = current.take() {
                examples.push(previous.join("\n").trim().to_string());
            }
            current = Some(vec![rest.trim().to_string()]);
            continue;
        }
        if let Some(rest) = tag.strip_prefix("@pattern") {
            pattern = Some(rest.trim().to_string());
            continue;
        }
        if tag.starts_with('@') {
            // Any other tag ends the preceding block and is not carried into the schema.
            if let Some(previous) = current.take() {
                examples.push(previous.join("\n").trim().to_string());
            }
            continue;
        }

        match current.as_mut() {
            Some(block) => block.push(line),
            None => description.push(line),
        }
    }
    if let Some(previous) = current {
        examples.push(previous.join("\n").trim().to_string());
    }

    let Some(object) = schema.as_object_mut() else { return };

    let text = reflow(&description);
    if !text.is_empty() {
        object.insert("description".into(), json!(text));
    }
    examples.retain(|e| !e.is_empty());
    if !examples.is_empty() {
        object.insert("examples".into(), json!(examples));
    }
    if let Some(pattern) = pattern {
        object.insert("pattern".into(), json!(pattern));
    }
}

/// Joins hard-wrapped paragraphs onto one line, keeping blank lines and markdown list items.
fn reflow(lines: &[String]) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut paragraph: Vec<String> = Vec::new();

    let flush = |paragraph: &mut Vec<String>, out: &mut Vec<String>| {
        if !paragraph.is_empty() {
            out.push(paragraph.join(" "));
            paragraph.clear();
        }
    };

    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            flush(&mut paragraph, &mut out);
            if out.last().is_some_and(|l| !l.is_empty()) {
                out.push(String::new());
            }
            continue;
        }
        // A list item or fenced code line stands on its own rather than being joined.
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("```") {
            flush(&mut paragraph, &mut out);
            out.push(trimmed.to_string());
            continue;
        }
        paragraph.push(trimmed.to_string());
    }
    flush(&mut paragraph, &mut out);

    while out.last().is_some_and(String::is_empty) {
        out.pop();
    }
    out.join("\n").trim().to_string()
}
