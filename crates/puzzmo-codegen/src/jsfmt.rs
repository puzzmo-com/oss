//! Prints JSON the way oxfmt does, for the generated schema files it formats on the way out.
//!
//! There is no usable oxc formatter crate (oxc_formatter is a 0.0.0 placeholder) and oxfmt ships
//! only as a napi addon, so the rules are reimplemented here. They are narrow because the input is
//! always a JSON Schema document: objects, arrays, strings, numbers and booleans.
//!
//! The two rules that matter, both matching prettier's behaviour that oxfmt follows:
//!
//!   - an object is always expanded, one key per line, because the input had a newline after `{`
//!   - an array collapses onto one line when it fits in the print width, otherwise one item per line
//!
//! Empty objects and arrays print as `{}` and `[]`.

use serde_json::Value;

/// oxfmt's printWidth from .oxfmtrc.json.
pub const PRINT_WIDTH: usize = 140;

const INDENT: usize = 2;

#[derive(Clone, Copy, PartialEq)]
pub enum Flavour {
    /// Strict JSON: every key quoted, no trailing commas.
    Json,
    /// A TypeScript object literal: identifier keys unquoted, trailing commas.
    TypeScript,
}

/// Renders a value at the top level, with a trailing newline.
pub fn print(value: &Value, flavour: Flavour) -> String {
    let mut out = String::new();
    write_value(&mut out, value, 0, flavour);
    out.push('\n');
    out
}

/// Renders a value with no trailing newline, for embedding in a larger file.
pub fn print_inline(value: &Value, indent: usize, flavour: Flavour) -> String {
    let mut out = String::new();
    write_value(&mut out, value, indent, flavour);
    out
}

fn write_value(out: &mut String, value: &Value, indent: usize, flavour: Flavour) {
    match value {
        Value::Object(map) if !map.is_empty() => {
            out.push_str("{\n");
            let inner = indent + INDENT;
            for (i, (key, child)) in map.iter().enumerate() {
                out.push_str(&" ".repeat(inner));
                out.push_str(&render_key(key, flavour));
                out.push(':');

                // TypeScript breaks a scalar onto its own line when `key: value` overruns the
                // width; JSON has nowhere to break so it stays put however long it gets.
                let scalar = !matches!(child, Value::Object(_) | Value::Array(_));
                let overruns = current_column(out) + 1 + single_line(child, flavour).len() > PRINT_WIDTH;
                if flavour == Flavour::TypeScript && scalar && overruns {
                    out.push('\n');
                    out.push_str(&" ".repeat(inner + INDENT));
                } else {
                    out.push(' ');
                }

                write_value(out, child, inner, flavour);

                let last = i + 1 == map.len();
                if !last || flavour == Flavour::TypeScript {
                    out.push(',');
                }
                out.push('\n');
            }
            out.push_str(&" ".repeat(indent));
            out.push('}');
        }
        Value::Array(items) if !items.is_empty() => {
            // The fit test is against the whole line: what is already on it, plus the one-line form.
            let single = single_line(value, flavour);
            let column = current_column(out);
            if column + single.len() <= PRINT_WIDTH {
                out.push_str(&single);
                return;
            }

            out.push_str("[\n");
            let inner = indent + INDENT;
            for (i, item) in items.iter().enumerate() {
                out.push_str(&" ".repeat(inner));
                write_value(out, item, inner, flavour);

                let last = i + 1 == items.len();
                if !last || flavour == Flavour::TypeScript {
                    out.push(',');
                }
                out.push('\n');
            }
            out.push_str(&" ".repeat(indent));
            out.push(']');
        }
        Value::Object(_) => out.push_str("{}"),
        Value::Array(_) => out.push_str("[]"),
        other => out.push_str(&single_line(other, flavour)),
    }
}

/// How far into the current line the output already is.
fn current_column(out: &str) -> usize {
    match out.rfind('\n') {
        Some(at) => out.len() - at - 1,
        None => out.len(),
    }
}

/// The value rendered on a single line, used for the array fit test and for scalars.
fn single_line(value: &Value, flavour: Flavour) -> String {
    match value {
        Value::Object(map) if map.is_empty() => "{}".into(),
        Value::Array(items) if items.is_empty() => "[]".into(),
        Value::Object(map) => {
            let parts: Vec<String> = map
                .iter()
                .map(|(k, v)| format!("{}: {}", render_key(k, flavour), single_line(v, flavour)))
                .collect();
            format!("{{ {} }}", parts.join(", "))
        }
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(|v| single_line(v, flavour)).collect();
            format!("[{}]", parts.join(", "))
        }
        Value::String(s) => render_string(s, flavour),
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
    }
}

/// Renders a string literal, picking the quote that needs fewer escapes in TypeScript.
fn render_string(value: &str, flavour: Flavour) -> String {
    let json = serde_json::to_string(value).unwrap_or_else(|_| format!("{value:?}"));
    if flavour == Flavour::Json {
        return json;
    }

    let doubles = value.matches('"').count();
    let singles = value.matches('\'').count();
    if doubles <= singles {
        return json;
    }

    // Re-quote with single quotes: unescape \" and escape any ' instead.
    let inner = &json[1..json.len() - 1];
    format!("'{}'", inner.replace("\\\"", "\"").replace('\'', "\\'"))
}

/// Object keys are quoted in JSON, and unquoted in TypeScript when they are valid identifiers.
fn render_key(key: &str, flavour: Flavour) -> String {
    let quoted = serde_json::to_string(key).unwrap_or_else(|_| format!("{key:?}"));
    if flavour == Flavour::Json || !is_identifier(key) {
        return quoted;
    }
    key.to_string()
}

fn is_identifier(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' || first == '$' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn objects_expand_and_short_arrays_collapse() {
        let value = json!({ "required": ["a", "b"], "type": "object" });
        let printed = print(&value, Flavour::Json);
        assert_eq!(printed, "{\n  \"required\": [\"a\", \"b\"],\n  \"type\": \"object\"\n}\n");
    }

    #[test]
    fn long_arrays_expand() {
        let long: Vec<String> = (0..30).map(|i| format!("value-number-{i}")).collect();
        let printed = print(&json!({ "enum": long }), Flavour::Json);
        assert!(printed.contains("[\n"), "a long array should wrap");
    }

    #[test]
    fn typescript_unquotes_identifier_keys_and_adds_trailing_commas() {
        let value = json!({ "type": "object", "$ref": "x", "a-b": 1 });
        let printed = print(&value, Flavour::TypeScript);
        assert!(printed.contains("type: \"object\","), "identifier keys are bare");
        assert!(printed.contains("$ref: \"x\","), "$ is a valid identifier start");
        assert!(printed.contains("\"a-b\": 1,"), "non-identifier keys stay quoted");
    }

    #[test]
    fn empty_containers_stay_inline() {
        assert_eq!(print(&json!({ "a": {}, "b": [] }), Flavour::Json), "{\n  \"a\": {},\n  \"b\": []\n}\n");
    }
}
