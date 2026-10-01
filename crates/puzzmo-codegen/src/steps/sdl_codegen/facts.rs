//! Reads what a service file says about its resolvers.
//!
//! Replaces serviceFile.codefacts.ts, which used ts-morph. Everything needed is syntax: which
//! exports there are, whether each is a function, how many parameters it takes, whether it is
//! async, and whether its body is a bare literal.

use anyhow::Result;
use oxc_allocator::Allocator;
use oxc_ast::ast::{ArrowFunctionBody, BindingPattern, Declaration, Expression, ObjectPropertyKind};

use crate::ts;

/// How a resolver's second parameter is written, which decides whether context/info are optional.
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum InfoParam {
    All,
    /// `(args, { root })` -- very common here, and it means context and info go unused.
    JustRootDestructured,
}

#[derive(Debug, Clone)]
pub struct Resolver {
    pub name: String,
    pub func_arg_count: usize,
    pub is_func: bool,
    pub is_async: bool,
    pub is_obj_literal: bool,
    pub is_unknown: bool,
    pub info_param: InfoParam,
}

/// A group of resolvers: either the file's bare exports, or one exported object of them.
#[derive(Debug)]
pub struct ModelFacts {
    pub type_name: String,
    pub resolvers: Vec<Resolver>,
    pub has_generic_arg: bool,
}

/// The pseudo-type holding a file's top-level Query and Mutation resolvers.
pub const ROOT: &str = "maybe_query_mutation";

pub fn for_file(path: &str, source: &str) -> Result<Vec<ModelFacts>> {
    let allocator = Allocator::default();
    let program = ts::parse(&allocator, path, source)?;

    let mut root = ModelFacts { type_name: ROOT.into(), resolvers: Vec::new(), has_generic_arg: false };
    let mut models = Vec::new();

    // Only exported declarations describe resolvers; a file-local helper is not one.
    for statement in &program.body {
        let oxc_ast::ast::Statement::ExportDeclaration(export) = statement else { continue };
        let Declaration::VariableDeclaration(variables) = &export.declaration else { continue };

        for declarator in &variables.declarations {
            let Some(name) = declarator.id.get_identifier_name() else { continue };
            let name = name.to_string();

            // A capitalised export is a container of field resolvers for that GraphQL type.
            if starts_with_uppercase(&name) {
                if let Some(model) = container_facts(&name, declarator, source) {
                    models.push(model);
                }
                continue;
            }

            root.resolvers.push(Resolver {
                name,
                ..resolver_facts(declarator.init.as_ref())
            });
        }
    }

    let mut all = Vec::new();
    if !root.resolvers.is_empty() {
        all.push(root);
    }
    all.extend(models);
    Ok(all)
}

/// The field resolvers inside `export const Thing = { ... }`.
fn container_facts(
    name: &str,
    declarator: &oxc_ast::ast::VariableDeclarator,
    source: &str,
) -> Option<ModelFacts> {
    // Only a real type name describes resolvers; `_helper` reaches here but is not one.
    if !name.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
        return None;
    }

    // The TS read the declared type's text and looked for a `<`, which is how it spotted a
    // generic resolver container like `UserTypeResolvers<Extended>`.
    let has_generic_arg = declarator
        .type_annotation
        .as_ref()
        .is_some_and(|annotation| ts::text(source, annotation.span).contains('<'));

    let Some(Expression::ObjectExpression(object)) = &declarator.init else { return None };

    let mut resolvers = Vec::new();
    for property in &object.properties {
        // A spread carries no name, so there is nothing to generate for it.
        let ObjectPropertyKind::ObjectProperty(property) = property else { continue };
        let Some(key) = property.key.static_name() else { continue };

        resolvers.push(Resolver {
            name: key.to_string(),
            ..resolver_facts(Some(&property.value))
        });
    }

    Some(ModelFacts { type_name: name.to_string(), resolvers, has_generic_arg })
}

