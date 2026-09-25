import type { PuzzmoSDK } from "../sdk"
import type { Deed } from "../types"
import { Pico8Channel, type Pico8Memory } from "./channel"
import { resolvePico8Palette, type Pico8Colour } from "./palette"
import { cartBase, CartOp, firstGameOp, gpioSize, maxPayload, pageBase, PageOp } from "./protocol"

export { Pico8Channel, type Pico8Message, type Pico8Memory } from "./channel"
export { nearestPico8Colour, resolvePico8Palette, pico8HardwareColours, type Pico8Colour } from "./palette"
export { CartOp, PageOp, firstGameOp, maxPayload } from "./protocol"
export { puzzmoLua } from "./lua"

/** Sends one of your game's messages to the cart. `op` must be 16 or above, and a payload is at most 60 bytes. */
export type Pico8Send = (op: number, payload?: ArrayLike<number>) => void

/** The parts of the SDK the bridge uses. */
export type Pico8BridgeSDK = Pick<PuzzmoSDK, "gameLoaded" | "on" | "showCompletionScreen" | "updateGameState" | "gameCompleted">

export type Pico8BridgeOptions = {
  /** The SDK, after `gameReady()` has resolved. */
  sdk: Pico8BridgeSDK
  /** `completed` from `gameReady()`. A finished play opens with `pz.completed` set, and won't ask for the completion screen again. */
  completed?: boolean
  /** `puzzleString` from `gameReady()`, which the cart gets as `pz.puzzle`. Keep puzzles to plain ASCII. */
  puzzleString?: string
  /** `inputString` from `gameReady()`: the progress the cart last saved with `pz_save()`, which it gets as `pz.progress`. */
  inputString?: string | null
  /**
   * Colours for the cart's 16 draw colours, as hex strings (matched to the nearest PICO-8 hardware colour), hardware
   * colour ids, or null to keep PICO-8's default for that slot. Leave it out to keep the default palette entirely.
   */
  palette?: readonly Pico8Colour[]
  /**
   * The cart has booted (or rebooted) and wants the board. Send whatever it needs to draw with `send`, the bridge
   * follows it with READY, and the cart's `pz_on_ready()` runs once it has all arrived.
   */
  onBoot?: (send: Pico8Send) => void
  /** One of your game's messages (op 16 and up) arrived from the cart. */
  onMessage?: (op: number, payload: number[], send: Pico8Send) => void
  /** The player restarted. Reset your state here, the cart's `pz_on_retry()` runs afterwards. */
  onRetry?: () => void
  /** The cart called `pz_finished()`. Defaults to `sdk.showCompletionScreen([])`. */
  onFinished?: () => void
  /** Log every message, both ways, to the console. Handy while you're getting started. */
  debug?: boolean
  /** The shared bytes. Defaults to the page's `pico8_gpio` array, creating it if needed. */
  memory?: Pico8Memory
  /** Tick on every animation frame. Turn it off to call `tick()` yourself. Defaults to true. */
  autoTick?: boolean
}

export type Pico8Bridge = {
  /** Sends one of your game's messages to the cart. */
  send: Pico8Send
  /** Moves the conversation along by one frame, if you turned `autoTick` off. */
  tick: () => void
  /** Stops ticking. */
  stop: () => void
  /** Messages which haven't been acknowledged yet. */
  readonly backlog: number
}

/** The page's `pico8_gpio` array, with every slot a number. PICO-8's exported page declares it, older ones may not. */
const gpioMemory = (): Pico8Memory => {
  const g = globalThis as { pico8_gpio?: Pico8Memory }
  const mem = g.pico8_gpio && g.pico8_gpio.length >= gpioSize ? g.pico8_gpio : (g.pico8_gpio = new Array(gpioSize))
  for (let i = 0; i < gpioSize; i++) if (typeof mem[i] !== "number") mem[i] = 0
  return mem
}

/** Strings travel as one character per byte. PICO-8's characters match ASCII from 32 to 126, so keep to those. */
const textToBytes = (text: string) =>
  Array.from(text, (ch) => {
    const code = ch.charCodeAt(0)
    return code < 256 ? code : 63 // "?"
  })
const bytesToText = (bytes: number[]) => String.fromCharCode(...bytes)

/** Splits bytes into message-sized pieces. An empty string is still one (empty) piece. */
const chunks = (bytes: number[]) => {
  const out: number[][] = []
  for (let i = 0; i < bytes.length; i += maxPayload) out.push(bytes.slice(i, i + maxPayload))
  return out
}

/**
 * Runs a PICO-8 cart as a Puzzmo game, with the whole game written in Lua. It waits for the puzzle, hands it to the
 * cart as `pz.puzzle` (and the player's saved progress as `pz.progress`), and turns the cart's `pz_save()`,
 * `pz_deed()` and `pz_complete()` into the SDK calls Puzzmo needs.
 *
 * ```ts
 * import { createPuzzmoSDK } from "@puzzmo/sdk"
 * import { createPico8Game } from "@puzzmo/sdk/pico8"
 *
 * createPico8Game(createPuzzmoSDK())
 * ```
 */
export async function createPico8Game(
  sdk: Pico8BridgeSDK & Pick<PuzzmoSDK, "gameReady">,
  options: Omit<Pico8BridgeOptions, "sdk" | "completed" | "puzzleString" | "inputString"> = {},
): Promise<Pico8Bridge> {
  const { puzzleString, inputString, completed } = await sdk.gameReady()
  return createPico8Bridge({ ...options, sdk, completed, puzzleString, inputString })
}

