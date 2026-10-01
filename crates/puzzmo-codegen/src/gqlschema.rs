//! A lookup layer over api-schema.graphql, for the codegen steps that read the schema.
//!
//! graphql-parser gives an AST; this indexes it by name and answers the questions the generators
//! ask: what fields does a type have, is a type an object or an enum, what does a field print as.

use anyhow::{Context, Result};
use graphql_parser::schema::{Definition, Document, Field, TypeDefinition};
use std::collections::HashMap;
use std::path::Path;

pub struct Schema {
    document: Document<'static, String>,
    /// Index into `document.definitions` by type name.
    by_name: HashMap<String, usize>,
}

impl Schema {
    pub fn load(path: &Path) -> Result<Schema> {
        let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
        Schema::parse(&text).with_context(|| format!("parsing {}", path.display()))
    }

    /// Builds a schema from SDL text, for tests and for callers that already have it in memory.
    pub fn parse(text: &str) -> Result<Schema> {
        let document = graphql_parser::parse_schema::<String>(text)?.into_static();

        let mut by_name = HashMap::new();
        for (index, definition) in document.definitions.iter().enumerate() {
            if let Definition::TypeDefinition(type_definition) = definition {
                by_name.insert(type_name(type_definition).to_string(), index);
            }
        }

        Ok(Schema { document, by_name })
    }

    /// Every type definition, in the order the schema file declares them.
    pub fn definitions(&self) -> impl Iterator<Item = &TypeDefinition<'static, String>> {
        self.document.definitions.iter().filter_map(|definition| match definition {
            Definition::TypeDefinition(type_definition) => Some(type_definition),
            _ => None,
        })
    }

    pub fn get(&self, name: &str) -> Option<&TypeDefinition<'static, String>> {
        let index = *self.by_name.get(name)?;
        match &self.document.definitions[index] {
            Definition::TypeDefinition(type_definition) => Some(type_definition),
            _ => None,
        }
    }

    pub fn is_object(&self, name: &str) -> bool {
        matches!(self.get(name), Some(TypeDefinition::Object(_)))
    }

    pub fn is_enum(&self, name: &str) -> bool {
        matches!(self.get(name), Some(TypeDefinition::Enum(_)))
    }

    pub fn is_interface(&self, name: &str) -> bool {
        matches!(self.get(name), Some(TypeDefinition::Interface(_)))
    }

    pub fn is_input(&self, name: &str) -> bool {
        matches!(self.get(name), Some(TypeDefinition::InputObject(_)))
    }

    pub fn union_members(&self, name: &str) -> Option<&[String]> {
        match self.get(name) {
            Some(TypeDefinition::Union(union)) => Some(&union.types),
            _ => None,
        }
    }

    /// The fields of an object or interface, in declaration order.
    pub fn fields(&self, name: &str) -> Option<&[Field<'static, String>]> {
        match self.get(name)? {
            TypeDefinition::Object(object) => Some(&object.fields),
            TypeDefinition::Interface(interface) => Some(&interface.fields),
            _ => None,
        }
    }

    pub fn field(&self, type_name: &str, field_name: &str) -> Option<&Field<'static, String>> {
        self.fields(type_name)?.iter().find(|f| f.name == field_name)
    }
}

pub fn type_name<'a>(definition: &'a TypeDefinition<'static, String>) -> &'a str {
    match definition {
        TypeDefinition::Scalar(t) => &t.name,
        TypeDefinition::Object(t) => &t.name,
        TypeDefinition::Interface(t) => &t.name,
        TypeDefinition::Union(t) => &t.name,
        TypeDefinition::Enum(t) => &t.name,
        TypeDefinition::InputObject(t) => &t.name,
    }
}

/// Prints a field definition the way the generated `/*SDL: ...*/` comments carry it.
///
/// graphql-parser's Display writes a field as part of a type body, indented and newline-terminated,
/// so this trims it back to the bare `name(args): Type` plus any description above it.
pub fn print_field(field: &Field<'static, String>) -> String {
    let mut out = String::new();

    if let Some(description) = &field.description {
        out.push_str(&print_description(description));
        out.push('\n');
    }

    out.push_str(&field.name);
    if !field.arguments.is_empty() {
        let rendered: Vec<(Option<&String>, String)> = field
            .arguments
            .iter()
            .map(|argument| {
                let mut text = format!("{}: {}", argument.name, argument.value_type);
                if let Some(default) = &argument.default_value {
                    text.push_str(&format!(" = {default}"));
                }
                for directive in &argument.directives {
                    text.push_str(&print_directive(directive));
                }
                (argument.description.as_ref(), text)
            })
            .collect();

        // An argument carrying a description forces the whole list onto its own lines, which is
        // the only way the description has somewhere to sit.
        if rendered.iter().any(|(description, _)| description.is_some()) {
            out.push_str("(\n");
            for (description, text) in &rendered {
                if let Some(description) = description {
                    out.push_str(&format!("  {}\n", indent_continuations(&print_description(description), "  ")));
                }
                out.push_str(&format!("  {text}\n"));
            }
            out.push(')');
        } else {
            let args: Vec<&str> = rendered.iter().map(|(_, text)| text.as_str()).collect();
            out.push_str(&format!("({})", args.join(", ")));
        }
    }
    out.push_str(&format!(": {}", field.field_type));

    for directive in &field.directives {
        out.push_str(&print_directive(directive));
    }

    out
}

fn print_directive(directive: &graphql_parser::schema::Directive<'static, String>) -> String {
    let mut out = format!(" @{}", directive.name);
    if !directive.arguments.is_empty() {
        let args: Vec<String> = directive.arguments.iter().map(|(name, value)| format!("{name}: {value}")).collect();
        out.push_str(&format!("({})", args.join(", ")));
    }
    out
}

/// Indents a printed field's continuation lines, for comments that sit inside an interface body.
pub fn indent_continuations(text: &str, indent: &str) -> String {
    let mut lines = text.lines();
    let first = lines.next().unwrap_or("").to_string();
    let rest: Vec<String> = lines.map(|line| format!("{indent}{line}")).collect();
    if rest.is_empty() { first } else { format!("{first}\n{}", rest.join("\n")) }
}

/// A description as GraphQL spells it: a block string when it spans lines, otherwise quoted.
pub fn print_description(description: &str) -> String {
    if description.contains('\n') {
        return format!("\"\"\"\n{description}\n\"\"\"");
    }
    format!("{:?}", description)
}