/// Everything the generator needs to know about one resolver's implementation.
fn resolver_facts(initialiser: Option<&Expression>) -> Resolver {
    let unknown = Resolver {
        name: String::new(),
        func_arg_count: 0,
        is_func: false,
        is_async: false,
        is_obj_literal: false,
        is_unknown: true,
        info_param: InfoParam::All,
    };

    let Some(initialiser) = initialiser else { return unknown };

    let (params, is_async, body_is_literal) = match initialiser {
        Expression::ArrowFunctionExpression(arrow) => {
            // An expression-bodied arrow returning a literal needs no Promise wrapping.
            let literal = match &arrow.body {
                ArrowFunctionBody::FunctionBody(_) => false,
                body => body.as_expression().is_some_and(is_literal),
            };
            (&arrow.params, arrow.r#async, literal)
        }
        Expression::FunctionExpression(function) => (&function.params, function.r#async, false),
        other if is_literal(other) => {
            return Resolver { is_obj_literal: true, is_unknown: false, ..unknown };
        }
        _ => return unknown,
    };

    Resolver {
        func_arg_count: params.items.len(),
        is_func: true,
        is_async,
        is_obj_literal: body_is_literal,
        is_unknown: false,
        info_param: info_param_for(params),
        ..unknown
    }
}

/// `(args, { root })` means context and info are never touched, so they print as optional.
fn info_param_for(params: &oxc_ast::ast::FormalParameters) -> InfoParam {
    let Some(second) = params.items.get(1) else { return InfoParam::All };
    let BindingPattern::ObjectPattern(pattern) = &second.pattern else { return InfoParam::All };

    let only_root = pattern.rest.is_none()
        && pattern.properties.len() == 1
        && pattern.properties[0].key.static_name().as_deref() == Some("root");

    if only_root { InfoParam::JustRootDestructured } else { InfoParam::All }
}

/// Mirrors the TS test `name[0] === name[0].toUpperCase()`, which is also true for `_` and `$`.
/// Those are not GraphQL types, so container_facts drops them and they generate nothing -- which
/// is how an `export const _helper` in a service file stays out of the generated types.
fn starts_with_uppercase(name: &str) -> bool {
    match name.chars().next() {
        Some(first) => first.to_uppercase().next() == Some(first),
        None => false,
    }
}

fn is_literal(expression: &Expression) -> bool {
    matches!(
        expression,
        Expression::ObjectExpression(_)
            | Expression::StringLiteral(_)
            | Expression::TemplateLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(source: &str) -> Vec<ModelFacts> {
        for_file("probe.ts", source).expect("parses")
    }

    fn root(source: &str) -> Vec<Resolver> {
        facts(source).into_iter().find(|m| m.type_name == ROOT).map(|m| m.resolvers).unwrap_or_default()
    }

    #[test]
    fn only_exported_declarations_are_resolvers() {
        let resolvers = root("const helper = () => 1\nexport const thing = () => 2\n");
        assert_eq!(resolvers.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["thing"]);
    }

    #[test]
    fn underscore_exports_generate_nothing() {
        // `_x`[0] equals its own uppercase, so it is treated as a container and then dropped for
        // not starting with a capital. That accident is what keeps file-local helpers out.
        let all = facts("export const _hydrate = () => 1\nexport const thing = () => 2\n");
        assert_eq!(all.len(), 1, "only the root group should exist");
        assert_eq!(all[0].resolvers.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["thing"]);
    }

    #[test]
    fn async_and_arity_drive_the_return_type() {
        let resolvers = root(
            "export const a = async () => 1\nexport const b = (args) => 2\nexport const c = (args, obj) => 3\n",
        );
        assert!(resolvers[0].is_async && resolvers[0].func_arg_count == 0);
        assert!(!resolvers[1].is_async && resolvers[1].func_arg_count == 1);
        assert_eq!(resolvers[2].func_arg_count, 2);
    }

    #[test]
    fn a_bare_literal_body_needs_no_promise_wrapping() {
        let resolvers = root(
            "export const a = () => \"x\"\nexport const b = () => 1\nexport const c = () => ({ x: 1 })\nexport const d = () => { return 1 }\n",
        );
        assert!(resolvers[0].is_obj_literal, "a string body is a literal");
        assert!(resolvers[1].is_obj_literal, "a number body is a literal");
        // `() => ({ ... })` is a *parenthesised* expression, and ts-morph's isLiteral did not
        // count those either, so it is widened to the full union like any other call.
        assert!(!resolvers[2].is_obj_literal, "a parenthesised object is not");
        assert!(!resolvers[3].is_obj_literal, "a block body is not");
    }

    #[test]
    fn destructuring_just_root_makes_context_and_info_optional() {
        let resolvers = root(
            "export const a = (args, { root }) => 1\nexport const b = (args, { root, context }) => 2\nexport const c = (args, obj) => 3\n",
        );
        assert_eq!(resolvers[0].info_param, InfoParam::JustRootDestructured);
        assert_eq!(resolvers[1].info_param, InfoParam::All, "more than root means context is used");
        assert_eq!(resolvers[2].info_param, InfoParam::All);
    }

    #[test]
    fn a_capitalised_export_is_a_field_resolver_container() {
        let all = facts("export const User: UserTypeResolvers = {\n  name: () => \"x\",\n  age: async () => 1,\n}\n");
        let user = all.iter().find(|m| m.type_name == "User").expect("User container");
        assert_eq!(user.resolvers.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["name", "age"]);
        assert!(!user.has_generic_arg);
    }

    #[test]
    fn a_generic_annotation_is_detected_from_its_text() {
        let all = facts("export const User: UserTypeResolvers<Extended> = { name: () => \"x\" }\n");
        assert!(all.iter().find(|m| m.type_name == "User").expect("User").has_generic_arg);
    }

    #[test]
    fn an_unknown_initialiser_is_not_assumed_to_be_a_function() {
        let resolvers = root("export const a = someHelper()\n");
        assert!(resolvers[0].is_unknown && !resolvers[0].is_func);
    }
}
