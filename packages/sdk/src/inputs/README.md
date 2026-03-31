# Input String Encoder

A schema-driven library for encoding and decoding game state into compact, human-readable strings.

## Features

- **Compact encoding**: 40-60% size reduction vs JSON
- **Human-readable**: Colon-delimited format for easy debugging
- **Type-safe**: Full TypeScript inference
- **Migration support**: Built-in version migration system
- **Smart optimization**: Automatic sparse encoding for arrays, JSON compression with lz-string

## Quick Start

```typescript
import { defineSchema, createEncoder } from '@puzzmo/sdk/inputs'

// Define your data type
type GameData = {
  revealed: boolean[]
  score: number
  annotations: Record<string, { level: number; color: number }>
}

// Create a schema
const schema = defineSchema<GameData>({
  version: 1,
  fields: {
    revealed: { type: 'bitArray' },
    score: { type: 'int' },
    annotations: {
      type: 'sparseMap',
      valueEncoder: (ann) => `${ann.level}.${ann.color}`,
      valueDecoder: (str) => {
        const [level, color] = str.split('.').map(Number)
        return { level, color }
      }
    }
  }
})

// Create encoder/decoder with context for length-dependent fields
const { encode, decode } = createEncoder(schema, {
  revealed: { length: 100 }  // Required for bitArray decoding
})

// Use it
const data = { revealed: [...], score: 42, annotations: { ... } }
const inputString = encode(data)  // "v1:a3f5...:42:0,0=2.1;1,1=3.0"
const decoded = decode(inputString)
```

## Field Types

| Type | Use Case | Encoding | Example |
|------|----------|----------|---------|
| `bitArray` | Boolean arrays (revealed tiles, flags) | Hex (4 bits/char) | `[true, false, false, false, false, true]` → `"12"` |
| `intArray` | Number arrays (scores, experience) | Smart sparse/CSV | `[0, 0, 5, 0, 3]` → `"2=5,4=3"` |
| `int` | Single integers | Decimal | `42` → `"42"` |
| `string` | Text values | As-is | `"Alice"` → `"Alice"` |
| `stringArray` | String lists | Comma-separated | `["a", "b", "c"]` → `"a,b,c"` |
| `sparseMap` | Key-value maps with custom encoding | `idx=value,...` or `key=value;...` | `{a: {x: 1}}` → `"0=1.2"` (with keys) or `"a=1.2"` |
| `json` | Complex objects (fallback) | Compressed JSON | Auto lz-string compression |

## Migrations

Add version migrations to your schema:

```typescript
const schema = defineSchema({
  version: 2,
  fields: {
    name: { type: 'string' },
    value: { type: 'int' }
  },
  migrations: {
    0: (old) => ({ ...old, value: 0 }),
    1: (old) => ({ ...old, name: old.name.toUpperCase() })
  }
})

const { migrate } = createEncoder(schema)
const updated = migrate("v0:alice")  // "v2:ALICE:1"
```

## Context for Optimization

Several field types benefit from context information:

```typescript
const { encode, decode } = createEncoder(schema, {
  revealed: { length: 100 },        // Required for bitArray
  scores: { length: 10 },           // Required for sparse intArray
  annotations: { keys: tileIds }    // Optional: optimize sparseMap with numeric indices
})
```

**sparseMap optimization**: Providing ordered keys converts string keys to numeric indices:
- Without keys: `"0,0=2.1;1,1=3.0"` (17 chars, `;` separator)
- With keys: `"0=2.1,11=3.0"` (13 chars, `,` separator)

The keys array must match the key order used when creating the data.

## Documentation

See detailed documentation in [types.ts](./types.ts) for:
- Complete field type specifications
- When to use each type
- Encoding/decoding details
- Migration patterns
- Best practices
