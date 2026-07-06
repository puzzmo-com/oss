import type { AppBundle, ThumbnailConfig } from "@puzzmo/sdk"
import { svgFontFaceCSSRaw } from "@puzzmo/sdk/fonts"
import { createEncoder, defineSchema } from "@puzzmo/sdk/inputs"

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

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * Renders a small SVG preview of the puzzle plus its pixel dimensions, so the host can size
 * the thumbnail without parsing the SVG. When an `inputStr` is supplied the preview reflects
 * the player's progress; otherwise it shows a blank board.
 *
 * The host renders this in lists/share cards/completion screens — there's no DOM,
 * no animation, no theme variables. We bake colors from `config.theme` directly.
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

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`)
  // Embed the @font-face rule so the SVG renders with Puzzmo's bundled font
  // even outside the game (host previews, share cards, opengraph).
  parts.push(`<style>${svgFontFaceCSSRaw(["RedHatMono-Bold"])}</style>`)
  parts.push(`<rect width="${size}" height="${size}" fill="${escapeXml(bg)}"/>`)

  for (let i = 0; i < cells; i++) {
    const r = Math.floor(i / cols)
    const c = i % cols
    const x = pad + c * (cellW + gap)
    const y = pad + r * (cellH + gap)
    const isRevealed = revealed[i]
    const fill = isRevealed ? cellShown : cellHidden
    parts.push(
      `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cellW.toFixed(2)}" height="${cellH.toFixed(2)}" fill="${escapeXml(fill)}" stroke="${escapeXml(border)}" stroke-width="0.5"/>`,
    )

    if (isRevealed && mineSet.has(i)) {
      const cx = x + cellW / 2
      const cy = y + cellH / 2
      const rad = Math.min(cellW, cellH) * 0.25
      parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rad.toFixed(2)}" fill="${escapeXml(mineColor)}"/>`)
    } else if (isRevealed && !mineSet.has(i)) {
      const n = countAdjacent(mineSet, i, rows, cols)
      if (n > 0) {
        const cx = x + cellW / 2
        const cy = y + cellH / 2 + cellH * 0.32
        const fontSize = Math.min(cellW, cellH) * 0.7
        parts.push(
          `<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" text-anchor="middle" font-family="RedHatMono-Bold, ui-monospace, monospace" font-size="${fontSize.toFixed(1)}" font-weight="700" fill="${escapeXml(numberColor)}">${n}</text>`,
        )
      }
    } else if (flagged[i]) {
      const cx = x + cellW / 2
      const cy = y + cellH / 2 + cellH * 0.32
      const fontSize = Math.min(cellW, cellH) * 0.7
      parts.push(
        `<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" text-anchor="middle" font-family="RedHatMono-Bold, ui-monospace, monospace" font-size="${fontSize.toFixed(1)}" fill="${escapeXml(flagColor)}">⚑</text>`,
      )
    }
  }

  parts.push(`</svg>`)
  return { svg: parts.join(""), width: size, height: size }
}

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
