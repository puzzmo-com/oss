// CSS easings as progress functions, for the table's boards. A scene names its easings in CSS syntax, so a game writes
// the same `ease-out` or `cubic-bezier()` it would in a stylesheet.

/**
 * Turns a CSS easing into a progress function: keywords, cubic-bezier() and linear() with optional stops. Anything
 * else (`steps()`, or a malformed value) is linear.
 */
export const parseEasing = (value: string): ((t: number) => number) => {
  const v = value.trim()
  if (v === "linear") return linear
  const keyword = keywordEasings[v]
  if (keyword) return cubicBezier(keyword[0], keyword[1], keyword[2], keyword[3])
  const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(v)
  if (bezier) {
    const n = bezier[1].split(",").map(Number)
    if (n.length !== 4 || n.some((x) => Number.isNaN(x))) return linear
    return cubicBezier(n[0], n[1], n[2], n[3])
  }
  const lin = /^linear\(([^)]+)\)$/.exec(v)
  if (lin) return linearStops(lin[1])
  return linear
}

const linear = (t: number) => t

const keywordEasings: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
}

const cubicBezier = (x1: number, y1: number, x2: number, y2: number) => {
  const sx = (t: number) => 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t
  const sy = (t: number) => 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t
  return (x: number) => {
    let lo = 0
    let hi = 1
    let t = x
    for (let i = 0; i < 24; i++) {
      const cx = sx(t)
      if (Math.abs(cx - x) < 1e-5) break
      if (cx < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return sy(t)
  }
}

/** The inside of a linear(), stops with or without positions */
const linearStops = (list: string) => {
  const stops = list.split(",").map((s) => {
    const parts = s.trim().split(/\s+/)
    return { value: Number(parts[0]), at: parts[1] ? parseFloat(parts[1]) / 100 : NaN }
  })
  if (stops.some((stop) => Number.isNaN(stop.value))) return linear
  if (Number.isNaN(stops[0].at)) stops[0].at = 0
  if (Number.isNaN(stops[stops.length - 1].at)) stops[stops.length - 1].at = 1
  // Missing positions spread evenly between the known ones on either side
  let last = 0
  for (let i = 0; i < stops.length; i++) {
    if (!Number.isNaN(stops[i].at)) {
      last = i
      continue
    }
    let next = i
    while (Number.isNaN(stops[next].at)) next++
    for (let j = last + 1; j < next; j++) stops[j].at = stops[last].at + ((stops[next].at - stops[last].at) * (j - last)) / (next - last)
    last = next
  }
  return (t: number) => {
    if (t <= stops[0].at) return stops[0].value
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i].at) {
        const a = stops[i - 1]
        const b = stops[i]
        return a.value + ((b.value - a.value) * (t - a.at)) / (b.at - a.at || 1)
      }
    }
    return stops[stops.length - 1].value
  }
}
