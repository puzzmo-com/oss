/**
 * Encodes boolean arrays as compact hexadecimal strings.
 *
 * **When to use:**
 * - Revealed/hidden state of game tiles
 * - Feature flags or settings
 * - Any boolean array where order matters
 *
 * **Encoding:**
 * - Packs 4 bits per hex character (75% size reduction)
 * - Example: [true, false, false, false, false, true, false, false] → "12"
 *
 * **Decoding:**
 * - Requires length in context: `{ fieldName: { length: 100 } }`
 */
export type BitArrayFieldType = {
  type: "bitArray"
}

/**
 * Encodes integer arrays with automatic sparse optimization.
 *
 * **When to use:**
 * - Arrays of numeric values (scores, counts, experience)
 * - Sparse data (mostly zeros)
 * - Dense data (will auto-fallback to CSV)
 *
 * **Encoding:**
 * - Uses decimal (base-10) numbers separated by commas
 * - Smart sparse: If >50% zeros, uses `index=value` pairs (e.g., "2=5,4=3")
 * - Dense fallback: If not beneficial, uses CSV (e.g., "1,2,3,4")
 * - Empty arrays encode as empty string
 *
 * **Decoding:**
 * - Requires length in context for sparse format: `{ fieldName: { length: 100 } }`
 * - CSV format decodes without context
 */
export type IntArrayFieldType = {
  type: "intArray"
}

/**
 * Encodes single integer values.
 *
 * **When to use:**
 * - Single numeric values (score, level, count)
 * - Non-negative integers only
 *
 * **Encoding:**
 * - Uses decimal (base-10) representation
 * - Example: 42 → "42"
 */
export type IntFieldType = {
  type: "int"
}

/**
 * Encodes string values as-is.
 *
 * **When to use:**
 * - Single string values (name, color, mode)
 * - Short identifiers
 *
 * **Warning:**
 * - Strings containing the schema delimiter (default ':') will break parsing
 * - Consider using a custom delimiter or different encoding for such strings
 */
export type StringFieldType = {
  type: "string"
}

/**
 * Encodes arrays of strings.
 *
 * **When to use:**
 * - Lists of tags, categories, or identifiers
 * - Ordered collections of strings
 *
 * **Encoding:**
 * - Uses comma delimiter by default
 * - Custom delimiter can be specified to avoid conflicts
 *
 * **Warning:**
 * - Strings containing the delimiter will break parsing
 * - Use custom delimiter to avoid conflicts
 */
export type StringArrayFieldType = {
  type: "stringArray"
  delimiter?: string
}

/**
 * Encodes sparse key-value maps with custom value encoding.
 *
 * **When to use:**
 * - Tile annotations, cell metadata
 * - Any sparse mapping where most keys don't have values
 * - Custom object types that need specialized encoding
 *
 * **Encoding:**
 * - With context keys: Uses numeric indices (e.g., `0=2.1,5=3.0`)
 * - Without context: Uses string keys (e.g., `key1=val1;key2=val2`)
 * - Only stores non-empty entries
 * - Keys are always strings in the data, converted to indices when context provides ordered keys
 * - valueEncoder: Convert your object to a string
 * - valueDecoder: Parse string back to your object
 *
 * **Optimization:**
 * Provide ordered keys in context to use numeric indices instead of string keys:
 * ```typescript
 * const { encode, decode } = createEncoder(schema, {
 *   annotations: { keys: tileIds }  // Ordered list of possible keys
 * })
 * ```
 *
 * **Example:**
 * ```typescript
 * annotations: {
 *   type: 'sparseMap',
 *   valueEncoder: (ann) => `${ann.level}.${ann.color}`,
 *   valueDecoder: (str) => {
 *     const [level, color] = str.split('.').map(Number)
 *     return { level, color }
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic type parameter for value type
export type SparseMapFieldType<TValue = any> = {
  type: "sparseMap"
  valueEncoder: (value: TValue) => string
  valueDecoder: (str: string) => TValue
}

/**
 * Encodes arbitrary data as JSON with automatic compression.
 *
 * **When to use:**
 * - Complex nested structures
 * - Fallback for data that doesn't fit other types
 * - Temporary solution before implementing custom encoding
 *
 * **Encoding:**
 * - Converts data to JSON string
 * - Automatically compresses with lz-string
 * - Helps reduce size of complex objects
 *
 * **Warning:**
 * - Still larger than specialized encodings even with compression
 * - Use only when necessary
 * - Consider creating custom sparseMap encoding instead
 */
