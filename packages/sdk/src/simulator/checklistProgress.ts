import type { SimulatorChecklistItem } from "./types"

// A local port of apps/api.puzzmo.com/src/lib/tutorial/tutorialProgress.ts, keep the two in sync.

export type ChecklistMode = "checkpoint" | "completion"

export interface ItemEvaluation {
  complete: boolean
  /** The floored `incrementExp` result, for showing `value/targetCount` */
  value: number
  error?: string
}

/** Builds the expression scope from deeds the same way the API's `getScopeFromDeedsForGame` does. */
export const scopeFromDeeds = (deeds: unknown): Record<string, any> => {
  const scope: Record<string, any> = {}
  if (!Array.isArray(deeds)) return scope
  for (const deed of deeds as { id: string; name?: string; value?: any }[]) {
    if (deed.value === undefined) continue
    scope[camelize(deed.name ?? deed.id)] = deed.value
  }
  return scope
}

/** Evaluates one item against the deed scope, mirroring `itemIsComplete` in the API. */
export const evaluateItem = (item: SimulatorChecklistItem, scope: Record<string, any>): ItemEvaluation => {
  try {
    if (item.filterExp && !evalExp(item.filterExp, scope)) return { complete: false, value: 0 }
    if (!item.incrementExp) return { complete: false, value: 0 }

    let res = evalExp(item.incrementExp, scope)
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

/** Runs an expression with scope keys as locals; unknown identifiers read as undefined like angular-expressions. */
const evalExp = (exp: string, scope: Record<string, any>): any => {
  const keys = Object.keys(scope).filter(isParamName)
  try {
    return new Function(...keys, `"use strict"; return (${exp})`)(...keys.map((k) => scope[k]))
  } catch (error) {
    if (error instanceof ReferenceError) return undefined
    throw error
  }
}

/** Whether a scope key can be a strict-mode parameter, so a deed named `class` or `eval` can't break every item. */
const isParamName = (key: string) => {
  if (!/^[A-Za-z_$][\w$]*$/.test(key)) return false
  try {
    new Function(key, '"use strict"')
    return true
  } catch {
    return false
  }
}

const camelize = (s: string) => s.replace(/-./g, (x) => x[1].toUpperCase())
