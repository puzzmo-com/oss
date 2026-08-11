import type { AppBundle, ThumbnailConfig } from "@puzzmo/sdk"
import { svgFontFaceCSSRaw } from "@puzzmo/sdk/fonts"
import { createEncoder, defineSchema } from "@puzzmo/sdk/inputs"
import { h, render } from "@puzzmo/sdk/svgJSX"

type Puzzle = { rows: number; cols: number; mines: [number, number][] }
type State = { revealed: boolean[]; flagged: boolean[] }

/** Mirrors the schema in src/main.ts so a saved input string round-trips here too. */
const stateSchema = defineSchema<State>({
  version: 1,
  fields: {
    revealed: { type: "bitArray" },
    flagged: { type: "bitArray" },
  },
})

/**
 * Renders a small SVG preview of the puzzle plus its pixel dimensions, so the host can size
 * the thumbnail without parsing the SVG. When an `inputStr` is supplied the preview reflects
 * the player's progress; otherwise it shows a blank board.
 *
 * The host renders this in lists/share cards/completion screens — there's no animation and no
 * theme variables, so colors are baked from `config.theme` directly.
 *
 * The JSX here is not React: tsconfig sets `jsxFactory` to `h`, so it compiles to the SDK's
 * svgJSX and `render` turns the result into SVG DOM to serialize. A thumbnail bundle has to stay
 * React-free — the server renders it against a minimal SVG DOM with no React in it. `h` is
 * imported for the compiler's benefit rather than this file's; a classic factory has to be in
 * scope. Attribute names are SVG's or React's as you please: camelCase is kebab-cased on the way
 * out, bar the few SVG spells that way itself (`viewBox`, `preserveAspectRatio`).
 */
export const renderThumbnail: AppBundle["renderThumbnail"] = (puzzleStr: string, inputStr?: string, config?: ThumbnailConfig) => {
  const puzzle = JSON.parse(puzzleStr) as Puzzle
  const { rows, cols } = puzzle
  const cells = rows * cols
  const mineSet = new Set(puzzle.mines.map(([r, c]) => r * cols + c))

  let revealed: boolean[] = new Array(cells).fill(false)
  let flagged: boolean[] = new Array(cells).fill(false)

  if (inputStr) {
    try {
      const codec = createEncoder(stateSchema, { revealed: { length: cells }, flagged: { length: cells } })
      const decoded = codec.decode(codec.migrate(inputStr))
      revealed = decoded.revealed
      flagged = decoded.flagged
    } catch {
      // Bad/old state: fall back to a blank thumbnail.
    }
  }

  const theme = config?.theme
  const bg = theme?.a_bg ?? "#1a1a1a"
  const cellHidden = theme?.g_unsolved ?? "#3a3a3a"
  const cellShown = theme?.g_bg ?? "#1f1f1f"
  const border = theme?.g_outline ?? "#4a4a4a"
  const mineColor = theme?.error ?? "#ff5555"
  const flagColor = theme?.subBrand ?? "#ffaa55"
  const numberColor = theme?.g_textDark ?? "#1b1b28"

  const size = 200
  const pad = 4
  const gap = 1
  const cellW = (size - pad * 2 - gap * (cols - 1)) / cols
  const cellH = (size - pad * 2 - gap * (rows - 1)) / rows
  const glyphSize = Math.min(cellW, cellH) * 0.7

  const board = Array.from({ length: cells }, (_, i) => {
    const x = pad + (i % cols) * (cellW + gap)
    const y = pad + Math.floor(i / cols) * (cellH + gap)
    const isRevealed = revealed[i]
    const isMine = mineSet.has(i)
    // A glyph sits low in the cell so its baseline lands near the middle.
    const cx = x + cellW / 2
    const cy = y + cellH / 2 + cellH * 0.32
    const adjacent = isRevealed && !isMine ? countAdjacent(mineSet, i, rows, cols) : 0

    return (
      <g>
        <rect
          x={x.toFixed(2)}
          y={y.toFixed(2)}
          width={cellW.toFixed(2)}
          height={cellH.toFixed(2)}
          fill={isRevealed ? cellShown : cellHidden}
          stroke={border}
          stroke-width={0.5}
        />
        {isRevealed && isMine && (
          <circle cx={cx.toFixed(2)} cy={(y + cellH / 2).toFixed(2)} r={(Math.min(cellW, cellH) * 0.25).toFixed(2)} fill={mineColor} />
        )}
        {adjacent > 0 && <Glyph x={cx} y={cy} size={glyphSize} fill={numberColor} weight={700} text={String(adjacent)} />}
        {!isRevealed && flagged[i] && <Glyph x={cx} y={cy} size={glyphSize} fill={flagColor} text="⚑" />}
      </g>
    )
  })

  const root = render(
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Embed the @font-face rule so the SVG renders with Puzzmo's bundled font
          even outside the game (host previews, share cards, opengraph). */}
      <style>{svgFontFaceCSSRaw(["RedHatMono-Bold"])}</style>
      <rect width={size} height={size} fill={bg} />
      {board}
    </svg>,
  )
  if (!root || !("outerHTML" in root)) throw new Error("Could not render the minesweeper thumbnail")

  return { svg: root.outerHTML, width: size, height: size }
}

/**
 * A centered character in the board's monospace font — a mine count, or a flag.
 *
 * `font-weight` is spread in rather than passed as `undefined`: svgJSX writes every prop it is
 * given, and an undefined value would serialize as the string "undefined".
 */
const Glyph = (props: { x: number; y: number; size: number; fill: string; text: string; weight?: number }) => (
  <text
    x={props.x.toFixed(2)}
    y={props.y.toFixed(2)}
    text-anchor="middle"
    font-family="RedHatMono-Bold, ui-monospace, monospace"
    font-size={props.size.toFixed(1)}
    fill={props.fill}
    {...(props.weight ? { "font-weight": props.weight } : {})}
  >
    {props.text}
  </text>
)

const countAdjacent = (mineSet: Set<number>, i: number, rows: number, cols: number): number => {
  const r = Math.floor(i / cols)
  const c = i % cols
  let n = 0
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const nr = r + dr
      const nc = c + dc
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
      if (mineSet.has(nr * cols + nc)) n++
    }
  }
  return n
}