export type JsonFieldType = {
  type: "json"
}

/**
 * Union of all available field types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic type parameter for field values
export type FieldType<TValue = any> =
  | BitArrayFieldType
  | IntArrayFieldType
  | IntFieldType
  | StringFieldType
  | StringArrayFieldType
  | SparseMapFieldType<TValue>
  | JsonFieldType

/**
 * Function that migrates data from one version to another.
 *
 * **When to use:**
 * - Add new fields with default values
 * - Transform existing field values
 * - Rename or restructure fields
 *
 * **Important:**
 * - Migrations operate on decoded data objects, not strings
 * - Each migration goes from version N to version N+1
 * - Migrations are applied sequentially
 *
 * **Example:**
 * ```typescript
 * migrations: {
 *   0: (oldData) => ({
 *     ...oldData,
 *     newField: 'default value'
 *   }),
 *   1: (oldData) => ({
 *     ...oldData,
 *     name: oldData.name.toUpperCase()
 *   })
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic type parameters for migration input/output
export type DataMigration<TFrom = any, TTo = any> = (data: TFrom) => TTo

/**
 * Map of version numbers to migration functions.
 *
 * Keys are the source version numbers (0, 1, 2, etc.)
 * Values are functions that migrate from that version to the next
 */
export type MigrationMap = {
  [fromVersion: number]: DataMigration
}

/**
 * Complete schema definition for encoding/decoding data.
 *
 * **Basic usage:**
 * ```typescript
 * const schema = defineSchema({
 *   version: 1,
 *   fields: {
 *     name: { type: 'string' },
 *     age: { type: 'int' }
 *   }
 * })
 * ```
 *
 * **With custom delimiter:**
 * ```typescript
 * const schema = defineSchema({
 *   version: 1,
 *   delimiter: '|',  // Use | instead of :
 *   fields: { ... }
 * })
 * ```
 *
 * **With migrations:**
 * ```typescript
 * const schema = defineSchema({
 *   version: 2,
 *   fields: {
 *     name: { type: 'string' },
 *     value: { type: 'int' }
 *   },
 *   migrations: {
 *     0: (old) => ({ ...old, value: 0 }),
 *     1: (old) => ({ ...old, name: old.name.toUpperCase() })
 *   }
 * })
 * ```
 *
 * @param version - Current schema version (increment when making breaking changes)
 * @param delimiter - Character to separate fields (default: ':')
 * @param fields - Map of field names to field type definitions
 * @param migrations - Optional map of version migrations
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic type parameter for schema data, and field values need 'any' for flexibility
export type Schema<TData = any> = {
  version: number
  delimiter?: string
  fields: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field values can be any type
    [K in keyof TData]: FieldType<any>
  }
  migrations?: MigrationMap
}

/**
 * Result of creating an encoder from a schema.
 *
 * **Usage:**
 * ```typescript
 * const { encode, decode, migrate } = createEncoder(schema, context)
 *
 * // Encode data to string
 * const inputString = encode(data)
 *
 * // Decode string to data
 * const data = decode(inputString)
 *
 * // Migrate old version to current version
 * const currentVersion = migrate(oldInputString)
 * ```
 */
export type EncoderResult<TData> = {
  encode: (data: TData) => string
  decode: (str: string) => TData
  migrate: (str: string) => string
}

/**
 * Define a typed schema for encoding/decoding game state.
 *
 * **Purpose:**
 * - Provides type inference for encode/decode functions
 * - Documents the structure of your input strings
 * - Enables version migrations
 *
 * **Example:**
 * ```typescript
 * type GameData = {
 *   revealed: boolean[]
 *   score: number
 *   annotations: Record<string, Annotation>
 * }
 *
 * export const schema = defineSchema<GameData>({
 *   version: 1,
 *   fields: {
 *     revealed: { type: 'bitArray' },
 *     score: { type: 'int' },
 *     annotations: {
 *       type: 'sparseMap',
 *       valueEncoder: (ann) => `${ann.level}.${ann.color}`,
 *       valueDecoder: (str) => {
 *         const [level, color] = str.split('.').map(Number)
 *         return { level, color }
 *       }
 *     }
 *   }
 * })
 * ```
 */
export function defineSchema<TData>(schema: Schema<TData>): Schema<TData> {
  return schema
}
