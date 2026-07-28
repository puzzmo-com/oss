import type { PuzzmoFile } from "./api.js"

/** Non-fatal checks on a schema-valid puzzmo.json. Returns human-readable warning messages. */
export const lintPuzzmoFile = (puzzmoFile: PuzzmoFile): string[] => {
  const warnings: string[] = []
  const integrations = puzzmoFile.integrations ?? {}

  const leaderboards = integrations.leaderboards
  if (Array.isArray(leaderboards)) {
    for (const leaderboard of leaderboards) {
      if (!leaderboard || typeof leaderboard !== "object") continue
      const { displayName, stableID, sortValue } = leaderboard as { displayName?: string; stableID?: string; sortValue?: unknown }
      if (sortValue !== undefined) continue
      const label = displayName ?? stableID ?? "unnamed"
      warnings.push(
        `Leaderboard "${label}" has no sortValue — you probably want one, it controls the ordering when shown alongside other leaderboards and stats.`,
      )
    }
  }

  warnings.push(...lintDeedScopeUsage(integrations))

  return warnings
}

/**
 * `userAggregateStats` expressions see deeds nested under `deeds.` while every other section sees them
 * as bare identifiers. Getting it the wrong way round evaluates to `undefined` and silently stores
 * nothing (or skips the entry entirely, for a filterExp), so flag both directions.
 */
export const lintDeedScopeUsage = (integrations: Record<string, unknown>): string[] => {
  const warnings: string[] = []
  const deedNames = camelizedDeedNamesIn(integrations)

  for (const [index, entry] of expressionEntries(integrations.userAggregateStats)) {
    for (const [field, expression] of entry) {
      for (const identifier of bareIdentifiersIn(expression)) {
        if (!deedNames.has(identifier)) continue
        warnings.push(
          `userAggregateStats[${index}].${field}: "${identifier}" is a deed, so it needs the deeds prefix here — use "deeds.${identifier}". Bare deed names only work in the other sections.`,
        )
      }
    }
  }

  for (const section of flatScopeSections) {
    for (const [index, entry] of expressionEntries(integrations[section])) {
      for (const [field, expression] of entry) {
        for (const identifier of deedsPrefixedIdentifiersIn(expression)) {
          warnings.push(
            `${section}[${index}].${field}: deeds are bare identifiers in this section — use "${identifier}" rather than "deeds.${identifier}".`,
          )
        }
      }
    }
  }

  return warnings
}

// Every section whose expressions are evaluated against the flat deed scope (getScopeFromDeedsForGame).
const flatScopeSections = ["leaderboards", "puzzleAggregateStats", "persistedDeeds", "completionSidebar"]

// `points` and `time` are sent by the platform for every game, so they are deeds even when unreferenced.
const builtInDeedIDs = ["points", "time"]

/** Deed IDs referenced anywhere in the file, camelized to how they appear in an expression scope. */
const camelizedDeedNamesIn = (integrations: Record<string, unknown>): Set<string> => {
  const names = new Set(builtInDeedIDs.map(camelize))
  collectDeedIDs(integrations, names)
  return names
}

const deedIDFields = ["deedID", "persistedDeedID"]

const collectDeedIDs = (node: unknown, into: Set<string>) => {
  if (Array.isArray(node)) {
    for (const item of node) collectDeedIDs(item, into)
    return
  }
  if (!node || typeof node !== "object") return

  for (const [key, value] of Object.entries(node)) {
    if (deedIDFields.includes(key) && typeof value === "string" && value !== "") into.add(camelize(value))
    else collectDeedIDs(value, into)
  }
}

type ExpressionField = ["valueExp" | "filterExp", string]

/** Yields `[index, fields]` for each entry in a section that carries expressions. */
const expressionEntries = (section: unknown): Array<[number, ExpressionField[]]> => {
  if (!Array.isArray(section)) return []

  return section.map((entry, index): [number, ExpressionField[]] => {
    if (!entry || typeof entry !== "object") return [index, []]
    const { valueExp, filterExp } = entry as { valueExp?: unknown; filterExp?: unknown }
    const fields: ExpressionField[] = []
    if (typeof valueExp === "string") fields.push(["valueExp", valueExp])
    if (typeof filterExp === "string") fields.push(["filterExp", filterExp])
    return [index, fields]
  })
}

/** Identifiers used standalone, i.e. not reached through a property access like `deeds.foo`. */
const bareIdentifiersIn = (expression: string): string[] =>
  matchIdentifiers(withoutStringLiterals(expression), /(^|[^.\w$])([A-Za-z_$][\w$]*)/g)

/** Identifiers reached through a `deeds.` property access. */
const deedsPrefixedIdentifiersIn = (expression: string): string[] =>
  matchIdentifiers(withoutStringLiterals(expression), /(^|[^.\w$])deeds\.([A-Za-z_$][\w$]*)/g)

const matchIdentifiers = (expression: string, pattern: RegExp): string[] => {
  const found = new Set<string>()
  for (const match of expression.matchAll(pattern)) found.add(match[2])
  return [...found]
}

// Deed names never contain quotes, so dropping literals wholesale avoids matching inside them.
const withoutStringLiterals = (expression: string) => expression.replace(/'[^']*'|"[^"]*"/g, " ")

const camelize = (s: string) => s.replace(/-./g, (x) => x[1].toUpperCase())