/**
 * Connects a PICO-8 cart to the Puzzmo SDK over PICO-8's GPIO bytes. Most games want `createPico8Game`, which calls
 * this for you. The cart's half is `puzzmo.lua`, which the
 * `puzzmoPico8()` vite plugin writes next to your cart.
 *
 * The bridge runs the SDK lifecycle for you: it answers the cart's boot with the board (via `onBoot`), calls
 * `gameLoaded()` once the cart has it, and passes start, pause, resume and retry through to the cart. What's left for
 * your code is the game: what the board looks like in bytes, and what the cart's messages mean.
 *
 * ```ts
 * const sdk = createPuzzmoSDK()
 * const { puzzleString, inputString, completed } = await sdk.gameReady()
 *
 * const bridge = createPico8Bridge({
 *   sdk,
 *   completed,
 *   onBoot: (send) => send(SETUP, [remaining]),
 *   onMessage: (op, payload, send) => { ... },
 * })
 * ```
 */
export function createPico8Bridge(options: Pico8BridgeOptions): Pico8Bridge {
  const { sdk, debug = false } = options
  const channel = new Pico8Channel(options.memory ?? gpioMemory(), pageBase, cartBase)
  const palette = options.palette ? resolvePico8Palette(options.palette) : null

  const state = {
    started: false,
    paused: false,
    loaded: false,
    // A play which was already finished must not ask for its completion screen again: the host re-opens a finished
    // play to show that screen, and asking for it from inside it would loop. A retry makes the play live again.
    reopened: Boolean(options.completed),
    completed: Boolean(options.completed),
    // The latest progress the cart saved, so a cart which restarts part way through picks up where it was.
    progress: options.inputString ?? "",
    saving: [] as number[],
    deeds: [] as Deed[],
  }

  const log = (direction: string, op: number, payload: ArrayLike<number>) => {
    if (debug) console.log(`[pico8] ${direction} op ${op}`, Array.from(payload))
  }

  const sendRaw = (op: number, payload: ArrayLike<number> = []) => {
    log("page -> cart", op, payload)
    channel.send(op, payload)
  }

  const send: Pico8Send = (op, payload) => {
    if (op < firstGameOp) throw new Error(`PICO-8 ops below ${firstGameOp} belong to the bridge, got ${op}`)
    sendRaw(op, payload)
  }

  const onCartMessage = (op: number, payload: number[]) => {
    log("cart -> page", op, payload)
    if (op === CartOp.BOOT) {
      // The first boot, or the cart restarted part way through: send it the whole world again.
      sendRaw(PageOp.HELLO, [state.completed ? 1 : 0])
      if (palette) sendRaw(PageOp.PALETTE, palette)
      if (options.puzzleString) for (const part of chunks(textToBytes(options.puzzleString))) sendRaw(PageOp.PUZZLE_PART, part)
      if (state.progress) for (const part of chunks(textToBytes(state.progress))) sendRaw(PageOp.PROGRESS_PART, part)
      options.onBoot?.(send)
      sendRaw(PageOp.READY)
      if (state.started) sendRaw(PageOp.START)
      if (state.paused) sendRaw(PageOp.PAUSE, [1])
    } else if (op === CartOp.LOADED) {
      if (!state.loaded) sdk.gameLoaded()
      state.loaded = true
    } else if (op === CartOp.FINISHED) {
      if (state.reopened) return
      if (options.onFinished) options.onFinished()
      else sdk.showCompletionScreen([])
    } else if (op === CartOp.SAVE_PART) {
      state.saving.push(...payload)
    } else if (op === CartOp.SAVE) {
      const progress = bytesToText([...state.saving, ...payload])
      state.saving = []
      // pz_complete() saves the final progress, which the cart has often just saved already
      if (progress === state.progress) return
      state.progress = progress
      sdk.updateGameState(progress)
    } else if (op === CartOp.DEED) {
      const [hi = 0, lo = 0, persist = 0, ...id] = payload
      const deed = { id: bytesToText(id), value: hi * 256 + lo }
      state.deeds = state.deeds.filter((d) => d.id !== deed.id)
      state.deeds.push(persist ? { ...deed, persist: true } : deed)
    } else if (op === CartOp.COMPLETE) {
      if (state.completed) return
      const [hi = 0, lo = 0] = payload
      // The SDK adds the time and points deeds itself, from its own timer
      sdk.gameCompleted({ inputString: state.progress, pointsAwarded: hi * 256 + lo, completed: true }, { deeds: state.deeds })
      state.completed = true
      state.deeds = []
    } else if (op >= firstGameOp) {
      options.onMessage?.(op, payload, send)
    }
  }

  sdk.on("start", () => {
    state.started = true
    sendRaw(PageOp.START)
  })
  sdk.on("pause", () => {
    state.paused = true
    sendRaw(PageOp.PAUSE, [1])
  })
  sdk.on("resume", () => {
    state.paused = false
    sendRaw(PageOp.PAUSE, [0])
  })
  sdk.on("retry", () => {
    state.reopened = false
    state.completed = false
    state.progress = ""
    state.deeds = []
    options.onRetry?.()
    sendRaw(PageOp.RETRY)
  })

  const tick = () => {
    for (const { op, payload } of channel.tick()) onCartMessage(op, payload)
  }

  let frame: number | null = null
  const loop = () => {
    tick()
    frame = requestAnimationFrame(loop)
  }
  if (options.autoTick !== false && typeof requestAnimationFrame === "function") frame = requestAnimationFrame(loop)

  return {
    send,
    tick,
    stop: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
    },
    get backlog() {
      return channel.backlog
    },
  }
}
