//! Shared TypeScript parsing helpers on top of oxc.
//!
//! The steps that read TypeScript only ever need syntax: declarations, members, literals and the
//! comments attached to them. Nothing here resolves types, which is why oxc is enough.

use anyhow::{Result, bail};
use oxc_allocator::Allocator;
use oxc_ast::ast::{Declaration, Program, Statement};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};

/// Parses a TypeScript source file, failing on any syntax error.
pub fn parse<'a>(allocator: &'a Allocator, path: &str, source: &'a str) -> Result<Program<'a>> {
    let ret = Parser::new(allocator, source, SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() {
        let first = &ret.diagnostics[0];
        bail!("{path}: {first}");
    }
    Ok(ret.program)
}

/// Every top-level declaration, whether or not it is exported.
pub fn declarations<'a, 'b>(program: &'b Program<'a>) -> impl Iterator<Item = &'b Declaration<'a>> {
    program.body.iter().filter_map(|stmt| match stmt {
        Statement::ExportDeclaration(export) => Some(&export.declaration),
        other => other.as_declaration(),
    })
}

/// The comment text blocks sitting between `after` and `before`, in source order.
///
/// Mirrors what getLeadingCommentRanges gave the TypeScript: the comments directly ahead of a
/// node, bounded by whatever came before it so a previous member's trailing note is not stolen.
pub fn leading_comments<'a>(program: &Program<'_>, source: &'a str, after: u32, before: u32) -> Vec<&'a str> {
    program
        .comments
        .iter()
        .filter(|c| c.span.start >= after && c.span.end <= before)
        .map(|c| &source[c.span.start as usize..c.span.end as usize])
        .collect()
}

/// The end of the previous sibling, for bounding a node's leading comments.
pub fn span_end_before<T: GetSpan>(previous: Option<&T>, fallback: u32) -> u32 {
    previous.map(|p| p.span().end).unwrap_or(fallback)
}

/// The source text a span covers.
pub fn text<'a>(source: &'a str, span: Span) -> &'a str {
    &source[span.start as usize..span.end as usize]
}
