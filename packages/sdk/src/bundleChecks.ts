import path from "path"
import type { Plugin } from "vite"

/** What a bundle's build holds it to, as each bundle runs somewhere different */
export type BundleLimits = {
  /** Where the bundle loads, finishing "over the limit for a bundle loaded on ..." */
  loadedOn?: string
  /** Warns past this many bytes */
  warnBytes?: number
  /** Fails the build past this many bytes */
  maxBytes?: number
  /** Packages that fail the build when any of their modules is bundled */
  bannedPackages?: string[]
}

/** What `checkBundle` reads from a finished build */
export type BundleFacts = {
  /** The bundle's file as messages name it */
  fileName: string
  /** The bundle's final code */
  code: string
  /** Each bundled module by id: its rendered bytes, and its code before minifying */
  modules: Record<string, { size: number; code: string | null }>
  /** The imports leading from the entry to each module, entry first */
  chains: Map<string, string[]>
  /** Paths in messages are relative to this */
  root: string
}

const KB = 1024

/** The limits for a bundle Puzzmo loads into its own pages, where every byte is on a player's page load */
export const pageBundleLimits = (loadedOn: string): BundleLimits => ({
  loadedOn,
  warnBytes: 200 * KB,
  maxBytes: 500 * KB,
  bannedPackages: ["react", "react-dom", "scheduler", "redux", "react-redux", "@reduxjs/toolkit"],
})

/**
 * Checks a built bundle: errors fail the build (too big, or a banned package), warnings flag likely mistakes (Node
 * globals, which browsers and isolates don't have).
 */
export const checkBundle = (facts: BundleFacts, limits: BundleLimits) => {
  const errors: string[] = []
  const warnings: string[] = []
  const describe = describer(facts)

  const size = Buffer.byteLength(facts.code)
  const overMax = limits.maxBytes !== undefined && size > limits.maxBytes
  const overWarn = limits.warnBytes !== undefined && size > limits.warnBytes
  if (overMax || overWarn) {
    const limit = overMax ? limits.maxBytes! : limits.warnBytes!
    const where = limits.loadedOn ? ` for a bundle loaded on ${limits.loadedOn}` : ""
    const largest = Object.entries(facts.modules)
      .sort(([, a], [, b]) => b.size - a.size)
      .slice(0, 5)
      .map(
        ([moduleID, { size }]) => `  ${formatKB(size).padStart(7)}  ${describe.module(moduleID)}\n           ${describe.chain(moduleID)}`,
      )
    const message = `${facts.fileName} is ${formatKB(size)}, over the ${formatKB(limit)} limit${where}. Its largest modules:\n${largest.join("\n")}`
    ;(overMax ? errors : warnings).push(message)
  }

  const banned = new Set(limits.bannedPackages ?? [])
  const reported = new Set<string>()
  for (const moduleID of Object.keys(facts.modules)) {
    const pkg = packageName(moduleID)
    if (!pkg || !banned.has(pkg) || reported.has(pkg)) continue
    reported.add(pkg)
    errors.push(
      `${pkg} can't be in ${facts.fileName}, as Puzzmo calls it for strings and data. Imported by:\n  ${describe.chain(moduleID)}`,
    )
  }

  const globals = findNodeGlobals(facts.code, facts.modules)
  if (globals.length) {
    const lines = globals.map(({ usage, count, moduleID }) => {
      const times = count > 1 ? ` (x${count})` : ""
      return moduleID ? `  ${usage}${times} in ${describe.module(moduleID)}\n    ${describe.chain(moduleID)}` : `  ${usage}${times}`
    })
    warnings.push(
      `${facts.fileName} uses Node globals, which don't exist where Puzzmo runs it, so each throws if reached:\n${lines.join("\n")}`,
    )
  }

  return { errors, warnings }
}

/**
 * Runs `checkBundle` inside a bundle's own build. Warnings go to the build's logger, and errors fail it, kept on
 * `api.failure` so the caller can report them without the bundler's stack.
 */
