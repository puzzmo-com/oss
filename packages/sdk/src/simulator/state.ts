import type { HostContext, Theme, ThumbnailConfig } from "../types"
import { themes } from "../themes"
import type { PreviewKind, SimulatorConfig, SimulatorState, TabName } from "./types"

const storageKeys = {
  collapsed: "simulator-collapsed",
  tab: "simulator-tab",
  theme: "simulator-theme",
  fixtureCategory: "simulator-fixture-category",
  fixturePuzzle: "simulator-fixture-puzzle",
  renderHost: "simulator-render-host",
  renderContext: "simulator-render-context",
  previewKind: "simulator-preview-kind",
  gameSettings: "simulator-game-settings",
  hostContext: "simulator-host-context",
  keyboardDocked: "simulator-keyboard-docked",
  pmmg: "simulator-pmmg",
} as const

/**
 * The Data tab's puzzle/input overrides. The game only ever receives a puzzle and a board state in
 * READY_DATA, so "Apply" cannot poke a running game — it has to persist the string and reload the
 * page so the value is in place before the next READY_DATA is built.
 */
export type SimulatorOverride = "puzzle" | "input"

const overridePrefix = "simulator-override:"

/**
 * Overrides are scoped to the page that applied them. localStorage is per-origin but a dev server
 * commonly hosts many games from one origin (each at its own /games/<name>/ path), and an input
 * string is only meaningful to the game it came from.
 */
function overrideKey(kind: SimulatorOverride): string {
  const path = (window.location.pathname || "/").replace(/\/index\.html$/, "").replace(/\/+$/, "")
  return `${overridePrefix}${kind}:${path || "/"}`
}

/** The applied override for this page, or null when nothing has been applied. "" is a real value. */
export function getSimulatorOverride(kind: SimulatorOverride): string | null {
  try {
    return localStorage.getItem(overrideKey(kind))
  } catch {
    return null
  }
}

/** False when the write failed — private-mode storage, or a board state over the origin's quota. */
export function persistSimulatorOverride(kind: SimulatorOverride, value: string): boolean {
  try {
    localStorage.setItem(overrideKey(kind), value)
    return true
  } catch {
    return false
  }
}

export function clearSimulatorOverride(kind: SimulatorOverride): void {
  try {
    localStorage.removeItem(overrideKey(kind))
  } catch {
    // Storage is unavailable, so there is nothing persisted to clear
  }
}

export function clearSimulatorOverrides(): void {
  clearSimulatorOverride("puzzle")
  clearSimulatorOverride("input")
}

/** The Host tab's persisted `hostContext` override, or null when the tab hasn't set one. */
function getStoredHostContext(): HostContext[] | null {
  const stored = localStorage.getItem(storageKeys.hostContext)
  if (!stored) return null
  try {
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // Corrupt JSON — fall through to no override
  }
  return null
}

export function persistHostContext(hostContext: HostContext[]): void {
  localStorage.setItem(storageKeys.hostContext, JSON.stringify(hostContext))
}

export function clearHostContext(): void {
  localStorage.removeItem(storageKeys.hostContext)
}

/** The Kbd tab's "show keyboard under game" checkbox. Off until asked for: it takes space from the game. */
function getStoredKeyboardDocked(): boolean {
  return localStorage.getItem(storageKeys.keyboardDocked) === "true"
}

export function persistKeyboardDocked(docked: boolean): void {
  localStorage.setItem(storageKeys.keyboardDocked, String(docked))
}

/**
 * The Pmmg tab's choices: the part showing, whether the board follows the game, the overlay's marks, the backdrop, and
 * the look the board is rendered for
 */
export type PmmgPrefs = {
  subtab: "layout" | "sprites" | "scene"
  follow: boolean
  bounds: boolean
  grid: boolean
  boxes: boolean
  anchors: boolean
  keys: boolean
  backdrop: "checker" | "theme" | "black" | "white"
  fidelity: "high" | "low"
  /** "theme" follows the selected theme's type, as Puzzmo does where the game paints no felt */
  backgroundStyle: "theme" | "dark" | "light"
}

const defaultPmmgPrefs: PmmgPrefs = {
  subtab: "layout",
  follow: true,
  bounds: true,
  grid: false,
  boxes: false,
  anchors: false,
  keys: false,
  backdrop: "checker",
  fidelity: "high",
  backgroundStyle: "theme",
}

export function getStoredPmmgPrefs(): PmmgPrefs {
  const prefs = { ...defaultPmmgPrefs }
  try {
    const stored = JSON.parse(localStorage.getItem(storageKeys.pmmg) ?? "{}")
    if (["layout", "sprites", "scene"].includes(stored.subtab)) prefs.subtab = stored.subtab
    if (["checker", "theme", "black", "white"].includes(stored.backdrop)) prefs.backdrop = stored.backdrop
    if (["high", "low"].includes(stored.fidelity)) prefs.fidelity = stored.fidelity
    if (["theme", "dark", "light"].includes(stored.backgroundStyle)) prefs.backgroundStyle = stored.backgroundStyle
    for (const key of ["follow", "bounds", "grid", "boxes", "anchors", "keys"] as const)
      if (typeof stored[key] === "boolean") prefs[key] = stored[key]
  } catch {
    // Unreadable or corrupt: the defaults
  }
  return prefs
}

