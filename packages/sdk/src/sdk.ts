import { createGameAnalytics, setupLinkTracking, type GameAnalyticsTracker } from "./analytics"
import type { PluginAPIs, SDKPlugin, SDKPluginContext } from "./plugins"
import type {
  MessagesSentFromEmbed,
  MessagesReceived,
  GamePlay,
  AugmentationConfig,
  CheckpointConfig,
  Theme,
  Deed,
  GameOverMessageUIComponent,
  KeyboardConfig,
  GameSettingsUIComponents,
} from "./types"

export type SDK = PuzzmoSDK

export interface PuzzmoSDKOptions<Plugins extends readonly SDKPlugin[] = []> {
  /** Optional timeout in ms to wait for READY_DATA (default: 5000) */
  timeout?: number
  /** Plugins to extend the SDK with; each contributes a namespaced API at `sdk.plugins[name]`. */
  plugins?: Plugins
}

/** The bootstrap info a game needs to set up its board, returned by `sdk.gameReady()`. */
export type GameReadyResult = {
  /** The serialized puzzle for this gameplay, in the game's own format. */
  puzzleString: string
  /** The player's saved in-progress board state from a previous session, or null when starting fresh. */
  inputString: string | null
  /** The host's current display theme, so the game can match the surrounding page. */
  theme: Theme | null
  /** True when the player has already finished this puzzle (e.g. re-opening a completed daily). */
  completed: boolean
  /** The raw bootstrap payload from the host: user state, the gameplay record, host context, etc. */
  readyData: MessagesReceived["READY_DATA"] | null
}

/** Player-facing game settings, rendered by the host's settings panel and persisted per-user, per-game. */
export interface SDKSettings {
  /**
   * Register the game's settings UI with the host. Component `defaultValue`s are merged
   * underneath the player's saved values, the host shows the components in its settings panel,
   * and the resolved settings object is returned. Listen for the `settingsUpdate` event to
   * react to the player changing values. Call after `gameReady()`.
   */
  initialize: (components: GameSettingsUIComponents[]) => any
  /** Get the current resolved settings object. */
  get: () => any
  /** Merge changes into the current settings and persist them to the host. Returns the updated settings. */
  update: (changes: any) => any
}

/** The host-rendered on-screen keyboard, for games that take text or symbol input on touch devices. */
export interface SDKKeyboard {
  /** Show the on-screen keyboard with the given config. Call again to update state (e.g. to change disabled keys). */
  show: (config: KeyboardConfig) => void
  /** Hide the on-screen keyboard. */
  hide: () => void
}

/**
 * The SDK instance returned by `createPuzzmoSDK` — a game's API surface for talking to whichever
 * host is embedding it (puzzmo.com, a partner embed, or the native apps): bootstrapping the
 * puzzle, syncing progress, reporting completion, and driving host UI like settings and the
 * on-screen keyboard.
 *
 * The expected lifecycle is: `gameReady()` → build your board from the result → `gameLoaded()` →
 * play, persisting via `updateGameState()` → `gameCompleted()` → `showCompletionScreen()`.
 */
export interface PuzzmoSDK<Plugins extends readonly SDKPlugin[] = []> {
  /**
   * The play clock. The SDK manages it for you: it starts when the host starts the game, pauses
   * and resumes with the host UI, and its display is mirrored into the host chrome twice a
   * second. Most games only need `addPenalty()` for hint or mistake costs.
   */
  timer: SDKTimer

  /** APIs contributed by the plugins passed to `createPuzzmoSDK`, keyed by plugin name. */
  plugins: PluginAPIs<Plugins>

  /**
   * Announce that the game is ready to receive data. Sends `READY` to the host and resolves with
   * the bootstrap info once the host replies: the puzzle to load, any saved in-progress state,
   * and the host theme. Call this first — every other API assumes it has resolved. Rejects when
   * the host doesn't reply within `PuzzmoSDKOptions.timeout` (default 5s).
   */
  gameReady: () => Promise<GameReadyResult>

