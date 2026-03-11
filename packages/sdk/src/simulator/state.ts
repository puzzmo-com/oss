import type { Theme, ThumbnailConfig } from "../types"
import { themes } from "../themes"
import type { SimulatorConfig, SimulatorState, TabName } from "./types"

const STORAGE_KEYS = {
  collapsed: "simulator-collapsed",
  tab: "simulator-tab",
  theme: "simulator-theme",
  fixtureCategory: "simulator-fixture-category",
  fixturePuzzle: "simulator-fixture-puzzle",
  renderHost: "simulator-render-host",
  renderContext: "simulator-render-context",
} as const

function getStoredTheme(): Theme {
  const storedThemeName = localStorage.getItem(STORAGE_KEYS.theme)
  if (storedThemeName) {
    const found = themes.find((t) => t.name === storedThemeName)
    if (found) return found
  }
  return themes[0] // Default to first theme (light)
}

function getStoredTab(validTabIds: string[]): TabName {
  const storedTab = localStorage.getItem(STORAGE_KEYS.tab)
  if (storedTab && validTabIds.includes(storedTab)) {
    return storedTab
  }
  return validTabIds[0] ?? "ctrl"
}

function getStoredCollapsed(configDefault: boolean): boolean {
  const storedCollapsed = localStorage.getItem(STORAGE_KEYS.collapsed)
  if (storedCollapsed !== null) {
    return storedCollapsed === "true"
  }
  return configDefault
}

function getStoredRenderHost(): ThumbnailConfig["renderHost"] {
  const stored = localStorage.getItem(STORAGE_KEYS.renderHost)
  if (stored && ["game", "app", "opengraph"].includes(stored)) {
    return stored as ThumbnailConfig["renderHost"]
  }
  return "game"
}

function getStoredRenderContext(): ThumbnailConfig["renderContext"] {
  const stored = localStorage.getItem(STORAGE_KEYS.renderContext)
  if (stored && ["preview", "share", "completed", "timeline"].includes(stored)) {
    return stored as ThumbnailConfig["renderContext"]
  }
  return undefined
}

export function createInitialState(config: SimulatorConfig, fixtureCategories: string[], validTabIds: string[]): SimulatorState {
  const storedFixtureCategory = localStorage.getItem(STORAGE_KEYS.fixtureCategory)
  const storedFixturePuzzle = localStorage.getItem(STORAGE_KEYS.fixturePuzzle)

  return {
    isCollapsed: getStoredCollapsed(config.collapsed ?? true),
    isPaused: false,
    hasStarted: false,
    activeTab: getStoredTab(validTabIds),
    puzzleData: null,
    originalPuzzle: "",
    currentInputStr: "",
    completionData: null,
    selectedTheme: getStoredTheme(),
    selectedCategory:
      storedFixtureCategory && fixtureCategories.includes(storedFixtureCategory) ? storedFixtureCategory : (fixtureCategories[0] ?? null),
    selectedPuzzle: storedFixturePuzzle ?? null,
    renderHost: getStoredRenderHost(),
    renderContext: getStoredRenderContext(),
  }
}

export function persistCollapsed(collapsed: boolean): void {
  localStorage.setItem(STORAGE_KEYS.collapsed, String(collapsed))
}

export function persistTab(tab: TabName): void {
  localStorage.setItem(STORAGE_KEYS.tab, tab)
}

export function persistTheme(themeName: string): void {
  localStorage.setItem(STORAGE_KEYS.theme, themeName)
}

export function persistFixtureCategory(category: string): void {
  localStorage.setItem(STORAGE_KEYS.fixtureCategory, category)
}

export function persistFixturePuzzle(puzzle: string): void {
  localStorage.setItem(STORAGE_KEYS.fixturePuzzle, puzzle)
}

export function clearFixturePuzzle(): void {
  localStorage.removeItem(STORAGE_KEYS.fixturePuzzle)
}

export function persistRenderHost(host: ThumbnailConfig["renderHost"]): void {
  if (host) {
    localStorage.setItem(STORAGE_KEYS.renderHost, host)
  } else {
    localStorage.removeItem(STORAGE_KEYS.renderHost)
  }
}

export function persistRenderContext(context: ThumbnailConfig["renderContext"]): void {
  if (context) {
    localStorage.setItem(STORAGE_KEYS.renderContext, context)
  } else {
    localStorage.removeItem(STORAGE_KEYS.renderContext)
  }
}
