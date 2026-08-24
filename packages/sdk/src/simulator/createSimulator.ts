import type { BootstrapGameData, MessagesReceived } from "../types"
import type { SimulatorConfig, SimulatorContext, SimulatorState, SimulatorView, TabName, FixtureImports } from "./types"
import { simulatorStyles } from "./styles"
import { createInitialState, persistCollapsed, persistTab } from "./state"
import { sendToGame, createMessageListener, createMessageLogger } from "./messaging"
import { parseFixtures } from "./fixtures"
import { simulatorBuildMarker } from "./marker"
import {
  createCtrlView,
  createDataView,
  createMsgsView,
  createDoneView,
  createCheckpointsView,
  createThumbView,
  createThemeView,
  createHostView,
  createAuthView,
  createFeaturesView,
  createKeyboardView,
  createSettingsView,
} from "./views"

// Re-export types for consumers
export type { SimulatorConfig, FixtureImports }

// Singleton instance state
interface SimulatorInstance {
  updateFixtures: (fixtures: FixtureImports) => void
  sendToGame: (type: any, data: any) => void
  loadPuzzle: () => Promise<any>
}
let simulatorInstance: SimulatorInstance | null = null

/** True when the game is embedded in the real Puzzmo app, which sets `?developer=true` on the iframe. */
function isEmbeddedInApp(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).has("developer")
}

/** Inert instance returned when the simulator declines to boot (the app is the host). */
const noopSimulatorInstance: SimulatorInstance = {
  updateFixtures: () => {},
  sendToGame: () => {},
  loadPuzzle: async () => null,
}

/**
 * Simulator - A development UI for testing games with the Puzzmo Proto SDK.
 *
 * This script simulates the Puzzmo host environment by:
 *
 * - Listening for READY messages from the game
 * - Sending READY_DATA with puzzle data
 * - Providing UI controls for START_GAME, PAUSE_GAME, RESUME_GAME, RETRY_PUZZLE
 *
 * Usage with Vite plugin (recommended):
 *
 * ```ts
 * // vite.config.ts
 * import { puzzmoSimulator } from "@puzzmo/sdk/vite"
 * export default defineConfig({
 *   plugins: [puzzmoSimulator({})],
 * })
 * ```
 *
 * The plugin automatically reads the game slug from the nearest puzzmo.json.
 *
 * The plugin handles making sure it is removed on vite builds.
 *
 * Usage with manual imports:
 *
 * ```html
 * <script type="module">
 *   import { createSimulator } from "@puzzmo/sdk/simulator"
 *   const fixtures = import.meta.glob("./fixtures/puzzles/**\/*.{json,toml}", { query: "?raw", import: "default", eager: true })
 *   createSimulator({ fixtures })
 * </script>
 * ```
 *
 * The fixtures folder structure should be: fixtures/puzzles/{category}/{puzzle}.{json,toml,...}
 * Fixtures are loaded as raw strings and passed to the game verbatim (any text format works; the game parses it).
 * This will show dropdowns in the Ctrl tab to select category and puzzle.
 */

