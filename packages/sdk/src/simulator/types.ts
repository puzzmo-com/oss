import type { MessagesReceived, Theme, ThumbnailConfig } from "../types"

/** Raw fixture strings keyed by path from Vite's import.meta.glob (eager, ?raw). Each value is the file's text. */
export type FixtureImports = Record<string, string | { default?: string }>

export interface SimulatorConfig {
  /** Whether to auto-start the game after READY (default: true) */
  autoStart?: boolean
  /** Initial collapsed state (default: true) */
  collapsed?: boolean
  /** Raw fixture strings from Vite's import.meta.glob (loaded with `?raw`); the game parses them itself */
  fixtures?: FixtureImports
  /** Game slug for API features (e.g. "crossword", "ribbit") */
  slug?: string
}

export type TabName = string

export interface SimulatorState {
  isCollapsed: boolean
  isPaused: boolean
  hasStarted: boolean
  activeTab: TabName
  /** The active puzzle as a raw string (file contents), sent to the game verbatim for it to parse */
  puzzleData: string | null
  originalPuzzle: string
  currentInputStr: string
  completionData: any
  selectedTheme: Theme
  selectedCategory: string | null
  selectedPuzzle: string | null
  renderHost: ThumbnailConfig["renderHost"]
  renderContext: ThumbnailConfig["renderContext"]
}

export interface MessageLogEntry {
  type: string
  data: any
  time: string
  direction: "in" | "out"
}

export interface SimulatorContext {
  state: SimulatorState
  getElement: <T extends HTMLElement>(selector: string) => T | null
  sendToGame: (type: keyof MessagesReceived, data: any) => void
  logMessage: (type: string, data: any, direction: "in" | "out") => void
  loadPuzzle: () => Promise<any>
  updateStatus: (text: string, className: string) => void
  updateTimer: (display: string, penalty?: string) => void
  setCollapsed: (collapsed: boolean) => void
  switchTab: (tab: TabName) => void
  updateThumbnail: () => void
  /** Update the badge count for a tab. Pass 0 or undefined to hide the badge. */
  updateBadge: (tabId: TabName, count: number | undefined) => void
  fixtures: Map<string, Map<string, any>> | null
  fixtureCategories: string[]
  /** Game slug for API features */
  gameSlug: string | null
}

export interface SimulatorView {
  /** Tab identifier */
  id: TabName
  /** Display label for tab button */
  label: string
  /** Returns HTML for the tab content */
  render(): string
  /** Bind event listeners after render */
  bind(context: SimulatorContext): void
  /** Called when tab becomes active */
  onActivate?(context: SimulatorContext): void
  /** Handle incoming messages from game */
  onMessage?(type: string, data: any, context: SimulatorContext): void
}
