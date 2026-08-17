import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * The slice of filesystem access sdl-codegen needs. This used to be TypeScript's `System`,
 * but TypeScript 7 is the native compiler and no longer ships a JS `sys` implementation, so
 * we declare the four functions we actually call. Host apps can pass their own (e.g. an
 * in-memory one for tests or browsers).
 */
export interface SDLCodeGenSystem {
  directoryExists: (path: string) => boolean
  /** Recursively lists files below `path`, optionally filtered to the given extensions */
  readDirectory: (path: string, extensions?: readonly string[]) => string[]
  readFile: (path: string) => string | undefined
  writeFile: (path: string, data: string) => void
}

/** The default `SDLCodeGenSystem`, backed by node's fs */
export const createNodeSystem = (): SDLCodeGenSystem => ({
  directoryExists: (path) => existsSync(path) && statSync(path).isDirectory(),
  readDirectory: (path, extensions) => readDirectoryRecursively(path, extensions),
  readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
  writeFile: (path, data) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, data, "utf8")
  },
})

/** An `SDLCodeGenSystem` backed by a map of path to contents, for tests and browsers */
export const createInMemorySystem = (files: Map<string, string>): SDLCodeGenSystem => ({
  directoryExists: (path) => [...files.keys()].some((f) => f.startsWith(path.endsWith("/") ? path : path + "/")),
  readDirectory: (path, extensions) => {
    const prefix = path.endsWith("/") ? path : path + "/"
    return [...files.keys()].filter((f) => f.startsWith(prefix) && (!extensions || extensions.some((e) => f.endsWith(e)))).sort()
  },
  readFile: (path) => files.get(path),
  writeFile: (path, data) => void files.set(path, data),
})

/** Sorted so that codegen output does not depend on the order the OS hands back directory entries */
const readDirectoryRecursively = (path: string, extensions?: readonly string[]): string[] => {
  if (!existsSync(path)) return []

  const results: string[] = []
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = join(path, entry.name)
    if (entry.isDirectory()) {
      results.push(...readDirectoryRecursively(entryPath, extensions))
    } else if (!extensions || extensions.some((e) => entry.name.endsWith(e))) {
      results.push(entryPath)
    }
  }
  return results
}
