import { createPuzzmoSDK, type Theme } from "@puzzmo/sdk"
import { createEncoder, defineSchema, type EncoderResult } from "@puzzmo/sdk/inputs"

/** Decoded puzzle definition shipped from the host. The host serializes this as JSON. */
type Puzzle = { rows: number; cols: number; mines: [number, number][] }

/** Persisted player progress. `won` is derived, not stored. */
type State = { revealed: boolean[]; flagged: boolean[] }

const MINE_PENALTY_MS = 60_000

/**
 * Schema for serializing per-cell boolean state. `bitArray` packs 4 cells per hex char,
 * so a 16x16 board ≈ 64 chars instead of a multi-kilobyte JSON blob.
 */
const stateSchema = defineSchema<State>({
  version: 1,
  fields: {
    revealed: { type: "bitArray" },
    flagged: { type: "bitArray" },
  },
})

/**
 * Construct the host SDK. Resolves messaging with the embed, manages the timer, and
 * surfaces lifecycle events ("start", "settingsUpdate", etc.).
 */
const sdk = createPuzzmoSDK()

const boardEl = document.getElementById("board")!
const hudLeftEl = document.getElementById("hudLeft")!
const hudRightEl = document.getElementById("hudRight")!

let puzzle: Puzzle = { rows: 9, cols: 9, mines: [] }
let state: State = { revealed: [], flagged: [] }
let mineSet = new Set<number>()
let stateCodec: EncoderResult<State> | null = null
let won = false

/** Maps the Puzzmo Theme onto the CSS custom properties consumed by style.css. */
const applyTheme = (theme: Theme) => {
  const r = document.documentElement.style
  r.setProperty("--bg", theme.a_bg)
  r.setProperty("--panel", theme.a_infoBG)
  r.setProperty("--cell", theme.g_unsolved)
  r.setProperty("--cell-revealed", theme.g_bg)
  r.setProperty("--border", theme.g_outline)
  r.setProperty("--text", theme.fg)
  r.setProperty("--text-on-cell", theme.g_textDark)
  r.setProperty("--accent", theme.key)
  r.setProperty("--mine", theme.error)
  r.setProperty("--flag", theme.subBrand)
  r.setProperty("--n1", theme.player)
  r.setProperty("--n2", theme.alt1)
  r.setProperty("--n3", theme.alt2)
  r.setProperty("--n4", theme.alt3)
  r.setProperty("--n5", theme.error)
  r.setProperty("--n6", theme.keyStrong)
  r.setProperty("--n7", theme.playerLight)
  r.setProperty("--n8", theme.alwaysDark)
}

const idx = (r: number, c: number) => r * puzzle.cols + c

const neighbours = (i: number): number[] => {
  const r = Math.floor(i / puzzle.cols)
  const c = i % puzzle.cols
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const nr = r + dr
      const nc = c + dc
      if (nr < 0 || nr >= puzzle.rows || nc < 0 || nc >= puzzle.cols) continue
      out.push(idx(nr, nc))
    }
  }
  return out
}

const countAdjacentMines = (i: number) => neighbours(i).filter((n) => mineSet.has(n)).length

const reveal = (i: number, isUserClick: boolean) => {
  if (state.revealed[i] || state.flagged[i]) return
  state.revealed[i] = true
  if (mineSet.has(i)) {
    /**
     * `addPenalty(ms)` adds to the timer's tracked "added time", surfaced separately
     * in `display()` and reported via `gameCompleted({ additionalTimeAddedSecs })`.
     */
    if (isUserClick) sdk.timer.addPenalty(MINE_PENALTY_MS)
    return
  }
  if (countAdjacentMines(i) === 0) for (const n of neighbours(i)) reveal(n, false)
}

const checkWin = () => {
  const safe = puzzle.rows * puzzle.cols - mineSet.size
  let revealedSafe = 0
  for (let i = 0; i < state.revealed.length; i++) if (state.revealed[i] && !mineSet.has(i)) revealedSafe++
  if (revealedSafe === safe) won = true
}

const flaggedCount = () => state.flagged.reduce((acc, v) => acc + (v ? 1 : 0), 0)

