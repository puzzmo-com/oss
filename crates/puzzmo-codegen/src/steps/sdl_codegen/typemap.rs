//! Maps GraphQL types to the TypeScript the generated resolver types use.
//!
//! Replaces typeMap.ts. The odd spacing is deliberate and matched: a nullable type gets `| null`
//! with no space before it, while an optional one gets ` | undefined` with one, because the TS
//! built those two suffixes differently. The arg builder then strips `| undefined` and leaves the
//! space behind, which is why generated args read `first?: number ,`.

use graphql_parser::schema::Type;
use std::collections::BTreeSet;

use crate::gqlschema::Schema;

#[derive(Default)]
pub struct Referenced {
    pub types: Vec<String>,
    pub scalars: Vec<String>,
    pub prisma: Vec<String>,
}

pub struct TypeMapper<'a> {
    schema: &'a Schema,
    prisma_models: &'a BTreeSet<String>,
    prefer_prisma: bool,
    referenced: Referenced,
}

#[derive(Default, Clone, Copy)]
pub struct MapConfig {
    pub parent_was_not_null: bool,
    pub prefer_null_over_undefined: bool,
    pub typename_prefix: &'static str,
}

impl<'a> TypeMapper<'a> {
    pub fn new(schema: &'a Schema, prisma_models: &'a BTreeSet<String>, prefer_prisma: bool) -> Self {
        TypeMapper { schema, prisma_models, prefer_prisma, referenced: Referenced::default() }
    }

    pub fn referenced(&self) -> &Referenced {
        &self.referenced
    }

    pub fn map(&mut self, ty: &Type<'static, String>, config: MapConfig) -> String {
        if let Type::NonNullType(inner) = ty {
            return self.map(inner, MapConfig { parent_was_not_null: true, ..config });
        }

        let inner = self.inner(ty, config);
        format!("{inner}{}", suffix_for(config))
    }

    fn inner(&mut self, ty: &Type<'static, String>, config: MapConfig) -> String {
        match ty {
            Type::NonNullType(inner) => self.map(inner, MapConfig { parent_was_not_null: true, ..config }),
            Type::ListType(element) => {
                let text = self.map(element, config);
                if matches!(**element, Type::NonNullType(_)) {
                    // A union inside a list needs brackets so [] binds to the whole thing.
                    if text.contains('|') { format!("({text})[]") } else { format!("{text}[]") }
                } else {
                    format!("Array<{text}>")
                }
            }
            Type::NamedType(name) => self.named(name, config),
        }
    }

    fn named(&mut self, name: &str, config: MapConfig) -> String {
        if self.schema.is_object(name) {
            if self.prefer_prisma && self.prisma_models.contains(name) {
                push_unique(&mut self.referenced.prisma, name);
                return format!("P{name}");
            }
            push_unique(&mut self.referenced.types, name);
            return format!("{}{name}", config.typename_prefix);
        }

        if self.schema.is_interface(name) || self.schema.is_enum(name) || self.schema.is_input(name) {
            push_unique(&mut self.referenced.types, name);
            return format!("{}{name}", config.typename_prefix);
        }

        if let Some(members) = self.schema.union_members(name) {
            push_unique(&mut self.referenced.types, name);
            let members: Vec<String> = members.to_vec();
            // Each member is mapped through the full `map`, so it picks up its own nullability
            // suffix -- and the caller then adds one more. That double suffix is what the TS
            // produced, so it is reproduced rather than tidied.
            let mapped: Vec<String> = members
                .iter()
                .map(|member| {
                    let inner = self.named(member, config);
                    format!("{inner}{}", suffix_for(config))
                })
                .collect();
            return mapped.join(" | ");
        }

        // Everything left is a scalar. Only four have a TypeScript equivalent; the rest, `ID`
        // included, keep their name and get a `type X = any` alias emitted alongside.
        match name {
            "Int" | "Float" => "number".into(),
            "String" => "string".into(),
            "Boolean" => "boolean".into(),
            other => {
                push_unique(&mut self.referenced.scalars, other);
                other.to_string()
            }
        }
    }
}

/// The nullability suffix, with the TS's asymmetric spacing preserved.
fn suffix_for(config: MapConfig) -> &'static str {
    if config.parent_was_not_null {
        ""
    } else if config.prefer_null_over_undefined {
        "| null"
    } else {
        " | undefined"
    }
}