  /**
   * Tell the host the game has parsed the puzzle, rendered, and is ready to be revealed. The
   * host dismisses its loading UI and replies with a start signal — listen via `on("start")` to
   * begin play; the timer starts then too.
   */
  gameLoaded: (state?: any) => void

  /**
   * Subscribe to a host lifecycle event: `start`, `pause`, `resume`, `retry`, `settingsUpdate`,
   * or the on-screen `keyboard*` events. Returns an unsubscribe function.
   */
  on: <T extends SDKEventType>(event: T, listener: (data?: SDKEventMap[T]) => void) => () => void

  /** Remove an event listener previously registered with `on`. */
  off: <T extends SDKEventType>(event: T, listener: (data?: SDKEventMap[T]) => void) => void

  /**
   * Save the player's in-progress board state to the server so play can resume later, on any
   * device. `inputString` is the game's own serialized format — it comes back as `inputString`
   * from `gameReady()`. Call whenever the player makes a meaningful move; elapsed time is filled
   * in from the SDK timer unless provided in `play`.
   */
  updateGameState: (inputString: string, play?: Partial<GamePlay>) => void

  /**
   * Report the game as finished. Concludes the timer, fills in elapsed/penalty time when not
   * provided, and uploads the final play plus its deeds — the host uses these for scoring,
   * leaderboards, stats, and other augmentations. Follow with `showCompletionScreen()`.
   */
  gameCompleted: (
    play: Omit<GamePlay, "elapsedTimeSecs" | "additionalTimeAddedSecs"> &
      Partial<Pick<GamePlay, "elapsedTimeSecs" | "additionalTimeAddedSecs">>,
    config?: AugmentationConfig,
  ) => void

  /**
   * Ask the host to show its post-game completion UI. `results` render in the completion
   * sidebar: markdown congratulations, the player's streak stats, and custom stat rows. Call
   * after `gameCompleted()`, typically once your own victory animation has finished.
   */
  showCompletionScreen: (results: GameOverMessageUIComponent[], gameplay: GamePlay, showRetry?: boolean) => void

  /**
   * Record a named mid-game checkpoint. Uploads the current board state and play time, and can
   * run parts of the completion pipeline early (e.g. posting to leaderboards) via
   * `checkpointConfig.process`. A checkpoint is also the host's opportunity to show an ad when
   * `checkpointConfig.interruptible` is true.
   */
  hitCheckpoint: (checkpointName: string, checkpointConfig: CheckpointConfig, config?: AugmentationConfig) => void

  /** Player-facing game settings, rendered in the host's settings panel and persisted per-user, per-game. */
  settings: SDKSettings

  /** The host-rendered on-screen keyboard, for games that take text or symbol input on touch devices. */
  keyboard: SDKKeyboard

  /**
   * The raw postMessage transport to the host — an escape hatch for protocol messages the SDK
   * doesn't wrap.
   *
   * @internal
   */
  _hostAPI: {
    sendMessage: <T extends keyof SupportedOutgoingMessages>(type: T, json: SupportedOutgoingMessages[T]) => void
    onMessage: <T extends keyof SupportedIncomingMessages>(type: T, handler: (data: SupportedIncomingMessages[T]) => void) => () => void
  }
}

export type SupportedOutgoingMessages = Pick<
  MessagesSentFromEmbed,
  | "READY"
  | "READY_GAME_LOADED"
  | "GAME_COMPLETED"
  | "SHOW_GAME_COMPLETE_SCREEN"
  | "TIMER_TICK"
  | "TIMER_SYNC"
  | "UPLOAD_NEW_GAME_STATE"
  | "HIT_CHECKPOINT"
  | "KEYBOARD_UPDATE_CONFIG"
  | "INITIALIZE_SETTINGS"
  | "UPDATE_SETTINGS_FROM_EMBED"
>

