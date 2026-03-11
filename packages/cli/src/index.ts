#!/usr/bin/env node

import { login } from "./commands/login.js"
import { upload } from "./commands/upload.js"
import { gameCreate } from "./commands/game/create.js"

const [command, ...args] = process.argv.slice(2)

const printUsage = () => {
  console.log(`Usage:
  puzzmo login <token>            Save a CLI auth token
  puzzmo upload <slug> <dir>      Upload game build from <dir>
  puzzmo game create [token]      Create a new Puzzmo game project`)
}

const run = async () => {
  switch (command) {
    case "login": {
      const token = args[0]
      if (!token) {
        console.error("Usage: puzzmo login <token>")
        process.exit(1)
      }
      login(token)
      break
    }
    case "upload": {
      const gameSlug = args[0]
      const dir = args[1]
      if (!gameSlug || !dir) {
        console.error("Usage: puzzmo upload <gameSlug> <dir>")
        process.exit(1)
      }
      await upload(gameSlug, dir)
      break
    }
    case "game": {
      const [subcommand, ...subArgs] = args
      if (subcommand === "create") {
        await gameCreate(subArgs)
      } else {
        console.error("Usage: puzzmo game create [token] [--name <name>] [--url <url>] [--agent <agent>]")
        process.exit(1)
      }
      break
    }
    default:
      printUsage()
      break
  }
}

run().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