fn push_unique(into: &mut Vec<String>, value: &str) {
    if !into.iter().any(|existing| existing == value) {
        into.push(value.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gqlschema::Schema;

    const SDL: &str = "
        type Game { id: ID! }
        type Note { id: ID! }
        enum Colour { Red }
        union Thing = Game | Note
        input Filter { q: String }
        scalar JSON
        type Query { a: Int }
    ";

    fn mapper<'a>(schema: &'a Schema, models: &'a BTreeSet<String>, prefer_prisma: bool) -> TypeMapper<'a> {
        TypeMapper::new(schema, models, prefer_prisma)
    }

    fn map(text: &str, prefer_prisma: bool, config: MapConfig) -> String {
        let sdl = format!("{SDL}\ntype Probe {{ field: {text} }}");
        let schema = Schema::parse(&sdl).expect("parses");
        let models: BTreeSet<String> = ["Game".to_string()].into_iter().collect();
        let field = schema.field("Probe", "field").expect("field").field_type.clone();
        mapper(&schema, &models, prefer_prisma).map(&field, config)
    }

    const NULLABLE: MapConfig = MapConfig { parent_was_not_null: false, prefer_null_over_undefined: true, typename_prefix: "" };
    const OPTIONAL: MapConfig = MapConfig { parent_was_not_null: false, prefer_null_over_undefined: false, typename_prefix: "" };

    #[test]
    fn nullability_suffixes_keep_their_asymmetric_spacing() {
        // `| null` has no leading space and ` | undefined` does. The arg builder strips the
        // second and leaves its space, which is why generated args read `first?: number ,`.
        assert_eq!(map("Int", false, NULLABLE), "number| null");
        assert_eq!(map("Int", false, OPTIONAL), "number | undefined");
        assert_eq!(map("Int!", false, NULLABLE), "number");
    }

    #[test]
    fn a_union_suffixes_each_member_and_then_itself() {
        // Each member is mapped through the full map, so it gets its own suffix, and the union
        // then gets another. Reproduced deliberately, not tidied.
        assert_eq!(map("Thing", false, NULLABLE), "Game| null | Note| null| null");
        // Non-null suppresses every suffix, including the members' own.
        assert_eq!(map("Thing!", false, NULLABLE), "Game | Note");
    }

    #[test]
    fn lists_bracket_a_union_but_not_a_plain_type() {
        assert_eq!(map("[Int!]!", false, NULLABLE), "number[]");
        assert_eq!(map("[Int!]", false, NULLABLE), "number[]| null");
        // The element inherits the list's non-nullness, so it takes no suffix of its own.
        assert_eq!(map("[Int]!", false, NULLABLE), "Array<number>");
        assert_eq!(map("[Thing!]!", false, NULLABLE), "(Game | Note)[]");
    }

    #[test]
    fn prisma_models_win_only_when_asked_for() {
        assert_eq!(map("Game!", true, NULLABLE), "PGame");
        assert_eq!(map("Game!", false, NULLABLE), "Game");
        // A type with no Prisma model keeps its GraphQL name either way.
        assert_eq!(map("Note!", true, NULLABLE), "Note");
    }

    #[test]
    fn only_four_scalars_have_a_typescript_equivalent() {
        assert_eq!(map("String!", false, NULLABLE), "string");
        assert_eq!(map("Boolean!", false, NULLABLE), "boolean");
        // ID and custom scalars keep their name and get a `type X = any` alias emitted.
        assert_eq!(map("ID!", false, NULLABLE), "ID");
        assert_eq!(map("JSON!", false, NULLABLE), "JSON");
    }

    #[test]
    fn referenced_things_are_tracked_for_the_import_block() {
        let schema = Schema::parse(SDL).expect("parses");
        let models: BTreeSet<String> = ["Game".to_string()].into_iter().collect();
        let mut mapper = mapper(&schema, &models, true);

        let sdl = format!("{SDL}\ntype Probe {{ a: Game!, b: JSON!, c: Note! }}");
        let probe = Schema::parse(&sdl).expect("parses");
        for name in ["a", "b", "c"] {
            let field = probe.field("Probe", name).expect("field").field_type.clone();
            mapper.map(&field, NULLABLE);
        }

        assert_eq!(mapper.referenced().prisma, ["Game"]);
        assert_eq!(mapper.referenced().scalars, ["JSON"]);
        assert_eq!(mapper.referenced().types, ["Note"]);
    }
}