export type SupportedIncomingMessages = Pick<
  MessagesReceived,
  | "READY_DATA"
  | "START_GAME"
  | "PAUSE_GAME"
  | "RESUME_GAME"
  | "SETTINGS_UPDATE"
  | "RETRY_PUZZLE"
  | "KEYBOARD_KEY_PRESS"
  | "KEYBOARD_CURSOR_CHANGE"
  | "KEYBOARD_CURSOR_END"
>

type MessageHandler<T extends keyof SupportedIncomingMessages> = (data: SupportedIncomingMessages[T]) => void

export type SDKEventMap = {
  start: void
  pause: void
  resume: void
  retry: void
  /** The player changed a setting in the host UI. The payload is the full resolved settings object. */
  settingsUpdate: any
  /** A key on the on-screen keyboard was tapped. */
  keyboardKeyPress: { key: string }
  /** The drag cursor moved across the keyboard. Only fires when `supportsDragCursor` is true. */
  keyboardCursorChange: { position: [number, number] }
  /** The drag cursor was released. Only fires when `supportsDragCursor` is true. */
  keyboardCursorEnd: void
}

export type SDKEventType = keyof SDKEventMap

export interface SDKTimer {
  /** Get elapsed time in milliseconds */
  timeMs: () => number
  /** Get elapsed time in seconds */
  timeSecs: () => number
  /** Get added/penalty time in milliseconds */
  addedTimeMs: () => number
  /** Get added/penalty time in seconds */
  addedTimeSecs: () => number
  /** Get elapsed time without penalties in seconds */
  timeWithoutPenaltySecs: () => number
  /** Get formatted display strings [elapsed, added] */
  display: () => [string, string]
  /** Add penalty time in milliseconds */
  addPenalty: (ms: number) => void
  /** Check if timer is paused */
  isPaused: () => boolean
  /** Check if timer has been started */
  isRunning: () => boolean
  /** Pause the timer (same as a host-sent PAUSE_GAME); emits "pause" on an actual transition. */
  pause: () => void
  /** Resume the timer (same as a host-sent RESUME_GAME); emits "resume" on an actual transition. */
  resume: () => void
}

function formatTime(timeMs: number): string {
  const isAnHourOrMore = timeMs >= 60 * 60 * 1000
  return new Date(timeMs)
    .toISOString()
    .slice(isAnHourOrMore ? 11 : 14, -1)
    .split(".")[0]
}

function createTimer(
  initialTimeMs = 0,
  initialAddedTimeMs = 0,
): Omit<SDKTimer, "pause" | "resume"> & {
  _init: () => void
  _pause: () => void
  _resume: () => void
  _reset: (initialTimeMs?: number, initialAddedTimeMs?: number) => void
  _conclude: () => void
} {
  let baseTime = initialTimeMs
  let addedTime = initialAddedTimeMs
  let pausedTime = 0
  let concludeTime: number | undefined

  let startDate: number | undefined = undefined
  let pausedDate: number | undefined = undefined

  const getTime = (): number => {
    if (startDate === undefined) return baseTime + addedTime
    if (concludeTime !== undefined) return concludeTime
    const now = pausedDate ?? performance.now()
    const elapsed = now - startDate - pausedTime
    return baseTime + addedTime + elapsed
  }

  return {
    _init: () => {
      if (startDate === undefined) {
        startDate = performance.now()
        pausedDate = undefined
      }
    },
    _pause: () => {
      if (pausedDate !== undefined || startDate === undefined) return
      pausedDate = performance.now()
    },
    _resume: () => {
      if (pausedDate === undefined) return
      pausedTime += performance.now() - pausedDate
      pausedDate = undefined
    },
    _reset: (newInitialTimeMs = 0, newInitialAddedTimeMs = 0) => {
      baseTime = newInitialTimeMs
      addedTime = newInitialAddedTimeMs
      pausedTime = 0
      concludeTime = undefined
      startDate = undefined
      pausedDate = undefined
    },
    _conclude: () => {
      if (pausedDate !== undefined) {
        concludeTime = getTime()
        return
      }
      if (startDate === undefined) {
        concludeTime = baseTime + addedTime
        return
      }
      concludeTime = getTime()
    },
    timeMs: () => getTime(),
    timeSecs: () => getTime() / 1000,
    addedTimeMs: () => addedTime,
    addedTimeSecs: () => addedTime / 1000,
    timeWithoutPenaltySecs: () => (getTime() - addedTime) / 1000,
    addPenalty: (ms: number) => {
      addedTime += ms
    },
    isPaused: () => pausedDate !== undefined || startDate === undefined,
    isRunning: () => startDate !== undefined && pausedDate === undefined,
    display: () => {
      const elapsed = getTime() - addedTime
      const elapsedStr = formatTime(Math.max(0, elapsed))
      const addedStr = addedTime === 0 ? "" : formatTime(addedTime)
      return [elapsedStr, addedStr]
    },
  }
}

