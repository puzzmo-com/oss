//! Generates apps/api.puzzmo.com/types/*.d.ts from the schema, the Prisma models and the services.
//!
//! Replaces packages/sdl-codegen. The per-service files describe each resolver's signature; the two
//! shared files describe every GraphQL type, once in argument position and once in return position.

pub mod facts;
pub mod shared;
pub mod typemap;

use anyhow::{Context, Result};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use crate::gqlschema::{Schema, indent_continuations, print_field};
use facts::{InfoParam, ModelFacts, Resolver};
use typemap::{MapConfig, TypeMapper};

const SCHEMA: &str = "api-schema.graphql";
const SERVICES_DIR: &str = "apps/api.puzzmo.com/src/services";
const PRISMA_DIR: &str = "apps/api.puzzmo.com/prisma/schema";
pub const TYPES_DIR: &str = "apps/api.puzzmo.com/types";

/// Which fields of a GraphQL type a service file implements a resolver for.
pub type FieldFacts = BTreeMap<String, BTreeSet<String>>;

pub struct Generated {
    pub files: Vec<(String, String)>,
    pub field_facts: FieldFacts,
}

/// Generates every per-service file, collecting the field facts the shared files need.
pub fn render(root: &Path) -> Result<Generated> {
    let schema = Schema::load(&root.join(SCHEMA))?;
    let prisma_models = prisma_model_names(&root.join(PRISMA_DIR))?;

    let mut files = Vec::new();
    let mut field_facts: FieldFacts = BTreeMap::new();

    for path in service_files(&root.join(SERVICES_DIR))? {
        let source = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
        let display = path.strip_prefix(root).unwrap_or(&path).display().to_string();

        let models = facts::for_file(&display, &source)?;
        if models.is_empty() {
            continue;
        }

        let file_name = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
        let contents = render_service(&schema, &prisma_models, &models, &mut field_facts)?;
        if contents.trim().is_empty() {
            continue;
        }
        files.push((format!("{TYPES_DIR}/{file_name}.d.ts"), contents));
    }

    // The shared files are written last because their field optionality depends on which
    // resolvers the service files turned out to implement.
    let prisma = crate::prisma::models(&crate::prisma::read_schema_dir(&root.join(PRISMA_DIR))?)?
        .into_iter()
        .map(|model| (model.name.clone(), model))
        .collect();
    files.extend(shared::render(&schema, &prisma, &field_facts)?);

    Ok(Generated { files, field_facts })
}

/// Every `.ts` under services that is a resolver file, sorted.
fn service_files(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut found = Vec::new();
    collect(dir, &mut found)?;
    found.sort();
    Ok(found)
}

fn collect(dir: &Path, into: &mut Vec<PathBuf>) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).with_context(|| format!("reading {}", dir.display()))? {
        let path = entry?.path();
        if path.is_dir() {
            collect(&path, into)?;
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let skip = name.ends_with(".d.ts")
            || name.ends_with(".test.ts")
            || name.ends_with(".test.js")
            || name.ends_with("scenarios.ts")
            || name.ends_with("scenarios.js");
        if !skip && (name.ends_with(".ts") || name.ends_with(".tsx") || name.ends_with(".js")) {
            into.push(path);
        }
    }
    Ok(())
}

/// Model names from the Prisma schema, which decide when a GraphQL type maps to a Prisma one.
fn prisma_model_names(dir: &Path) -> Result<BTreeSet<String>> {
    let schema = crate::prisma::read_schema_dir(dir)?;
    Ok(crate::prisma::models(&schema)?.into_iter().map(|m| m.name).collect())
}