const render = () => {
  boardEl.innerHTML = ""
  for (let i = 0; i < puzzle.rows * puzzle.cols; i++) {
    const cell = document.createElement("button")
    cell.className = "cell"
    cell.dataset.i = String(i)
    if (state.revealed[i]) {
      cell.classList.add("revealed")
      if (mineSet.has(i)) {
        cell.classList.add("mine")
        cell.textContent = "✸"
      } else {
        const n = countAdjacentMines(i)
        if (n > 0) {
          cell.dataset.n = String(n)
          cell.textContent = String(n)
        }
      }
    } else if (state.flagged[i]) {
      cell.classList.add("flagged")
      cell.textContent = "⚑"
    }
    boardEl.appendChild(cell)
  }
  if (won) {
    hudLeftEl.textContent = "completed"
    hudRightEl.textContent = ""
  } else {
    hudLeftEl.textContent = `${mineSet.size} mines`
    hudRightEl.textContent = `${flaggedCount()} flags`
  }
}

/**
 * Called once on win. Reports gameplay metrics back to the host via:
 * - `sdk.gameCompleted(gameplay, augmentations)` — durable record + deeds
 * - `sdk.showCompletionScreen(content, gameplay, completed)` — the host's win UI
 */
const onComplete = () => {
  const elapsed = Math.round(sdk.timer.timeSecs())
  const penalty = Math.round(sdk.timer.addedTimeSecs())
  const data = { elapsedTimeSecs: elapsed, additionalTimeAddedSecs: penalty, pointsAwarded: 0, completed: true }
  sdk.gameCompleted(data, { deeds: [] })
  sdk.showCompletionScreen([{ type: "md", text: penalty > 0 ? `**Cleared!** With ${penalty}s in penalties.` : "**Cleared!**" }], data, true)
}

const persistState = () => {
  if (!stateCodec) return
  /**
   * `sdk.updateGameState(string)` ships an opaque string back to the host so progress
   * survives a reload. We use the SDK's input encoder for compactness over JSON.
   */
  sdk.updateGameState(stateCodec.encode(state))
}

const handleClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (!target.classList.contains("cell")) return
  if (won) return
  const i = Number(target.dataset.i)
  if (e.shiftKey || e.button === 2) {
    if (!state.revealed[i]) state.flagged[i] = !state.flagged[i]
  } else {
    reveal(i, true)
    checkWin()
  }
  persistState()
  render()
  if (won) onComplete()
}

const blankState = (cells: number): State => ({ revealed: new Array(cells).fill(false), flagged: new Array(cells).fill(false) })

const setupBoard = (data: Puzzle, savedState?: State) => {
  puzzle = data
  mineSet = new Set(data.mines.map(([r, c]) => idx(r, c)))
  const cells = data.rows * data.cols
  state = savedState ?? blankState(cells)
  /**
   * `bitArray` requires each field's length in the encoder context to round-trip
   * correctly. We rebuild the codec whenever the board dimensions change.
   */
  stateCodec = createEncoder(stateSchema, {
    revealed: { length: cells },
    flagged: { length: cells },
  })
  won = false
  // Publish board dimensions to CSS so grid tracks + cell font-size scale purely from the stylesheet.
  boardEl.style.setProperty("--cols", String(data.cols))
  boardEl.style.setProperty("--rows", String(data.rows))
  checkWin()
  render()
}

/**
 * Lifecycle entrypoint:
 * - `sdk.gameReady()` blocks until the host sends puzzle/state/theme.
 * - `sdk.gameLoaded()` tells the host we're done bootstrapping; the host will
 * then dispatch `start` (or restore a paused session).
 */
const init = async () => {
  const { puzzleString, inputString, theme } = await sdk.gameReady()
  if (theme) applyTheme(theme)
  const parsed = puzzleString ? (JSON.parse(puzzleString) as Puzzle) : puzzle
  const cells = parsed.rows * parsed.cols
  /**
   * Decode prior progress with the encoder so older save formats can be migrated
   * via the schema's `migrations` map (none yet, but wired up for free).
   */
  const tempCodec = createEncoder(stateSchema, { revealed: { length: cells }, flagged: { length: cells } })
  const saved = inputString ? (tempCodec.decode(tempCodec.migrate(inputString)) as State) : undefined
  setupBoard(parsed, saved)
  sdk.gameLoaded()
}

sdk.on("start", () => {
  render()
})

/** The host re-emits its theme (and other settings) when the player toggles light/dark. */
sdk.on("settingsUpdate", (data: { theme?: Theme }) => {
  if (data?.theme) applyTheme(data.theme)
})

boardEl.addEventListener("click", handleClick)
boardEl.addEventListener("contextmenu", (e) => {
  e.preventDefault()
  handleClick(e)
})

init()
