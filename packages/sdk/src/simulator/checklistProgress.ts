import { compile } from "angular-expressions"

import type { SimulatorChecklistItem } from "./types"

// A port of the production checklist pipeline for the SDK simulator. The source of truth is:
// - apps/puzzmo.com/src/components/gameplay/PlayGameIframe.tsx: `onComplete` / `onCheckpoint` deed sanitizing
// - apps/api.puzzmo.com/src/lib/completion/gameCompletedUtils.ts: `getDeedsFromCompletion`
// - apps/api.puzzmo.com/src/lib/expressions/scopes.ts: `getScopeFromDeedsForGame`
// - apps/api.puzzmo.com/src/lib/tutorial/tutorialProgress.ts: `advanceTutorialIndex` / `itemIsComplete`
// When this disagrees with those files, they win; update this to match.

export type ChecklistMode = "checkpoint" | "completion"

export interface ItemEvaluation {
  complete: boolean
  /** The floored `incrementExp` result, for showing `value/targetCount` */
  value: number
  error?: string
}

export interface SimulatorDeed {
  id: string
  value?: unknown
}

/** Mirrors `maxPersistedDeedsForExternalGames` in the API's gameCompletedUtils.ts. */
export const maxPersistedDeedsForExternalGames = 3

/** Cleans deeds the way puzzmo.com's PlayGameIframe and the API's `getDeedsFromCompletion` do, collecting what was dropped. */
export const sanitizeDeeds = (deeds: unknown, mode: ChecklistMode): { deeds: SimulatorDeed[]; warnings: string[] } => {
  const warnings: string[] = []
  if (deeds !== undefined && !Array.isArray(deeds)) warnings.push("deeds is not an array, the host ignores it")

  const valid: (SimulatorDeed & { persist?: boolean })[] = []
  for (const [index, deed] of (Array.isArray(deeds) ? deeds : []).entries()) {
    if (deed == null || typeof deed.id !== "string") {
      warnings.push(`deed ${index} has no string id, the host drops it`)
      continue
    }
    if (mode === "checkpoint") {
      valid.push({ id: deed.id, value: deed.value })
      continue
    }
    if (deed.value === undefined || deed.value === null) continue
    valid.push({ id: deed.id, value: typeof deed.value === "number" ? Math.floor(deed.value) : deed.value, persist: deed.persist === true })
  }

  if (mode === "checkpoint") return { deeds: valid, warnings }

  // The API splits persisted deeds off and truncates them for non-Puzzmo teams, so the extras leave the scope too
  const persisted = valid.filter((deed) => deed.persist)
  const temporary = valid.filter((deed) => !deed.persist)
  const dropped = persisted.splice(maxPersistedDeedsForExternalGames)
  if (dropped.length) {
    warnings.push(
      `only ${maxPersistedDeedsForExternalGames} persisted deeds are kept, dropped: ${dropped.map((deed) => deed.id).join(", ")}`,
    )
  }

  return { deeds: [...persisted, ...temporary].map(({ id, value }) => ({ id, value })), warnings }
}

/** Builds the expression scope like the API's `getScopeFromDeedsForGame`; the host strips `name`, so only `id` counts. */
export const scopeFromDeeds = (deeds: SimulatorDeed[]): Record<string, any> => {
  const scope: Record<string, any> = {}
  for (const deed of deeds) {
    if (deed.value === undefined) continue
    scope[camelize(deed.id)] = deed.value
  }
  return scope
}

/** Evaluates one item against the deed scope, mirroring `itemIsComplete` in the API. */
export const evaluateItem = (item: SimulatorChecklistItem, scope: Record<string, any>): ItemEvaluation => {
  try {
    if (item.filterExp && !compile(item.filterExp)(scope)) return { complete: false, value: 0 }
    if (!item.incrementExp) return { complete: false, value: 0 }

    let res = compile(item.incrementExp)(scope)
    if (typeof res === "boolean") res = res ? 1 : 0
    if (typeof res === "undefined") res = 0
    if (typeof res !== "number" || isNaN(res)) throw new Error(`incrementExp must return a number, undefined or boolean, got ${res}`)

    const value = Math.floor(res)
    return { complete: value >= (item.targetCount || 1), value }
  } catch (error: any) {
    return { complete: false, value: 0, error: error.message }
  }
}

/** Walks forward while the head item is satisfied; `checkpoint` mode stops at non-`liveUpdate` items. */
export const advanceChecklist = (config: {
  items: SimulatorChecklistItem[]
  index: number
  scope: Record<string, any>
  mode: ChecklistMode
}): { index: number; head?: ItemEvaluation } => {
  const { items, scope, mode } = config
  let index = Math.min(Math.max(config.index, 0), items.length)
  let head: ItemEvaluation | undefined

  // `head` ends as the evaluation of the item we stopped on, so the view can show its count and error
  for (; index < items.length; index++) {
    head = evaluateItem(items[index], scope)
    if (!head.complete || (mode === "checkpoint" && !items[index].liveUpdate)) break
  }

  return { index, head: index < items.length ? head : undefined }
}

const camelize = (s: string) => s.replace(/-./g, (x) => x[1].toUpperCase())
