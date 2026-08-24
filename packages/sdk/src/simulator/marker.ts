/**
 * Sentinel string stamped onto the simulator's root element so build tooling can spot a simulator
 * that leaked into a shipped game bundle. Minifiers rewrite identifiers but never string contents,
 * so this literal survives into dist.
 *
 * `puzzmo games validate` greps build output for it — keep it in sync with the copy in
 * packages/cli/src/util/lintDist.ts.
 */
export const simulatorBuildMarker = "puzzmo-simulator-dev-only-do-not-ship"
