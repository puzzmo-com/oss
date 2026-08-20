/**
 * Coarser sibling of `formatDuration` for a counter that repaints while it runs, where
 * sub-second precision only flickers: 0s / 12s / 6m02s.
 */
export const formatElapsed = (ms: number): string => {
  const secs = Math.floor(ms / 1000)
  return secs < 60 ? `${secs}s` : formatDuration(secs * 1000)
}

/** Renders a span as 340ms / 12.4s / 6m02s — short enough to sit at the end of a log line */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`

  const totalSecs = ms / 1000
  if (totalSecs < 60) return `${totalSecs.toFixed(1)}s`

  let mins = Math.floor(totalSecs / 60)
  let secs = Math.round(totalSecs % 60)
  // Rounding can push seconds to a full minute (119.7s would read "1m60s")
  if (secs === 60) {
    mins += 1
    secs = 0
  }
  return `${mins}m${String(secs).padStart(2, "0")}s`
}
