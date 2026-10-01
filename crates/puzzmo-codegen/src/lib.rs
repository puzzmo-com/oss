//! Native implementation of the API codegen pipeline.
//!
//! `gate` answers whether anything needs regenerating; `steps` holds the regenerate steps that
//! have been ported from apps/api.puzzmo.com/scripts. The binary in main.rs is a thin CLI over
//! both, and the integration tests drive this library directly.

pub mod gate;
pub mod gqlschema;
pub mod hash;
pub mod jsfmt;
pub mod manifest;
pub mod prisma;
pub mod steps;
pub mod ts;
