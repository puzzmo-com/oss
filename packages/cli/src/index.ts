#!/usr/bin/env node

import { login } from "./commands/login.js"
import { upload } from "./commands/upload.js"
import { validate } from "./commands/validate.js"
import { gameCreate } from "./commands/game/create.js"
import { migrate } from "./commands/migrate.js"

const [command, ...args] = process.argv.slice(2)

const printUsage = () => {
  console.log(`Usage:
  puzzmo login <token>            Save a CLI auth token
  puzzmo game create [token]      Create a new Puzzmo game project

  puzzmo upload <dir> [-v]        Upload game build from <dir> (slug from puzzmo.json). -v/--verbose prints request URLs and full error bodies.
  puzzmo validate [dir]           Validate puzzmo.json in a directory (default: .)
  puzzmo migrate                  List and select migration skills from dev.puzzmo.com`)
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
      const verbose = args.includes("--verbose") || args.includes("-v")
      const dir = args.find((a) => !a.startsWith("-"))
      if (!dir) {
        console.error("Usage: puzzmo upload <dir> [-v|--verbose]")
        process.exit(1)
      }
      await upload(dir, { verbose })
      break
    }
    case "game": {
      const [subcommand, ...subArgs] = args
      if (subcommand === "create") {
        await gameCreate(subArgs)
      } else {
        console.error("Usage: puzzmo game create [token] [--name <name>] [--url <url>] [--agent <agent>] [--pm <npm|yarn|pnpm>]")
        process.exit(1)
      }
      break
    }
    case "validate": {
      validate(args[0] || ".")
      break
    }
    case "migrate": {
      await migrate()
      break
    }
    default:
      printUsage()
      break
  }
}

run().catch((err) => {
  console.error(err.message || err)
  if (err && err.cause) {
    const cause = err.cause
    console.error(`Caused by: ${cause instanceof Error ? cause.message : cause}`)
  }
  process.exit(1)
})
