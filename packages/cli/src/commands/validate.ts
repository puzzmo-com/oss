import fs from "node:fs"
import path from "node:path"

import { validatePuzzmoJson } from "../util/validatePuzzmoFile.js"

/** CLI command: puzzmo validate [dir] */
export const validate = async (dir: string) => {
  const resolvedDir = path.resolve(dir)
  const puzzmoJsonPath = path.join(resolvedDir, "puzzmo.json")

  if (!fs.existsSync(puzzmoJsonPath)) {
    console.error(`No puzzmo.json found in ${dir}`)
    process.exit(1)
  }

  let raw: string
  try {
    raw = fs.readFileSync(puzzmoJsonPath, "utf-8")
  } catch (e) {
    console.error(`Could not read puzzmo.json: ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (e) {
    console.error(`Invalid JSON in puzzmo.json: ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }

  const result = await validatePuzzmoJson(data)
  if (!result.valid) {
    console.error(`puzzmo.json has ${result.errors.length} error(s):\n`)
    for (const err of result.errors) console.error(`  ${err}`)
    process.exit(1)
  }

  const { data: puzzmoFile } = result
  console.log(`Valid puzzmo.json for "${puzzmoFile.game.displayName}" (${puzzmoFile.game.slug})`)

  if (puzzmoFile.integrations) {
    const keys = Object.keys(puzzmoFile.integrations)
    if (keys.length) console.log(`Integrations: ${keys.join(", ")}`)
  }
}
