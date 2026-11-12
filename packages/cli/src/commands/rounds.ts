import fs from "node:fs"
import path from "node:path"

import { fetchTracedRounds, type TracedRound } from "../queries/rounds.js"
import { sourceToURL, tokenHelp } from "../util/config.js"
import { findTokenForGame } from "../util/tokenForGame.js"

type RoundsPullOptions = {
  game: string
  /** Only this team member's rounds */
  user?: string
  /** Where the fixtures go, relative to the current folder */
  out: string
}

/**
 * CLI command: puzzmo rounds pull --game <slug> — writes the team's traced rounds as replay fixtures, so a local
 * test of the server bundle's replayRound runs on real play with exactly what Puzzmo passed it
 */
export const roundsPull = async (options: RoundsPullOptions) => {
  const entry = await findTokenForGame(options.game)
  if (!entry) {
    console.error(`None of your saved tokens can manage a game with the slug "${options.game}".\n${tokenHelp}`)
    process.exit(1)
  }

  const rounds = (await fetchTracedRounds(sourceToURL(entry.source), entry.token, options.game)).filter(
    (round) => !options.user || round.username === options.user,
  )
  if (!rounds.length) {
    const who = options.user ? `${options.user} has` : "your team has"
    console.log(`No rounds to pull: ${who} no traced rounds for ${options.game}. Play one on puzzmo.com signed in as a team member.`)
    return
  }

  const outDir = path.resolve(options.out)
  fs.mkdirSync(outDir, { recursive: true })
  let written = 0
  for (const round of rounds) {
    if (!round.hasLog || !round.fixture) {
      console.log(`  Skipped ${fixtureName(round)}: its log was too long for Puzzmo to keep`)
      continue
    }
    fs.writeFileSync(path.join(outDir, fixtureName(round)), JSON.stringify(round.fixture, null, 2) + "\n")
    written++
  }
  console.log(`Wrote ${written} round fixture${written === 1 ? "" : "s"} to ${path.relative(process.cwd(), outDir) || "."}`)
  console.log(`Each holds the input and config Puzzmo passed to replayRound, and what that build answered as expected.`)
}

/** A name that sorts by when the round ended and says how it went, e.g. `orta-2026-11-12T09-30-00-completed.json` */
const fixtureName = (round: TracedRound) => {
  const when = new Date(round.at).toISOString().slice(0, 19).replace(/:/g, "-")
  const user = round.username.replace(/[^\w-]/g, "_")
  return `${user}-${when}-${round.outcome}${round.verified ? "" : "-unverified"}.json`
}
