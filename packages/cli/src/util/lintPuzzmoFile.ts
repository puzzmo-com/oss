import type { PuzzmoFile } from "./api.js"

/** Non-fatal checks on a schema-valid puzzmo.json. Returns human-readable warning messages. */
export const lintPuzzmoFile = (puzzmoFile: PuzzmoFile): string[] => {
  const warnings: string[] = []

  const leaderboards = puzzmoFile.integrations?.leaderboards
  if (Array.isArray(leaderboards)) {
    for (const leaderboard of leaderboards) {
      if (!leaderboard || typeof leaderboard !== "object") continue
      const { displayName, stableID, sortValue } = leaderboard as { displayName?: string; stableID?: string; sortValue?: unknown }
      if (sortValue !== undefined) continue
      const label = displayName ?? stableID ?? "unnamed"
      warnings.push(
        `Leaderboard "${label}" has no sortValue — you probably want one, it controls the ordering when shown alongside other leaderboards and stats.`,
      )
    }
  }

  return warnings
}
