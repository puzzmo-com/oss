import fs from "node:fs"
import path from "node:path"

import { discoverGames } from "../util/discoverGames.js"
import { lintPuzzmoFile } from "../util/lintPuzzmoFile.js"

/** CLI command: puzzmo games validate [dir] — discovers every puzzmo.json under dir and validates each */
export const validate = async (dir: string) => {
  const rootDir = path.resolve(dir)
  if (!fs.existsSync(rootDir)) {
    console.error(`Directory not found: ${dir}`)
    process.exit(1)
  }

  const { games, errors } = await discoverGames(rootDir)

  if (!games.length && !errors.length) {
    console.error(`No puzzmo.json files found under ${rootDir}`)
    process.exit(1)
  }

  for (const game of games) {
    const rel = path.relative(rootDir, game.puzzmoJsonPath) || game.puzzmoJsonPath
    const integrations = game.puzzmoFile.integrations ? Object.keys(game.puzzmoFile.integrations) : []
    const distRel = path.relative(rootDir, game.distDir) || game.distDir
    console.log(`OK   ${game.puzzmoFile.game.slug.padEnd(24)} (${rel})`)
    console.log(`     dist: ${distRel}`)
    if (integrations.length) console.log(`     integrations: ${integrations.join(", ")}`)
    for (const warning of lintPuzzmoFile(game.puzzmoFile)) console.log(`     warning: ${warning}`)
  }

  for (const err of errors) {
    const rel = path.relative(rootDir, err.puzzmoJsonPath) || err.puzzmoJsonPath
    const label = err.slug ?? rel
    console.error(`FAIL ${label.padEnd(24)} (${rel})`)
    for (const e of err.errors) console.error(`     ${e}`)
  }

  console.log(`\n${games.length} valid, ${errors.length} invalid`)
  if (errors.length) process.exit(1)
}
