# @puzzmo-com/belay

I wanted to be able to migrate some of our codebases to use the Relay compiler on simple GraphQL fetch requests. We can get good types 'for free', LSP tooling, and a verification across schema changes.

Belay is a lightweight GraphQL client that uses the Relay compiler for type generation without bundling relay-runtime, nor increasing your bundle size with the larger compiler artifacts.

## Usage

### Define a query

Set up Relay compiler in your app. We use a config with projects.

```ts
import { graphql } from "@puzzmo-com/belay"

export const myQuery = graphql`
  query MyQuery($id: ID!) {
    user(id: $id) {
      id
      name
    }
  }
`
```

The Relay compiler will generate types in `__generated__/MyQuery.graphql.ts`.

### Execute the query

```ts
import { query } from "@puzzmo-com/belay"

import type { MyQuery } from "./__generated__/MyQuery.graphql"
import { myQuery } from "./myQuery"

const result = await query<MyQuery>(myQuery, {
  variables: { id: "123" },
  url: "https://api.example.com/graphql",
})

if (result.data) {
  console.log(result.data.user.name)
}
```

### Mutations

```ts
import { graphql, mutate } from "@puzzmo-com/belay"

import type { UpdateUserMutation } from "./__generated__/UpdateUserMutation.graphql"

const updateUser = graphql`
  mutation UpdateUserMutation($id: ID!, $name: String!) {
    updateUser(id: $id, name: $name) {
      id
      name
    }
  }
`

const result = await mutate<UpdateUserMutation>(updateUser, {
  variables: { id: "123", name: "New Name" },
  url: "https://api.example.com/graphql",
})
```

## API

### `graphql`

A tagged template literal that returns the query string. Used to mark GraphQL operations for the Relay compiler.

```ts
const query = graphql`
  query MyQuery {
    viewer {
      id
    }
  }
`
// Returns: "query MyQuery { viewer { id } }"
```

### `query<T>(queryString, options)`

Execute a GraphQL query.

- `queryString` - The GraphQL query string
- `options.variables` - Query variables (typed from `T["variables"]`)
- `options.url` - GraphQL endpoint URL
- `options.headers` - Optional additional headers
- `options.credentials` - Optional fetch credentials mode
- `options.signal` - Optional AbortSignal

Returns `Promise<GraphQLResponse<T["response"]>>` with `{ data?, errors? }`.

### `mutate<T>(mutationString, options)`

Execute a GraphQL mutation. Same API as `query`.

## Types

```ts
type GraphQLResponse<TData> = {
  data?: TData
  errors?: GraphQLError[]
}

type GraphQLError = {
  message: string
  locations?: Array<{ line: number; column: number }>
  path?: Array<string | number>
  extensions?: Record<string, unknown>
}

type OperationType = {
  variables: Record<string, unknown>
  response: unknown
}

type RequestOptions<TVariables> = {
  variables: TVariables
  url: string
  headers?: HeadersInit
  credentials?: RequestCredentials
  signal?: AbortSignal
}
```

## Relay Compiler Setup

Belay works with the standard Relay compiler. You need a `relay.config.json` at your repo root.

<details>
<summary>Some examples of how to set up your config:</summary>

### Single project

```json
{
  "src": "src",
  "language": "typescript",
  "schema": "schema.graphql",
  "output": "src/__generated__",
  "eagerEsModules": true
}
```

### Multi-project (monorepo)

For monorepos, use `sources` to map directories to project names, then define each project:

```json
{
  "root": ".",
  "sources": {
    "apps/my-app": "my-app",
    "apps/other-app": "other-app"
  },
  "projects": {
    "my-app": {
      "language": "typescript",
      "output": "apps/my-app/src/__generated__",
      "schema": "api-schema.graphql",
      "eagerEsModules": true
    },
    "other-app": {
      "language": "typescript",
      "output": "apps/other-app/src/__generated__",
      "schema": "api-schema.graphql",
      "eagerEsModules": true
    }
  }
}
```

### Key options

- `language`: Use `"typescript"` for TypeScript type generation
- `schema`: Path to your GraphQL schema file
- `output`: Where to write generated `*.graphql.ts` files
- `eagerEsModules`: Set to `true` for ES module output (recommended)
- `sources`: Maps source directories to project names (monorepo only)

</details>

### Running the compiler

```bash
# Generate types
yarn relay

# Watch mode
yarn relay --watch
```

The compiler will find all `graphql` tagged template literals and generate corresponding type files in the `__generated__` directory.