fn render_service(
    schema: &Schema,
    prisma_models: &BTreeSet<String>,
    models: &[ModelFacts],
    field_facts: &mut FieldFacts,
) -> Result<String> {
    let mut external = TypeMapper::new(schema, prisma_models, true);
    let mut returns = TypeMapper::new(schema, prisma_models, false);

    let mut body = String::new();
    let mut extra_prisma: Vec<String> = Vec::new();
    let mut shared_schema_types: Vec<String> = Vec::new();
    let mut extra_shared: Vec<(String, String)> = Vec::new();
    let mut body_prefix = String::new();

    for model in models {
        if model.type_name == facts::ROOT {
            for resolver in &model.resolvers {
                let parent = if schema.field("Query", &resolver.name).is_some() {
                    "Query"
                } else if schema.field("Mutation", &resolver.name).is_some() {
                    "Mutation"
                } else {
                    body.push_str(&format!(
                        "/*This resolver does not exist on Query or Mutation*/\nexport interface {} {{}}\n",
                        resolver.name
                    ));
                    continue;
                };

                if !shared_schema_types.iter().any(|t| t == parent) {
                    shared_schema_types.push(parent.to_string());
                }
                let interface = top_level_interface(
                    schema,
                    &mut external,
                    &mut returns,
                    parent,
                    resolver,
                    &mut body_prefix,
                );
                body.push_str(&body_prefix);
                body_prefix.clear();
                body.push_str(&interface);
            }
            continue;
        }

        // A capitalised export describes field resolvers on a GraphQL object type.
        let model_name = &model.type_name;
        if !schema.is_object(model_name) {
            continue;
        }
        if !extra_prisma.iter().any(|p| p == model_name) {
            extra_prisma.push(model_name.clone());
        }
        if !prisma_models.contains(model_name) {
            extra_shared.push((model_name.clone(), format!("S{model_name}")));
        }

        let entry = field_facts.entry(model_name.clone()).or_default();
        for resolver in &model.resolvers {
            if schema.field(model_name, &resolver.name).is_some() {
                entry.insert(resolver.name.clone());
            }
        }

        body.push_str(&type_resolvers(schema, prisma_models, &mut external, &mut returns, model)?);
    }

    let mut out = body;

    // Scalar aliases, then the imports, which the generator wrote at the bottom of the file.
    let mut scalars: Vec<String> = Vec::new();
    for scalar in external.referenced().scalars.iter().chain(returns.referenced().scalars.iter()) {
        if !scalars.iter().any(|s| s == scalar) {
            scalars.push(scalar.clone());
        }
    }
    for scalar in &scalars {
        out.push_str(&format!("type {scalar} = any;\n"));
    }

    let mut imports: Vec<String> = Vec::new();
    let mut prisma_imports: Vec<String> = external.referenced().prisma.clone();
    for name in returns.referenced().prisma.iter().chain(extra_prisma.iter()) {
        if !prisma_imports.iter().any(|p| p == name) {
            prisma_imports.push(name.clone());
        }
    }
    prisma_imports.retain(|name| prisma_models.contains(name));
    if !prisma_imports.is_empty() {
        let subs: Vec<String> = prisma_imports.iter().map(|p| format!("{p} as P{p}")).collect();
        imports.push(format!("import {{ {} }} from \"@prisma/client\";", subs.join(", ")));
    }

    if out.contains("GraphQLResolveInfo") {
        imports.push("import { GraphQLResolveInfo } from \"graphql\";".into());
    }
    if out.contains("RedwoodGraphQLContext") {
        imports.push("import { RedwoodGraphQLContext } from \"@redwoodjs/graphql-server/dist/types\";".into());
    }

    let return_types = &returns.referenced().types;
    if !return_types.is_empty() || !extra_shared.is_empty() {
        let mut subs: Vec<String> = return_types.iter().map(|t| format!("{t} as RT{t}")).collect();
        subs.extend(extra_shared.iter().map(|(import, alias)| format!("{import} as {alias}")));
        imports.push(format!("import {{ {} }} from \"./shared-return-types\";", subs.join(", ")));
    }

    let mut schema_types: Vec<String> = external.referenced().types.clone();
    for name in &shared_schema_types {
        if !schema_types.iter().any(|t| t == name) {
            schema_types.push(name.clone());
        }
    }
    if !schema_types.is_empty() {
        imports.push(format!("import {{ {} }} from \"./shared-schema-types\";", schema_types.join(", ")));
    }

    if !imports.is_empty() {
        out.push_str(&imports.join("\n"));
    }

    Ok(out)
}

fn top_level_interface(
    schema: &Schema,
    external: &mut TypeMapper,
    returns: &mut TypeMapper,
    parent: &str,
    resolver: &Resolver,
    args_interfaces: &mut String,
) -> String {
    let field = schema.field(parent, &resolver.name).expect("checked by the caller");
    let interface_name = format!("{}Resolver", capitalise(&resolver.name));

    let inline = inline_args(field, external);
    let args_type = match inline {
        None => "object".to_string(),
        Some(ref text) if text.len() < 120 => text.clone(),
        Some(_) => {
            let name = format!("{interface_name}Args");
            let members: Vec<String> = field
                .arguments
                .iter()
                .map(|argument| {
                    format!("  {}: {};", argument.name, external.map(&argument.value_type, MapConfig::default()))
                })
                .collect();
            args_interfaces.push_str(&format!("interface {name} {{\n{}\n}}\n", members.join("\n")));
            name
        }
    };

    let optional_info = if resolver.info_param == InfoParam::JustRootDestructured { "?" } else { "" };
    let return_type = return_type_for(returns, Some(field), resolver);

    let args_optional = if resolver.func_arg_count < 1 { "?" } else { "" };
    let obj_optional = if resolver.func_arg_count < 2 { "?" } else { "" };

    format!(
        "/*SDL: {}*/\nexport interface {interface_name} {{\n  (args{args_optional}: {args_type}, obj{obj_optional}: {{ root: {parent}, context{optional_info}: RedwoodGraphQLContext, info{optional_info}: GraphQLResolveInfo }}): {return_type};\n}}\n",
        print_field(field)
    )
}

