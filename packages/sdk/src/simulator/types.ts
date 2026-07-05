import type { GameSettingsUIComponents, HostContext, MessagesReceived, Theme, ThumbnailConfig } from "../types"

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
  /**
   * The `hostContext` array sent in READY_DATA, so host-context-dependent features (embed
   * settings, sandbox mode, mobile layout, …) can be exercised locally. Defaults to a single
   * desktop "app" context. The Host tab can override this at runtime (persisted per-browser,
   * applied on restart).
   */
  hostContext?: HostContext[]
  /**
   * Extra named `hostContext` presets shown in the Host tab alongside the generic built-ins —
   * how a game ships its own scenarios (e.g. crossword's partner-embed toolbar settings).
   */
  hostContextPresets?: HostContextPreset[]
  /**
   * Extra views (tabs) appended after the built-in ones. This is how a plugin ships its own
   * host-side mock — e.g. a Sound view that lists `SENSORY_EVENT`s, or a Collab view that fakes
   * a second player. Each view's `id` becomes its tab id, so keep them unique.
   */
  views?: SimulatorView[]
}

export type TabName = string

/** A named `hostContext` scenario selectable in the Host tab. */
export interface HostContextPreset {
  name: string
  context: HostContext[]
}

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
  /** The player's settings for this game, persisted to localStorage and sent in READY_DATA */
  gameSettings: Record<string, any>
  /** The settings UI description from the game's INITIALIZE_SETTINGS, null until received */
  settingsComponents: GameSettingsUIComponents[] | null
  /** The resolved `hostContext` sent in READY_DATA: Host-tab override > config > default app context */
  hostContext: HostContext[]
  /** True when the Host tab's persisted override (not the vite config) is providing `hostContext` */
  hostContextIsOverridden: boolean
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
