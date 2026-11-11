/**
 * Helpers for writing a game's bundles, so the public app bundle and the private server bundle are
 * written the same way. Free of side effects, so importing them never pulls the SDK into a bundle.
 *
 * ```ts
 * // src/appBundle.ts, built by appBundlePlugin
 * export default createAppBundle({ renderThumbnail })
 *
 * // src/serverBundle.ts, built by serverBundlePlugin
 * export default createServerBundle({ achievements: { describe, replayRound } })
 * ```
 */
import type { AppBundle, ServerBundle } from "./types"

/** Types a game's app bundle: the public code Puzzmo and players' browsers call, such as its thumbnail renderer */
export const createAppBundle = <T extends AppBundle>(bundle: T): T => bundle

/** Types a game's server bundle: the private code only Puzzmo calls, such as the replay achievements read */
export const createServerBundle = <T extends ServerBundle>(bundle: T): T => bundle

export type {
  AchievementCounterDescription,
  AchievementFactDescription,
  AchievementsDescription,
  AchievementsServerCapability,
  AppBundle,
  RoundReplayInput,
  RoundReplayResult,
  ServerBundle,
  ServerCallConfig,
  ThumbnailConfig,
  ThumbnailResult,
} from "./types"