function createHostAPI() {
  const messageHandlers = new Map<string, Set<(data: any) => void>>()

  const sendMessage = <T extends keyof SupportedOutgoingMessages>(type: T, json: SupportedOutgoingMessages[T]) => {
    const message = { type, json, _: "p", __: "mp", private: true }

    if ("parent" in window && window.parent !== window) window.parent.postMessage(message, "*")

    window.postMessage(message, "*")

    if ("webkit" in window && (window as any).webkit?.messageHandlers?.app) (window as any).webkit.messageHandlers.app.postMessage(message)

    if ("puzzmoMessageString" in window) (window as any).puzzmoMessageString(JSON.stringify(message))

    if ("ReactNativeWebView" in window && (window as any).ReactNativeWebView?.postMessage)
      (window as any).ReactNativeWebView.postMessage(JSON.stringify(message))

    if (type !== "TIMER_TICK" && type !== "TIMER_SYNC") console.log("[Puzzmo SDK] sent:", type, json)
  }

  const onMessage = <T extends keyof SupportedIncomingMessages>(type: T, handler: MessageHandler<T>) => {
    if (!messageHandlers.has(type)) messageHandlers.set(type, new Set())
    messageHandlers.get(type)!.add(handler)

    return () => {
      messageHandlers.get(type)?.delete(handler)
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("message", (event) => {
      if (!event?.data?.type) return
      const msgType = event.data.type as string
      const handlers = messageHandlers.get(msgType)
      if (handlers) {
        const msgData = event.data.data ?? event.data.json ?? {}
        if (msgType !== "TIMER_TICK" && msgType !== "TIMER_SYNC") console.log("[Puzzmo SDK] received:", msgType, msgData)
        handlers.forEach((handler) => handler(msgData))
      }
    })
  }

  return { sendMessage, onMessage }
}

const hostAPI = createHostAPI()

/** Creates a Puzzmo SDK instance for communicating with the Puzzmo host */
export const createPuzzmoSDK = <const Plugins extends readonly SDKPlugin[] = []>(
  options: PuzzmoSDKOptions<Plugins> = {},
): PuzzmoSDK<Plugins> => {
  let readyData: MessagesReceived["READY_DATA"] | null = null
  let readyDataResolve: ((data: MessagesReceived["READY_DATA"]) => void) | null = null

  const getGameplay = () => readyData?.startOrFindGameplay?.gamePlayed
  const getGameplayID = () => getGameplay()?.id ?? null
  const getPuzzleString = () => getGameplay()?.puzzle.puzzle ?? null
  const getBoardState = () => getGameplay()?.boardState ?? null
  const getTheme = () => readyData?.theme ?? null
  const getCompleted = () => getGameplay()?.completed ?? false

  const eventListeners = new Map<SDKEventType, Set<(data?: any) => void>>()

  // The resolved settings object — seeded from READY_DATA's saved values, then component
  // defaults are merged underneath when the game calls settings.initialize
  let currentSettings: any | null = null

  // ClickHouse game analytics — sends the same lifecycle events the runtime tracks
  // (page_view, gameplay_active, active_30s, completed, link_click). Disabled on localhost.
  let analytics: GameAnalyticsTracker | null = null
  let analyticsCompletedAtStart = false

  const trackAnalyticsEvent = (type: string, json?: any) => {
    // Don't re-send progression events for a game that was already completed when loaded
    if (analyticsCompletedAtStart) return
    analytics?.trackEvent(type, json)
  }

  const internalTimer = createTimer()
  let timerTickInterval: ReturnType<typeof setInterval> | null = null
  let timerSyncInterval: ReturnType<typeof setInterval> | null = null

  const startTimerIntervals = () => {
    if (timerTickInterval) return

    timerTickInterval = setInterval(() => {
      if (internalTimer.isPaused()) return
      const [elapsed, added] = internalTimer.display()
      hostAPI.sendMessage("TIMER_TICK", { display: [elapsed, added] })
    }, 500)

    timerSyncInterval = setInterval(() => {
      if (internalTimer.isPaused()) return
      hostAPI.sendMessage("TIMER_SYNC", Math.floor(internalTimer.timeWithoutPenaltySecs()))
    }, 10000)
  }

  const stopTimerIntervals = () => {
    if (timerTickInterval) {
      clearInterval(timerTickInterval)
      timerTickInterval = null
    }
    if (timerSyncInterval) {
      clearInterval(timerSyncInterval)
      timerSyncInterval = null
    }
  }

  const emit = <T extends SDKEventType>(event: T, data?: SDKEventMap[T]) => {
    const listeners = eventListeners.get(event)
    if (listeners) listeners.forEach((listener) => listener(data))
  }

  hostAPI.onMessage("START_GAME", () => {
    internalTimer._init()
    startTimerIntervals()
    emit("start")
  })

  // Shared by the host-sent PAUSE_GAME/RESUME_GAME messages and the game-initiated
  // sdk.timer.pause()/resume() below, so both paths stop/start the same timer identically.
  const pauseTimer = () => {
    const wasPaused = internalTimer.isPaused()
    internalTimer._pause()
    if (internalTimer.isPaused() !== wasPaused) emit("pause")
  }
  const resumeTimer = () => {
    const wasPaused = internalTimer.isPaused()
    internalTimer._resume()
    if (internalTimer.isPaused() !== wasPaused) emit("resume")
  }

  hostAPI.onMessage("PAUSE_GAME", pauseTimer)
  hostAPI.onMessage("RESUME_GAME", resumeTimer)

  hostAPI.onMessage("SETTINGS_UPDATE", (data) => {
    currentSettings = { ...currentSettings, ...data }
    emit("settingsUpdate", currentSettings)
  })

  hostAPI.onMessage("KEYBOARD_KEY_PRESS", (data) => emit("keyboardKeyPress", data))
  hostAPI.onMessage("KEYBOARD_CURSOR_CHANGE", (data) => emit("keyboardCursorChange", data))
  hostAPI.onMessage("KEYBOARD_CURSOR_END", () => emit("keyboardCursorEnd"))

  hostAPI.onMessage("RETRY_PUZZLE", () => {
    internalTimer._reset()
    stopTimerIntervals()
    emit("retry")
  })

  hostAPI.onMessage("READY_DATA", (data) => {
    const bootstrapData = data as MessagesReceived["READY_DATA"]
    readyData = bootstrapData

    if (currentSettings === null) currentSettings = bootstrapData.userState?.gameSettings ?? {}

    const gamePlayed = bootstrapData.startOrFindGameplay?.gamePlayed
    if (gamePlayed) {
      const existingTime = (gamePlayed.elapsedTimeSecs ?? 0) * 1000
      const existingAddedTime = (gamePlayed.additionalTimeAddedSecs ?? 0) * 1000
      internalTimer._reset(existingTime, existingAddedTime)
    }

    // Wire up analytics once, from the first bootstrap payload
    if (!analytics) {
      analytics = createGameAnalytics(bootstrapData)
      analyticsCompletedAtStart = gamePlayed?.completed ?? false
      // Link clicks are tracked even for already-completed games, matching the runtime
      if (analytics) setupLinkTracking((info) => analytics!.trackLinkClick(info))
    }

    if (readyDataResolve) {
      readyDataResolve(bootstrapData)
      readyDataResolve = null
    }
  })

  const timer: SDKTimer = {
    timeMs: () => internalTimer.timeMs(),
    timeSecs: () => internalTimer.timeSecs(),
    addedTimeMs: () => internalTimer.addedTimeMs(),
    addedTimeSecs: () => internalTimer.addedTimeSecs(),
    timeWithoutPenaltySecs: () => internalTimer.timeWithoutPenaltySecs(),
    display: () => internalTimer.display(),
    addPenalty: (ms: number) => internalTimer.addPenalty(ms),
    isPaused: () => internalTimer.isPaused(),
    isRunning: () => internalTimer.isRunning(),
    pause: pauseTimer,
    resume: resumeTimer,
  }

  // Wire up plugins. Each gets the host transport (open to the full protocol), the timer, and
  // the bootstrap payload, and contributes a namespaced API onto `sdk.plugins[name]`.
  const pluginContext: SDKPluginContext = {
    send: (type, json) => hostAPI.sendMessage(type as keyof SupportedOutgoingMessages, json as never),
    on: (type, handler) => hostAPI.onMessage(type as keyof SupportedIncomingMessages, handler),
    timer,
    bootstrap: () => readyData,
  }
  const pluginAPIs: Record<string, unknown> = {}
  for (const plugin of options.plugins ?? []) pluginAPIs[plugin.name] = plugin.setup(pluginContext)

  return {
    timer,

    plugins: pluginAPIs as PluginAPIs<Plugins>,

    gameReady: async (): Promise<GameReadyResult> => {
      hostAPI.sendMessage("READY", {})

      if (getPuzzleString()) {
        const inputString = getBoardState()
        return {
          puzzleString: getPuzzleString()!,
          inputString,
          // @ts-expect-error - this is backwards compat
          boardState: inputString,
          theme: getTheme(),
          completed: getCompleted(),
          readyData,
        }
      }

      const timeout = options.timeout ?? 5000
      const readyDataPromise = new Promise<MessagesReceived["READY_DATA"]>((resolve, reject) => {
        readyDataResolve = resolve
        setTimeout(() => {
          if (readyDataResolve) {
            readyDataResolve = null
            reject(new Error(`Timeout waiting for READY_DATA after ${timeout}ms`))
          }
        }, timeout)
      })

      await readyDataPromise

      const puzzleString = getPuzzleString()
      if (!puzzleString) throw new Error("READY_DATA received but no puzzle data found")

      const inputString = getBoardState()
      return {
        puzzleString,
        inputString,
        // @ts-expect-error - this is backwards compat
        boardState: inputString,
        theme: getTheme(),
        completed: getCompleted(),
        readyData,
      }
    },

    gameLoaded: (state: any = {}) => {
      hostAPI.sendMessage("READY_GAME_LOADED", {
        state,
        gameRuntimeContract: "1.0",
        embedRuntimeContract: "1.0",
      })
      trackAnalyticsEvent("READY_GAME_LOADED")
    },

    on: <T extends SDKEventType>(event: T, listener: (data?: SDKEventMap[T]) => void): (() => void) => {
      if (!eventListeners.has(event)) eventListeners.set(event, new Set())
      eventListeners.get(event)!.add(listener)
      return () => {
        eventListeners.get(event)?.delete(listener)
      }
    },

    off: <T extends SDKEventType>(event: T, listener: (data?: SDKEventMap[T]) => void) => {
      eventListeners.get(event)?.delete(listener)
    },

    updateGameState: (inputString: string, play?: Partial<GamePlay>) => {
      const gameplayID = getGameplayID()
      if (!gameplayID) return

      hostAPI.sendMessage("UPLOAD_NEW_GAME_STATE", {
        id: gameplayID,
        input: {
          boardState: inputString,
          elapsedTimeSecs: play?.elapsedTimeSecs ?? internalTimer.timeWithoutPenaltySecs(),
          additionalTimeAddedSecs: play?.additionalTimeAddedSecs ?? internalTimer.addedTimeSecs(),
          collabUserReferences: [],
        },
      })
      trackAnalyticsEvent("UPLOAD_NEW_GAME_STATE")
    },

    gameCompleted: (
      play: Omit<GamePlay, "elapsedTimeSecs" | "additionalTimeAddedSecs"> &
        Partial<Pick<GamePlay, "elapsedTimeSecs" | "additionalTimeAddedSecs">>,
      config?: AugmentationConfig,
    ) => {
      internalTimer._conclude()
      stopTimerIntervals()

      const finalPlay: Partial<GamePlay> = {
        ...play,
        elapsedTimeSecs: play.elapsedTimeSecs ?? internalTimer.timeWithoutPenaltySecs(),
        additionalTimeAddedSecs: play.additionalTimeAddedSecs ?? internalTimer.addedTimeSecs(),
      }

      const deeds: Deed[] = (config?.deeds as any) ?? []
      deeds.push({ id: "points", value: play.pointsAwarded })
      deeds.push({
        id: "time",
        value: Math.round(finalPlay.elapsedTimeSecs ?? 0) + Math.round(finalPlay.additionalTimeAddedSecs ?? 0),
      })

      const gameplayID = getGameplayID()
      if (gameplayID) {
        hostAPI.sendMessage("GAME_COMPLETED", {
          id: gameplayID,
          input: finalPlay,
          config,
        })
        trackAnalyticsEvent("GAME_COMPLETED", { input: finalPlay })
      }
    },

    showCompletionScreen: (results: GameOverMessageUIComponent[], gameplay: GamePlay, showRetry = true) => {
      hostAPI.sendMessage("SHOW_GAME_COMPLETE_SCREEN", {
        results,
        showRetry,
        gameplay,
      })
    },

    hitCheckpoint: (checkpointName: string, checkpointConfig: CheckpointConfig, config?: AugmentationConfig) => {
      const gameplayID = getGameplayID()
      if (!gameplayID) return

      const inputStr = getBoardState() ?? ""
      const play: Partial<GamePlay> = {
        elapsedTimeSecs: internalTimer.timeWithoutPenaltySecs(),
        additionalTimeAddedSecs: internalTimer.addedTimeSecs(),
      }

      hostAPI.sendMessage("HIT_CHECKPOINT", {
        checkpointName,
        gameplay: { inputStr, play },
        checkpointConfig,
        augConfig: config ?? {},
      })
    },

    settings: {
      initialize: (components: GameSettingsUIComponents[]) => {
        currentSettings = { ...settingsDefaultsFromComponents(components), ...currentSettings }
        hostAPI.sendMessage("INITIALIZE_SETTINGS", { components, settings: currentSettings })
        return currentSettings
      },
      get: () => currentSettings ?? {},
      update: (changes: any) => {
        currentSettings = { ...currentSettings, ...changes }
        hostAPI.sendMessage("UPDATE_SETTINGS_FROM_EMBED", { settings: currentSettings })
        return currentSettings
      },
    },

    keyboard: {
      show: (config: KeyboardConfig) => {
        hostAPI.sendMessage("KEYBOARD_UPDATE_CONFIG", config)
      },
      hide: () => {
        hostAPI.sendMessage("KEYBOARD_UPDATE_CONFIG", {
          layout: [],
          symbols: {},
          highlight: [],
          disabled: [],
          xl: [],
          l: [],
          supportsDragCursor: false,
        })
      },
    },

    _hostAPI: hostAPI,
  }
}

/** Walks settings UI components (recursing into split groups) collecting name → defaultValue pairs */
function settingsDefaultsFromComponents(components: GameSettingsUIComponents[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const component of components) {
    if (component.type === "split") Object.assign(defaults, settingsDefaultsFromComponents(component.content))
    else if ("name" in component) defaults[component.name] = component.defaultValue
  }
  return defaults
}
