import type { Theme, ThumbnailConfig } from "../types"
import { themes } from "../themes"
import type { SimulatorConfig, SimulatorState, TabName } from "./types"

const storageKeys = {
  collapsed: "simulator-collapsed",
  tab: "simulator-tab",
  theme: "simulator-theme",
  fixtureCategory: "simulator-fixture-category",
  fixturePuzzle: "simulator-fixture-puzzle",
  renderHost: "simulator-render-host",
  renderContext: "simulator-render-context",
} as const

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

export function persistRenderContext(context: ThumbnailConfig["renderContext"]): void {
  if (context) {
    localStorage.setItem(storageKeys.renderContext, context)
  } else {
    localStorage.removeItem(storageKeys.renderContext)
  }
}