fn type_resolvers(
    schema: &Schema,
    prisma_models: &BTreeSet<String>,
    external: &mut TypeMapper,
    returns: &mut TypeMapper,
    model: &ModelFacts,
) -> Result<String> {
    let model_name = &model.type_name;
    let generic = if model.has_generic_arg { "<Extended>" } else { "" };

    let mut parent_fns = Vec::new();
    for resolver in &model.resolvers {
        let field = schema.field(model_name, &resolver.name);
        let return_type = return_type_for(external, field, resolver);
        let prefix = if field.is_none() {
            "\n// This field does not exist in the generated schema.graphql\n"
        } else {
            ""
        };
        parent_fns.push(format!("{prefix}{}: () => {return_type}", resolver.name));
    }

    let suffix = if prisma_models.contains(model_name) { "P" } else { "S" };
    let additional = if parent_fns.is_empty() { String::new() } else { format!("& {{{}}}", parent_fns.join(", \n")) };
    let extended = if model.has_generic_arg { " & Extended" } else { "" };

    let mut members = Vec::new();
    for resolver in &model.resolvers {
        let Some(field) = schema.field(model_name, &resolver.name) else {
            members.push(format!("  {}: void;", resolver.name));
            continue;
        };

        let args_type = inline_args(field, external).unwrap_or_else(|| "undefined".into());
        let param = if model.has_generic_arg { "<Extended>" } else { "" };
        let first_q = if resolver.func_arg_count < 1 { "?" } else { "" };
        let second_q = if resolver.func_arg_count < 2 { "?" } else { "" };
        let info_q = if resolver.info_param == InfoParam::JustRootDestructured { "?" } else { "" };

        let inner = format!(
            "args{first_q}: {args_type}, obj{second_q}: {{ root: {model_name}AsParent{param}, context{info_q}: RedwoodGraphQLContext, info{info_q}: GraphQLResolveInfo }}"
        );
        let return_type = return_type_for(returns, Some(field), resolver);
        let signature = if resolver.is_func || resolver.is_unknown {
            format!("({inner}) => {return_type}")
        } else {
            return_type
        };

        members.push(format!(
            "  /* SDL: {}*/\n  {}: {signature};",
            indent_continuations(&print_field(field), "  "),
            resolver.name
        ));
    }

    // The interface is registered before the alias, so it prints first even though the alias
    // is what the interface's members refer to.
    let interface_body = if members.is_empty() { "{}".to_string() } else { format!("{{\n{}\n}}", members.join("\n")) };
    Ok(format!(
        "export interface {model_name}TypeResolvers{generic} {interface_body}\ntype {model_name}AsParent{generic} = {suffix}{model_name} {additional} {extended};\n"
    ))
}

/// The resolver's declared return type, widened by how the implementation is written.
fn return_type_for(
    mapper: &mut TypeMapper,
    field: Option<&graphql_parser::schema::Field<'static, String>>,
    resolver: &Resolver,
) -> String {
    let Some(field) = field else { return "void".into() };

    let mapped = mapper.map(&field.field_type, MapConfig {
        prefer_null_over_undefined: true,
        typename_prefix: "RT",
        ..MapConfig::default()
    });

    let all = format!("{mapped} | Promise<{mapped}> | (() => Promise<{mapped}>)");
    if resolver.is_func && resolver.is_async {
        format!("Promise<{mapped}>")
    } else if resolver.is_func && resolver.is_obj_literal {
        mapped
    } else if resolver.is_func {
        all
    } else if resolver.is_obj_literal {
        mapped
    } else if resolver.is_unknown {
        all
    } else {
        mapped
    }
}

/// `{a: string, b?: number }` for a field's arguments, or None when it takes none.
fn inline_args(
    field: &graphql_parser::schema::Field<'static, String>,
    mapper: &mut TypeMapper,
) -> Option<String> {
    if field.arguments.is_empty() {
        return None;
    }

    let parts: Vec<String> = field
        .arguments
        .iter()
        .map(|argument| {
            let mapped = mapper.map(&argument.value_type, MapConfig::default());
            let optional = if mapped.contains("undefined") { "?" } else { "" };
            // Removing the suffix leaves its leading space behind, which is why the generated
            // args read `first?: number ,` -- faithful to what this replaces.
            let display = mapped.replace("| undefined", "");
            format!("{}{optional}: {display}", argument.name)
        })
        .collect();

    Some(format!("{{{}}}", parts.join(", ")))
}

fn capitalise(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
        None => String::new(),
    }
}
