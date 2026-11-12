import { fetchGameSlugsForToken } from "../queries/puzzlePool.js"
import { getTokens, isServerReachable, sortByServerPriority, sourceToURL, type TokenEntry } from "./config.js"

/** Finds the first saved token, in server priority order, whose team owns the game */
export const findTokenForGame = async (gameSlug: string): Promise<TokenEntry | null> => {
  for (const entry of sortByServerPriority(getTokens())) {
    if (!(await isServerReachable(entry.source))) continue
    const slugs = await fetchGameSlugsForToken(sourceToURL(entry.source), entry.token).catch(() => null)
    if (slugs?.includes(gameSlug)) return entry
  }
  return null
}
