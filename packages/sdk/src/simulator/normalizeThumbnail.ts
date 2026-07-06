import type { ThumbnailResult } from "../types"

/**
 * Coerces a thumbnail render result into a `ThumbnailResult`. New game bundles return the object
 * directly; bundles still built against the old `renderThumbnail(): string` contract return a bare
 * SVG string, so we parse the dimensions out of it (falling back to a square).
 *
 * Inlined here (rather than shared with the rest of the monorepo) because the SDK ships to OSS and
 * must stay self-contained.
 */
export function normalizeThumbnailResult(result: string | ThumbnailResult): ThumbnailResult {
  if (typeof result !== "string") return result
  const size = getSVGSizeFromString(result) ?? { width: 800, height: 800 }
  return { svg: result, width: size.width, height: size.height }
}

/** Reads an SVG's intrinsic size from its `viewBox` (preferred) or its `width`/`height` attributes. */
function getSVGSizeFromString(svg: string): { width: number; height: number } | undefined {
  const start = svg.indexOf("<svg")
  if (start === -1) return undefined
  const end = svg.indexOf(">", start)
  const openTag = end === -1 ? svg.slice(start) : svg.slice(start, end + 1)

  const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(openTag)
  if (viewBox) {
    const width = parseFloat(viewBox[1])
    const height = parseFloat(viewBox[2])
    if (width > 0 && height > 0) return { width, height }
  }

  const width = parseFloat(/\bwidth\s*=\s*["']\s*([\d.]+)(?:px)?\s*["']/i.exec(openTag)?.[1] ?? "")
  const height = parseFloat(/\bheight\s*=\s*["']\s*([\d.]+)(?:px)?\s*["']/i.exec(openTag)?.[1] ?? "")
  if (width > 0 && height > 0) return { width, height }

  return undefined
}
