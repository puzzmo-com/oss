import type { Schema } from "./types"
import { encode } from "./encoder"
import { decode } from "./decoder"

export function createMigrator<TData>(schema: Schema<TData>) {
  return function migrate(inputString: string, context?: Record<string, any>): string {
    const versionMatch = inputString.match(/^v(\d+)/)
    if (!versionMatch) {
      throw new Error("Invalid input string: no version found")
    }

    const currentVersion = Number(versionMatch[1])

    if (currentVersion === schema.version) {
      return inputString
    }

    if (!schema.migrations) {
      throw new Error(`No migrations defined for schema. Cannot migrate from v${currentVersion} to v${schema.version}`)
    }

    // Data type changes at each migration step (v0 → v1 → v2, etc.)
    // TypeScript can't track these transformations statically, so we use `any`
    // Migrations are developer-written and tested to maintain type safety through the chain
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = decode(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...schema, version: currentVersion } as Schema<any>,
      inputString,
      context,
    )

    for (let v = currentVersion; v < schema.version; v++) {
      const migration = schema.migrations[v]
      if (migration) {
        data = migration(data)
      }
    }

    return encode(schema, data, context)
  }
}
