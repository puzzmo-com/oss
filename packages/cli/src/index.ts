#!/usr/bin/env node

import { agentTest } from "./commands/agent-test.js"
import { login } from "./commands/login.js"
import { upload } from "./commands/upload.js"
import { validate } from "./commands/validate.js"
import { gameCreate } from "./commands/game/create.js"
import { migrate } from "./commands/migrate.js"

const [command, ...args] = process.argv.slice(2)

const printUsage = () => {
  console.log(`Usage:
  puzzmo login <token> [--source <url>]  Save a CLI auth token. You can have many stored tokens for different teams. 
                                         --source defaults to https://api.puzzmo.com;

  puzzmo game create [token]             Create a new Puzzmo game project

  puzzmo upload [dir] [-v]               Discover puzzmo.json files in [dir] (default: .) and upload each game's build.
  puzzmo validate [dir]                  Discover and validate every puzzmo.json under [dir] (default: .)
  puzzmo migrate                         List and select migration skills from dev.puzzmo.com`)
}

const run = async () => {
  switch (command) {
    case "login": {
      const sourceIndex = args.findIndex((a) => a === "--source")
      const source = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined
      if (sourceIndex >= 0 && !source) {
        console.error("Usage: puzzmo login <token> [--source <url>]")
        process.exit(1)
      }
      const sourceValueIndex = sourceIndex >= 0 ? sourceIndex + 1 : -1
      const token = args.find((a, i) => !a.startsWith("-") && i !== sourceValueIndex)
      if (!token) {
        console.error("Usage: puzzmo login <token> [--source <url>]")
        process.exit(1)
      }
      login(token, source)
      break
    }
    case "upload": {
      const verbose = args.includes("--verbose") || args.includes("-v")
      const dir = args.find((a) => !a.startsWith("-")) ?? "."
      await upload(dir, { verbose })
      break
    }
    case "game": {
      const [subcommand, ...subArgs] = args
      if (subcommand === "create") {
        await gameCreate(subArgs)
      } else {
        console.error(
          "Usage: puzzmo game create [--strategy <import|blank|prompt>] [--prompt <text>] [--name <name>] [--url <url>] [--agent <agent>] [--token <token>] [--pm <npm|yarn|pnpm>]",
        )
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
    case "agent-test": {
      await agentTest()
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
