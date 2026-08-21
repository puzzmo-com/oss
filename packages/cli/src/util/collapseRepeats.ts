/** Longest run of lines considered as a repeating unit — a tool call plus its result is two. */
const maxBlockLines = 10

/** A line of output, plus how many times it repeated in place. */
export type RepeatableLine = { text: string; reps: number }

/**
 * Folds the just-appended tail into an identical block directly above it, bumping that
 * block's count. Agents retry the same edit over and over, and each attempt logs its call
 * and its result on separate lines, so this matches repeating *blocks*, not just lines.
 *
 * Mutates `lines` and runs in the append path, so a live pane can fold without re-scanning
 * its whole buffer on every render. Returns true when a fold happened.
 */
export const foldTailRepeat = (lines: RepeatableLine[]): boolean => {
  for (let size = 1; size <= maxBlockLines; size++) {
    const tail = lines.length - size
    const prev = tail - size
    if (prev < 0) return false
    if (!foldable(lines, prev, tail, size)) continue
    // The earlier copy carries the count for the whole block, so the new one just goes.
    lines[prev].reps++
    lines.length = tail
    return true
  }
  return false
}

/**
 * Folds consecutive repeats across a finished array in one pass, preferring whichever
 * block length swallows the most lines. Use this for a written log; use `foldTailRepeat`
 * for anything appended incrementally.
 */
export const collapseRepeats = (lines: string[]): string[] => {
  const out: string[] = []
  let index = 0
  while (index < lines.length) {
    let bestSize = 1
    let bestReps = 1
    for (let size = 1; size <= maxBlockLines && index + size * 2 <= lines.length; size++) {
      let reps = 1
      while (blockRepeats(lines, index, size, reps)) reps++
      if (reps > 1 && size * reps > bestSize * bestReps) {
        bestSize = size
        bestReps = reps
      }
    }

    const block = lines.slice(index, index + bestSize)
    if (bestReps > 1) block[0] = `${block[0]} (x ${bestReps})`
    out.push(...block)
    index += bestSize * bestReps
  }
  return out
}

/**
 * True when the block at `b` is an unfolded repeat of the block at `a`. Both blocks must
 * be free of existing counts (bar the first line of `a`, which is where a count lives),
 * so folding can never bury a tally inside a block and lose it.
 */
const foldable = (lines: RepeatableLine[], a: number, b: number, size: number): boolean => {
  for (let i = 0; i < size; i++) {
    if (lines[b + i].reps !== 1) return false
    if (i > 0 && lines[a + i].reps !== 1) return false
    if (lines[a + i].text !== lines[b + i].text) return false
  }
  return true
}

/** True when copy number `reps` of the block at `start` is still an exact match. */
const blockRepeats = (lines: string[], start: number, size: number, reps: number): boolean => {
  const offset = start + reps * size
  if (offset + size > lines.length) return false
  for (let i = 0; i < size; i++) if (lines[offset + i] !== lines[start + i]) return false
  return true
}