export function createSimulator(config: SimulatorConfig = {}): SimulatorInstance {
  // When a game's dev build is loaded inside the real Puzzmo app (puzzmo.com adds `?developer=true`
  // to the iframe URL), the app itself is the host. Booting the simulator here would double-host the
  // game — two READY_DATA replies, two keyboards, a stray collab room — so bail out and let the app
  // drive. The game still mounts itself into #root; only this dev-host overlay is skipped.
  if (isEmbeddedInApp()) {
    console.log("[Simulator] developer=true in URL — running inside the Puzzmo app, skipping simulator boot")
    return noopSimulatorInstance
  }

  console.log("[Simulator] createSimulator called with config:", { slug: config.slug, hasFixtures: !!config.fixtures })

  // If instance already exists, update it with new config
  if (simulatorInstance) {
    if (config.fixtures) {
      console.log("[Simulator] Instance already exists, updating fixtures")
      simulatorInstance.updateFixtures(config.fixtures)
    }
    return simulatorInstance
  }

  const autoStart = config.autoStart ?? true

  // Parse fixtures if provided
  let fixtures = config.fixtures ? parseFixtures(config.fixtures) : null
  let fixtureCategories = fixtures ? Array.from(fixtures.keys()).sort() : []

  // Create views first so we can extract valid tab IDs
  const msgsView = createMsgsView()
  const thumbView = createThumbView()
  const views = [
    createCtrlView(),
    createDataView(),
    msgsView,
    createDoneView(),
    createCheckpointsView(),
    thumbView,
    createThemeView(),
    createHostView(config.hostContextPresets),
    createAuthView(),
    createFeaturesView(),
    createKeyboardView(),
    createSettingsView(),
    // Plugin-provided views are appended after the built-ins; they get a tab, content, message
    // delegation, and binding for free via the same machinery as the core views.
    ...(config.views ?? []),
  ] satisfies SimulatorView[]

  const validTabIds = views.map((v) => v.id)

  // Initialize state
  const state: SimulatorState = createInitialState(config, fixtureCategories, validTabIds)

  // SVG Icons for the header
  const icons = {
    pause: `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="3" height="8"/><rect x="6" y="1" width="3" height="8"/></svg>`,
    play: `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,1 9,5 2,9"/></svg>`,
    retry: `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 1C2.8 1 1 2.8 1 5s1.8 4 4 4c1.8 0 3.3-1.2 3.8-2.8H7.5c-.4.9-1.3 1.5-2.5 1.5-1.5 0-2.7-1.2-2.7-2.7S3.5 2.3 5 2.3c.7 0 1.4.3 1.9.8L5.5 4.5H9V1L7.6 2.4C6.9 1.5 5.9 1 5 1z"/></svg>`,
    cog: `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M9.5 5.8l-.8-.5c0-.2.1-.5.1-.8s0-.5-.1-.8l.8-.5c.1-.1.2-.2.1-.4l-.8-1.4c-.1-.1-.2-.2-.4-.1l-1 .3c-.3-.3-.7-.5-1.1-.6L6.1.2C6.1.1 6 0 5.8 0H4.2c-.2 0-.3.1-.3.2l-.2 1c-.4.1-.7.3-1.1.6l-1-.3c-.2 0-.3 0-.4.1l-.8 1.4c-.1.2 0 .3.1.4l.8.5c0 .2-.1.5-.1.8s0 .5.1.8l-.8.5c-.1.1-.2.2-.1.4l.8 1.4c.1.1.2.2.4.1l1-.3c.3.3.7.5 1.1.6l.2 1c0 .1.1.2.3.2h1.6c.2 0 .3-.1.3-.2l.2-1c.4-.1.7-.3 1.1-.6l1 .3c.2 0 .3 0 .4-.1l.8-1.4c.1-.2 0-.3-.1-.4zM5 6.5c-.8 0-1.5-.7-1.5-1.5S4.2 3.5 5 3.5 6.5 4.2 6.5 5 5.8 6.5 5 6.5z"/></svg>`,
    minimize: `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="4" width="8" height="2"/></svg>`,
    expand: `<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="1,1 7,4 1,7"/></svg>`,
  }

  // Create the Simulator UI container
  const container = document.createElement("div")
  container.id = "simulator"
  // Static sentinel for `puzzmo games validate`, which greps dist for a simulator that got shipped.
  container.dataset.puzzmoBuild = simulatorBuildMarker
  container.innerHTML = `
    <style>${simulatorStyles}</style>
    <div id="simulator-panel" class="${state.isCollapsed ? "collapsed" : ""}">
      <div id="simulator-header">
        <span id="simulator-title">PUZZMO SIMULATOR</span>
        <span class="header-sep">|</span>
        <div id="simulator-timer">--:--</div>
        <span class="header-sep">|</span>
        <div id="simulator-header-controls">
          <button id="simulator-header-pause" class="header-icon-btn" title="Pause" disabled>${icons.pause}</button>
          <button id="simulator-header-retry" class="header-icon-btn" title="Retry" disabled>${icons.retry}</button>
        </div>
        <span class="header-sep">|</span>
        <div id="simulator-header-status">
          <span id="simulator-header-indicator" class="waiting"></span>
          <span id="simulator-header-status-text">Waiting...</span>
        </div>
        <span class="header-spacer"></span>
        <button id="simulator-header-settings" class="header-icon-btn" title="Settings">${icons.cog}</button>
        <button id="simulator-toggle" class="header-icon-btn" title="Minimize">${icons.minimize}</button>
      </div>
      <div id="simulator-body">
        <div id="simulator-tabs">
          ${views
            .filter((v) => v.id !== "auth")
            .map(
              (v) =>
                `<button class="simulator-tab" data-tab="${v.id}">${v.label}<span class="simulator-tab-badge" data-badge="${v.id}"></span></button>`,
            )
            .join("")}
        </div>
        <div id="simulator-content" class="hidden">
          ${views.map((v) => `<div id="simulator-tab-${v.id}" class="simulator-tab-content">${v.render()}</div>`).join("")}
        </div>
      </div>
    </div>
  `

  // Add to DOM
  document.body.appendChild(container)

  // Get UI elements
  const panel = container.querySelector("#simulator-panel") as HTMLElement
  const header = container.querySelector("#simulator-header") as HTMLElement
  const headerIndicator = container.querySelector("#simulator-header-indicator") as HTMLElement
  const headerStatusText = container.querySelector("#simulator-header-status-text") as HTMLElement
  const headerPauseBtn = container.querySelector("#simulator-header-pause") as HTMLButtonElement
  const headerRetryBtn = container.querySelector("#simulator-header-retry") as HTMLButtonElement
  const headerSettingsBtn = container.querySelector("#simulator-header-settings") as HTMLButtonElement
  const toggleBtn = container.querySelector("#simulator-toggle") as HTMLButtonElement
  const timerEl = container.querySelector("#simulator-timer") as HTMLElement
  const tabsContainer = container.querySelector("#simulator-tabs") as HTMLElement
  const contentEl = container.querySelector("#simulator-content") as HTMLElement

  // Helper to get elements within container
  const getElement = <T extends HTMLElement>(selector: string): T | null => {
    return container.querySelector(selector) as T | null
  }

  // Update pause button icon
  const updatePauseIcon = (isPaused: boolean) => {
    headerPauseBtn.innerHTML = isPaused ? icons.play : icons.pause
    headerPauseBtn.title = isPaused ? "Resume" : "Pause"
  }

  // Update status display (both in ctrl tab and header)
  const updateStatus = (text: string, className: string) => {
    const statusText = getElement<HTMLElement>("#simulator-status .text")
    const statusIndicator = getElement<HTMLElement>("#simulator-status .indicator")
    const indicatorContent = className === "complete" ? "✓" : ""
    if (statusText) statusText.textContent = text
    if (statusIndicator) {
      statusIndicator.className = `indicator ${className}`
      statusIndicator.textContent = indicatorContent
    }
    headerIndicator.className = className
    headerIndicator.textContent = indicatorContent
    headerStatusText.textContent = text
  }

  // Update timer display
  const updateTimer = (display: string, penalty?: string) => {
    if (penalty && penalty !== "0") {
      timerEl.innerHTML = `${display}<span class="penalty">+${penalty}</span>`
    } else {
      timerEl.textContent = display
    }
  }

  // Tab switching logic
  const switchTab = (tabName: TabName) => {
    state.activeTab = tabName
    contentEl.classList.remove("hidden")
    persistTab(tabName)

    // Update tab buttons
    tabsContainer.querySelectorAll(".simulator-tab").forEach((t) => {
      t.classList.toggle("active", t.getAttribute("data-tab") === tabName)
    })

    // Update tab content
    container.querySelectorAll(".simulator-tab-content").forEach((c) => {
      c.classList.toggle("active", c.id === `simulator-tab-${tabName}`)
    })

    // Update header button to show active when auth tab is selected
    headerSettingsBtn.classList.toggle("active", tabName === "auth")

    // Call onActivate for the view
    const view = views.find((v) => v.id === tabName)
    view?.onActivate?.(context)
  }

  // Expand/collapse helper
  const setCollapsed = (collapsed: boolean) => {
    state.isCollapsed = collapsed
    panel.classList.toggle("collapsed", collapsed)
    persistCollapsed(collapsed)

    if (collapsed) {
      contentEl.classList.add("hidden")
      tabsContainer.querySelectorAll(".simulator-tab").forEach((t) => t.classList.remove("active"))
    } else {
      switchTab(state.activeTab)
    }
  }

  // Update thumbnail (delegated to thumbView)
  const updateThumbnail = () => {
    thumbView.updatePreview(context)
  }

  // Load puzzle data from fixtures
  const loadPuzzle = async (): Promise<any> => {
    // Checked explicitly rather than via state.puzzleData so an empty applied puzzle still counts
    // as an override instead of silently falling back to the fixture.
    if (state.appliedPuzzleOverride !== null) return state.appliedPuzzleOverride
    if (state.puzzleData) return state.puzzleData

    if (!fixtures || fixtures.size === 0) {
      throw new Error(
        "No fixtures configured. Add puzzle fixture files (.json or .toml) to a fixtures directory and pass fixturesGlob to the simulator.",
      )
    }

    // Pick the selected fixture, or the first one available
    const category = state.selectedCategory ?? fixtureCategories[0]
    const categoryMap = category ? fixtures.get(category) : undefined
    if (!categoryMap || categoryMap.size === 0) {
      throw new Error(`No puzzles found in fixture category "${category}"`)
    }

    const puzzleName = state.selectedPuzzle ?? categoryMap.keys().next().value
    const puzzleData = puzzleName ? categoryMap.get(puzzleName) : undefined
    if (!puzzleData) {
      throw new Error(`Puzzle "${puzzleName}" not found in category "${category}"`)
    }

    state.puzzleData = puzzleData
    console.log("Simulator: Puzzle loaded from fixtures", { category, puzzle: puzzleName })
    state.originalPuzzle = puzzleData

    const puzzleTextarea = getElement<HTMLTextAreaElement>("#simulator-puzzle")
    if (puzzleTextarea) puzzleTextarea.value = state.originalPuzzle

    if (state.activeTab === "thumb") updateThumbnail()

    return state.puzzleData
  }

  // Wrapped sendToGame with logger
  const messageLogger = createMessageLogger((entry) => {
    msgsView.addLogEntry(entry, context)
  })

  const wrappedSendToGame = (type: keyof MessagesReceived, data: any) => {
    sendToGame(type, data, messageLogger)
  }

  // Update badge count for a tab
  const updateBadge = (tabId: string, count: number | undefined) => {
    const badge = container.querySelector(`[data-badge="${tabId}"]`) as HTMLElement
    if (badge) {
      badge.textContent = count && count > 0 ? String(count) : ""
    }
  }

  // Create context object for views
  const context: SimulatorContext = {
    state,
    getElement,
    sendToGame: wrappedSendToGame,
    logMessage: messageLogger.log,
    loadPuzzle,
    updateStatus,
    updateTimer,
    setCollapsed,
    switchTab,
    updateThumbnail,
    updateBadge,
    fixtures,
    fixtureCategories,
    gameSlug: config.slug ?? null,
  }

  console.log("[Simulator] Context created with gameSlug:", context.gameSlug)

  // Bind all views
  views.forEach((view) => view.bind(context))

  // Tab click handlers
  tabsContainer.querySelectorAll(".simulator-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.getAttribute("data-tab") as TabName
      switchTab(tabName)
      updateBadge(tabName, 0)
    })
  })

  // Toggle button (only visible when expanded) - minimizes the panel
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    setCollapsed(true)
  })

  // Header pause button
  headerPauseBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    if (state.isPaused) {
      wrappedSendToGame("RESUME_GAME", {})
      state.isPaused = false
      updatePauseIcon(false)
      updateStatus("Running", "ready")
    } else {
      wrappedSendToGame("PAUSE_GAME", {})
      state.isPaused = true
      updatePauseIcon(true)
      updateStatus("Paused", "paused")
    }
    // Sync with ctrl tab buttons
    const pauseBtn = getElement<HTMLButtonElement>("#simulator-pause")
    if (pauseBtn) pauseBtn.textContent = state.isPaused ? "Resume" : "Pause"
  })

  // Header retry button
  headerRetryBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    wrappedSendToGame("RETRY_PUZZLE", {})
    state.hasStarted = false
    state.isPaused = false
    updatePauseIcon(false)
    headerPauseBtn.disabled = true
    updateStatus("Ready to retry", "ready")
    // Sync with ctrl tab buttons
    const pauseBtn = getElement<HTMLButtonElement>("#simulator-pause")
    const startBtn = getElement<HTMLButtonElement>("#simulator-start")
    if (pauseBtn) {
      pauseBtn.disabled = true
      pauseBtn.textContent = "Pause"
    }
    if (startBtn) startBtn.textContent = "Start"
  })

  // Header settings button - opens auth tab
  headerSettingsBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    if (state.isCollapsed) {
      setCollapsed(false)
    }
    switchTab("auth")
  })

  // Header click (when collapsed) - expands the panel
  header.addEventListener("click", (e) => {
    if (state.isCollapsed && e.target !== toggleBtn) {
      setCollapsed(false)
    }
  })

  // Restore tab state on init (always select a tab when not collapsed)
  if (!state.isCollapsed) {
    switchTab(state.activeTab)
  }

  // Check for OAuth callback parameters on page load - handle regardless of which tab is active
  const urlParams = new URLSearchParams(window.location.search)
  if (urlParams.has("code") || urlParams.has("error")) {
    // Switch to auth tab to handle the OAuth callback
    setCollapsed(false)
    switchTab("auth")
  }

  // Create READY_DATA payload
  const createReadyData = (puzzle: string): BootstrapGameData => {
    return {
      userState: {
        // Keyed by game slug, matching the shape real hosts send
        gameSettings: { "proto-game": state.gameSettings },
        id: "simulator-user",
        ownerID: "simulator-owner",
      },
      currentUser: {
        id: "simulator-user",
        name: "Simulator",
        username: "simulator",
        usernameID: "0000",
        type: "User",
        roles: "",
      },
      startOrFindGameplay: {
        gamePlayed: {
          additionalTimeAddedSecs: 0,
          boardState: state.currentInputStr,
          combinedTimeSecs: 0,
          completed: false,
          createdAt: new Date().toISOString(),
          elapsedTimeSecs: 0,
          id: `simulator-gameplay-${Date.now()}`,
          ownerID: "simulator-owner",
          pointsAwarded: 0,
          slug: "simulator-game",
          viewerOwnsPuzzle: true,
          puzzle: {
            id: "simulator-puzzle",
            name: "Proto Jig Puzzle",
            puzzle,
            game: {
              displayName: "Proto Game",
              jsPath: "",
              slug: "proto-game",
            },
            mostRecentDaily: null,
          },
        },
      },
      theme: state.selectedTheme,
      // Resolved in createInitialState: Host-tab override > config.hostContext > default app context.
      hostContext: state.hostContext,
      appRuntimeContract: "1.0",
    }
  }

  // Handle READY message from game - send READY_DATA with puzzle
  const handleReady = async () => {
    updateStatus("Loading puzzle...", "waiting")

    try {
      const puzzle = await loadPuzzle()
      const readyData = createReadyData(puzzle)

      updateStatus("Sending READY_DATA...", "waiting")
      wrappedSendToGame("READY_DATA", readyData)

      updateStatus("Waiting for game to load...", "waiting")
    } catch (error) {
      updateStatus(`Error: ${error}`, "paused")
    }
  }

  // Handle READY_GAME_LOADED message from game
  const handleGameLoaded = () => {
    console.log("Simulator: Game loaded, ready to start")

    // Enable header buttons
    headerRetryBtn.disabled = false

    // Notify views
    views.forEach((v) => v.onMessage?.("READY_GAME_LOADED", undefined, context))

    // Auto-start if configured
    if (autoStart && !state.hasStarted) {
      setTimeout(() => {
        const startBtn = getElement<HTMLButtonElement>("#simulator-start")
        startBtn?.click()
        // Enable pause button after start
        headerPauseBtn.disabled = false
        state.hasStarted = true
        updateStatus("Running", "ready")
      }, 100)
    }
  }

  // Set up message listener
  createMessageListener((type, data) => {
    // Handle core messages
    if (type === "READY") {
      console.log("Simulator: Received READY from game")
      handleReady()
      return
    }

    if (type === "READY_GAME_LOADED") {
      handleGameLoaded()
      return
    }

    if (type === "TIMER_TICK") {
      if (data?.display) {
        const [display, penalty] = data.display
        updateTimer(display, penalty)
      }
      return
    }

    if (type === "TIMER_SYNC") {
      return
    }

    if (type === "SIDEBAR_UPDATE") {
      console.log("Simulator: Sidebar update", data)
      return
    }

    // Delegate to views for other messages
    views.forEach((v) => v.onMessage?.(type, data, context))

    // Handle state updates
    // boardState can be at data.boardState (legacy) or data.input.boardState (current SDK format)
    const boardState = data?.input?.boardState ?? data?.boardState
    if (type === "UPLOAD_NEW_GAME_STATE" && boardState) {
      state.currentInputStr = boardState
      if (state.activeTab === "thumb") {
        updateThumbnail()
      }
      console.log("Simulator: Game state uploaded", data)
    }

    if (type === "GAME_COMPLETED") {
      console.log("Simulator: Game completed!", data)
      headerPauseBtn.disabled = true
      state.hasStarted = false
      updateStatus("Completed!", "complete")
    }
  }, messageLogger)

  console.log("Simulator initialized")

  // Function to update fixtures after initial creation
  // Note: This is called when createSimulator is called again with fixtures
  // after the singleton was already created. We DON'T reload here - just update state.
  const updateFixtures = (newFixtureImports: FixtureImports) => {
    fixtures = parseFixtures(newFixtureImports)
    fixtureCategories = Array.from(fixtures.keys()).sort()
    context.fixtures = fixtures
    context.fixtureCategories = fixtureCategories

    // Update state's selected category if it's not set or invalid
    const storedCategory = localStorage.getItem("simulator-fixture-category")
    if (!state.selectedCategory || !fixtureCategories.includes(state.selectedCategory)) {
      state.selectedCategory =
        storedCategory && fixtureCategories.includes(storedCategory) ? storedCategory : (fixtureCategories[0] ?? null)
    }

    // Re-bind ctrl view to pick up new fixtures
    const ctrlView = views.find((v) => v.id === "ctrl")
    ctrlView?.bind(context)

    console.log("Simulator: Fixtures updated", { categories: fixtureCategories, selectedCategory: state.selectedCategory })
  }

  // Store instance for subsequent calls
  simulatorInstance = {
    updateFixtures,
    sendToGame: wrappedSendToGame,
    loadPuzzle,
  }

  return simulatorInstance
}
