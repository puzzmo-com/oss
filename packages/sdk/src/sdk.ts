import type {
  MessagesSentFromEmbed,
  MessagesReceived,
  GamePlay,
  AugmentationConfig,
  CheckpointConfig,
  Theme,
  Deed,
  KeyboardConfig,
} from "./types"

export type SDK = ReturnType<typeof createPuzzmoSDK>

export interface PuzzmoSDKOptions {
  /** Optional timeout in ms to wait for READY_DATA (default: 5000) */
  timeout?: number
}

type SupportedOutgoingMessages = Pick<
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
>

type SupportedIncomingMessages = Pick<
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
): SDKTimer & {
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
export const createPuzzmoSDK = (options: PuzzmoSDKOptions = {}) => {
  let readyData: MessagesReceived["READY_DATA"] | null = null
  let readyDataResolve: ((data: MessagesReceived["READY_DATA"]) => void) | null = null

  const getGameplay = () => readyData?.startOrFindGameplay?.gamePlayed
  const getGameplayID = () => getGameplay()?.id ?? null
  const getPuzzleString = () => getGameplay()?.puzzle.puzzle ?? null
  const getBoardState = () => getGameplay()?.boardState ?? null
  const getTheme = () => readyData?.theme ?? null
  const getCompleted = () => getGameplay()?.completed ?? false

  const eventListeners = new Map<SDKEventType, Set<(data?: any) => void>>()

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

  hostAPI.onMessage("PAUSE_GAME", () => {
    internalTimer._pause()
    emit("pause")
  })

  hostAPI.onMessage("RESUME_GAME", () => {
    internalTimer._resume()
    emit("resume")
  })

  hostAPI.onMessage("SETTINGS_UPDATE", (data) => emit("settingsUpdate", data))

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

    const gamePlayed = bootstrapData.startOrFindGameplay?.gamePlayed
    if (gamePlayed) {
      const existingTime = (gamePlayed.elapsedTimeSecs ?? 0) * 1000
      const existingAddedTime = (gamePlayed.additionalTimeAddedSecs ?? 0) * 1000
      internalTimer._reset(existingTime, existingAddedTime)
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
  }

  return {
    timer,

    gameReady: async (): Promise<{
      puzzleString: string
      boardState: string | null
      theme: Theme | null
      completed: boolean
      readyData: MessagesReceived["READY_DATA"] | null
    }> => {
      hostAPI.sendMessage("READY", {})

      if (getPuzzleString()) {
        return {
          puzzleString: getPuzzleString()!,
          boardState: getBoardState(),
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

      return {
        puzzleString,
        boardState: getBoardState(),
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
    },

    gameCompleted: (play: Partial<GamePlay>, config?: AugmentationConfig) => {
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
      }
    },

    showCompletionScreen: (results: any[], gameplay: GamePlay, showRetry = true) => {
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

    keyboard: {
      /** Show the on-screen keyboard with the given config. Call again to update state (e.g. to change disabled keys). */
      show: (config: KeyboardConfig) => {
        hostAPI.sendMessage("KEYBOARD_UPDATE_CONFIG", config)
      },
      /** Hide the on-screen keyboard. */
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
