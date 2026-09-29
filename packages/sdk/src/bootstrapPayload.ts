import type { BootstrapGame, BootstrapGameData, BootstrapSession } from "./types"

/**
 * READY_DATA as hosts from before the payload split send it: the gameplay with the puzzle nested
 * inside it, and a flattened game inside that. Deliberately not part of the SDK's public types.
 */
type LegacyReadyData = Omit<BootstrapGameData, "game" | "session"> & {
  game?: BootstrapGame
  session?: BootstrapSession
  startOrFindGameplay?: {
    gamePlayed?: BootstrapSession["gameplay"] & { puzzle: BootstrapSession["puzzle"] & { game?: any; viewerMetadata?: unknown } }
  }
}

/**
 * Fills in `game` and `session` when READY_DATA comes from a host which only sends the older
 * `startOrFindGameplay` nesting, so the SDK and games only ever see the new shape. A copy of
 * upgradeBootstrapGameData in @puzzmo-com/shared, which the SDK can't depend on.
 */
export const normalizeReadyData = (received: unknown): BootstrapGameData => {
  const { startOrFindGameplay, ...data } = received as LegacyReadyData
  if (data.game) return data as BootstrapGameData

  const gamePlayed = startOrFindGameplay?.gamePlayed
  const game = gameFromLegacy(gamePlayed?.puzzle?.game ?? {})
  if (!gamePlayed) return { ...data, game }

  const { puzzle, ...gameplay } = gamePlayed
  const { game: _game, viewerMetadata, ...puzzleFields } = puzzle
  return { ...data, game, session: { gameplay, puzzle: puzzleFields }, viewerMetadata: data.viewerMetadata ?? viewerMetadata }
}

/** Builds the game from the flattened fields older hosts put on `puzzle.game`, with no version IDs */
const gameFromLegacy = (game: any): BootstrapGame => {
  const flags = game.flagsArr
  return {
    id: game.id ?? "",
    slug: game.slug ?? "",
    stableSlug: game.stableSlug ?? game.slug ?? "",
    displayName: game.displayName ?? "",
    version: {
      id: "",
      label: null,
      featuresArr: game.featuresArr ?? [0],
      flagsArr: Array.isArray(flags) ? flags : typeof flags === "number" ? [flags] : [0],
      runtime: {
        id: "",
        version:
          game.assetsSha || game.assetsBaseURL
            ? { id: "", assetsSha: game.assetsSha ?? "", assetsBaseURL: game.assetsBaseURL ?? "" }
            : null,
      },
    },
  }
}