export const bundleChecks = (fileName: string, limits: BundleLimits): Plugin & { api: { failure?: string } } => {
  let root = process.cwd()
  const api: { failure?: string } = {}
  return {
    name: "puzzmo-bundle-checks",
    api,
    configResolved(config) {
      root = config.root
    },
    generateBundle(_, bundle) {
      const chunk = Object.values(bundle).find((file) => file.type === "chunk" && file.isEntry)
      if (chunk?.type !== "chunk" || !chunk.facadeModuleId) return

      const modules = Object.fromEntries(
        Object.entries(chunk.modules).map(([moduleID, info]) => [moduleID, { size: info.renderedLength, code: info.code }]),
      )
      const chains = importChains(chunk.facadeModuleId, (moduleID) => this.getModuleInfo(moduleID))
      const { errors, warnings } = checkBundle({ fileName, code: chunk.code, modules, chains, root }, limits)

      for (const warning of warnings) this.warn(warning)
      if (!errors.length) return
      api.failure = errors.join("\n\n")
      this.error(api.failure)
    },
  }
}

/** A Node-only global in use: `process.env.X`, `Buffer.from`, `require(`, never `obj.process.x` or `__require(` */
const nodeGlobalPattern =
  /(?<![\w$.])(?:(?:process|global|Buffer)(?:\.[\w$]+){1,2}|require\s*\(|new\s+Buffer\s*\(|__dirname\b|__filename\b)/g

/**
 * The Node global usages that survive into the final code, by the module they're in. Each module's own code says
 * where they came from, as globals keep their names through minifying, while the final code says which outlived
 * dead-code removal.
 */
const findNodeGlobals = (code: string, modules: BundleFacts["modules"]) => {
  const inBundle = unguardedNodeGlobals(code)
  const found: { usage: string; count: number; moduleID?: string }[] = []
  for (const [moduleID, module] of Object.entries(modules)) {
    if (!module.code) continue
    for (const [usage, count] of unguardedNodeGlobals(module.code)) if (inBundle.has(usage)) found.push({ usage, count, moduleID })
  }
  const attributed = new Set(found.map(({ usage }) => usage))
  for (const [usage, count] of inBundle) if (!attributed.has(usage)) found.push({ usage, count })
  return found
}

/** Counts each Node global usage, skipping any behind a `typeof` check like lodash's `typeof global == "object" && global.Object` */
const unguardedNodeGlobals = (code: string) => {
  const counts = new Map<string, number>()
  for (const match of code.matchAll(nodeGlobalPattern)) {
    const name = match[0].match(/process|global|Buffer|require|__dirname|__filename/)![0]
    const before = code.slice(Math.max(0, match.index! - 200), match.index)
    if (/typeof\s+$/.test(before) || new RegExp(`typeof\\s+${name}\\b`).test(before)) continue
    const usage = match[0].replace(/\s*\($/, "(").replace(/\s+/g, " ")
    counts.set(usage, (counts.get(usage) ?? 0) + 1)
  }
  return counts
}

/** The shortest import path from the entry to every module it reaches */
const importChains = (
  entryID: string,
  getModuleInfo: (moduleID: string) => { importedIds: readonly string[]; dynamicallyImportedIds: readonly string[] } | null,
) => {
  const chains = new Map([[entryID, [entryID]]])
  const queue = [entryID]
  for (let i = 0; i < queue.length; i++) {
    const info = getModuleInfo(queue[i])
    if (!info) continue
    for (const next of [...info.importedIds, ...info.dynamicallyImportedIds]) {
      if (chains.has(next)) continue
      chains.set(next, [...chains.get(queue[i])!, next])
      queue.push(next)
    }
  }
  return chains
}

/** Shortens module ids for messages: packages from node_modules by name, everything else relative to the root */
const describer = ({ root, chains }: BundleFacts) => {
  const module = (moduleID: string) => {
    const clean = moduleID.replace(/^\0/, "").replace(/\?.*$/, "")
    const afterNodeModules = lastOf(clean.split("/node_modules/"))
    if (afterNodeModules !== clean) return afterNodeModules
    return path.isAbsolute(clean) ? path.relative(root, clean) : clean
  }
  return {
    module,
    chain: (moduleID: string) => (chains.get(moduleID) ?? [moduleID]).map(module).join(" > "),
  }
}

/** The npm package a module id comes from, or undefined outside node_modules */
const packageName = (moduleID: string) => {
  const parts = moduleID.split("/node_modules/")
  if (parts.length < 2) return undefined
  const segments = lastOf(parts).split("/")
  return segments[0].startsWith("@") ? `${segments[0]}/${segments[1]}` : segments[0]
}

const formatKB = (bytes: number) => `${Math.round(bytes / KB)}KB`

/** The SDK targets ES2020, before `Array#at` */
const lastOf = (items: string[]) => items[items.length - 1]