export function persistPmmgPrefs(prefs: PmmgPrefs): void {
  localStorage.setItem(storageKeys.pmmg, JSON.stringify(prefs))
}

function getStoredGameSettings(): Record<string, any> {
  const stored = localStorage.getItem(storageKeys.gameSettings)
  if (!stored) return {}
  try {
    const parsed = JSON.parse(stored)
    if (parsed && typeof parsed === "object") return parsed
  } catch {
    // Corrupt JSON — fall through to empty settings
  }
  return {}
}

function getStoredTheme(): Theme {
  const storedThemeName = localStorage.getItem(storageKeys.theme)
  if (storedThemeName) {
    const found = themes.find((t) => t.name === storedThemeName)
    if (found) return found
  }
  return themes[0] // Default to first theme (light)
}

function getStoredTab(validTabIds: string[]): TabName {
  const storedTab = localStorage.getItem(storageKeys.tab)
  if (storedTab && validTabIds.includes(storedTab)) {
    return storedTab
  }
  return validTabIds[0] ?? "ctrl"
}

function getStoredCollapsed(configDefault: boolean): boolean {
  const storedCollapsed = localStorage.getItem(storageKeys.collapsed)
  if (storedCollapsed !== null) {
    return storedCollapsed === "true"
  }
  return configDefault
}

function getStoredRenderHost(): ThumbnailConfig["renderHost"] {
  const stored = localStorage.getItem(storageKeys.renderHost)
  if (stored && ["game", "app", "opengraph"].includes(stored)) {
    return stored as ThumbnailConfig["renderHost"]
  }
  return "game"
}

function getStoredPreviewKind(): PreviewKind {
  const stored = localStorage.getItem(storageKeys.previewKind)
  return stored === "text" ? "text" : "image"
}

function getStoredRenderContext(): ThumbnailConfig["renderContext"] {
  const stored = localStorage.getItem(storageKeys.renderContext)
  if (stored && ["preview", "share", "completed", "timeline"].includes(stored)) {
    return stored as ThumbnailConfig["renderContext"]
  }
  return undefined
}

export function createInitialState(config: SimulatorConfig, fixtureCategories: string[], validTabIds: string[]): SimulatorState {
  const storedFixtureCategory = localStorage.getItem(storageKeys.fixtureCategory)
  const storedFixturePuzzle = localStorage.getItem(storageKeys.fixturePuzzle)
  const storedHostContext = getStoredHostContext()
  // Seeded before anything else runs so the override is already in place when the game sends READY.
  const puzzleOverride = getSimulatorOverride("puzzle")
  const inputOverride = getSimulatorOverride("input")

  return {
    hostContext: storedHostContext ?? config.hostContext ?? [{ type: "app", layout: "desktop", host: null }],
    hostContextIsOverridden: storedHostContext !== null,
    isCollapsed: getStoredCollapsed(config.collapsed ?? true),
    isPaused: false,
    hasStarted: false,
    activeTab: getStoredTab(validTabIds),
    puzzleData: puzzleOverride,
    originalPuzzle: puzzleOverride ?? "",
    currentInputStr: inputOverride ?? "",
    userStorage: null,
    appliedPuzzleOverride: puzzleOverride,
    appliedInputOverride: inputOverride,
    completionData: null,
    selectedTheme: getStoredTheme(),
    selectedCategory:
      storedFixtureCategory && fixtureCategories.includes(storedFixtureCategory) ? storedFixtureCategory : (fixtureCategories[0] ?? null),
    selectedPuzzle: storedFixturePuzzle ?? null,
    renderHost: getStoredRenderHost(),
    renderContext: getStoredRenderContext(),
    previewKind: getStoredPreviewKind(),
    gameSettings: getStoredGameSettings(),
    keyboardDocked: getStoredKeyboardDocked(),
    settingsComponents: null,
  }
}

export function persistGameSettings(settings: Record<string, any>): void {
  localStorage.setItem(storageKeys.gameSettings, JSON.stringify(settings))
}

export function clearGameSettings(): void {
  localStorage.removeItem(storageKeys.gameSettings)
}

export function persistCollapsed(collapsed: boolean): void {
  localStorage.setItem(storageKeys.collapsed, String(collapsed))
}

export function persistTab(tab: TabName): void {
  localStorage.setItem(storageKeys.tab, tab)
}

export function persistTheme(themeName: string): void {
  localStorage.setItem(storageKeys.theme, themeName)
}

export function persistFixtureCategory(category: string): void {
  localStorage.setItem(storageKeys.fixtureCategory, category)
}

export function persistFixturePuzzle(puzzle: string): void {
  localStorage.setItem(storageKeys.fixturePuzzle, puzzle)
}

export function clearFixturePuzzle(): void {
  localStorage.removeItem(storageKeys.fixturePuzzle)
}

export function persistRenderHost(host: ThumbnailConfig["renderHost"]): void {
  if (host) {
    localStorage.setItem(storageKeys.renderHost, host)
  } else {
    localStorage.removeItem(storageKeys.renderHost)
  }
}

export function persistPreviewKind(kind: PreviewKind): void {
  localStorage.setItem(storageKeys.previewKind, kind)
}

export function persistRenderContext(context: ThumbnailConfig["renderContext"]): void {
  if (context) {
    localStorage.setItem(storageKeys.renderContext, context)
  } else {
    localStorage.removeItem(storageKeys.renderContext)
  }
}
