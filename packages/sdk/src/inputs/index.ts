import type { Schema, EncoderResult } from "./types"
import { encode } from "./encoder"
import { decode } from "./decoder"
import { createMigrator } from "./migration"

export { defineSchema } from "./types"
export type {
  Schema,
  EncoderResult,
  FieldType,
  BitArrayFieldType,
  IntArrayFieldType,
  IntFieldType,
  StringFieldType,
  StringArrayFieldType,
  SparseMapFieldType,
  JsonFieldType,
  DataMigration,
  MigrationMap,
} from "./types"

/**
 * Create an encoder/decoder for a schema-defined data structure.
 *
 * **Basic usage:**
 * ```typescript
 * import { defineSchema, createEncoder } from '@puzzmo/sdk/inputs'
 *
 * const schema = defineSchema({
 *   version: 1,
 *   fields: {
 *     name: { type: 'string' },
 *     age: { type: 'int' }
 *   }
 * })
 *
 * const { encode, decode } = createEncoder(schema)
 *
 * const data = { name: 'Alice', age: 30 }
 * const inputString = encode(data)  // "v1:Alice:30"
 * const decoded = decode(inputString)  // { name: 'Alice', age: 30 }
 * ```
 *
 * **With context (for length-dependent fields):**
 * ```typescript
 * const schema = defineSchema({
 *   version: 1,
 *   fields: {
 *     revealed: { type: 'bitArray' },
 *     scores: { type: 'intArray' }
 *   }
 * })
 *
 * const { encode, decode } = createEncoder(schema, {
 *   revealed: { length: 100 },     // Required for bitArray decoding
 *   scores: { length: 10 },        // Required for sparse intArray decoding
 *   annotations: { keys: tileIds } // Optional: optimize sparseMap with numeric indices
 * })
 * ```
 *
 * **With migrations:**
 * ```typescript
 * const { encode, decode, migrate } = createEncoder(schema)
 *
 * const oldString = "v0:Alice:30"
 * const migrated = migrate(oldString)  // "v1:Alice:30:default"
 * const data = decode(migrated)
 * ```
 *
 * @param schema - Schema definition created with defineSchema()
 * @param context - Optional context for decoding (lengths for bitArray/intArray)
 * @returns Object with encode, decode, and migrate functions
 */
export function createEncoder<TData>(
  schema: Schema<TData>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Context values can be any shape depending on field types
  context?: Record<string, any>,
): EncoderResult<TData> {
  const migrator = createMigrator(schema)

  return {
    encode: (data: TData) => encode(schema, data, context),
    decode: (str: string) => decode(schema, str, context),
    migrate: (str: string) => migrator(str, context),
  }
}
