#!/usr/bin/env node

import { defineCommand, runMain } from "citty"

import { agentTest } from "./commands/agent-test.js"
import { type ChangedAgainst, changed } from "./commands/changed.js"
import { gameCreate } from "./commands/game/create.js"
import { login } from "./commands/login.js"
import { migrate } from "./commands/migrate.js"
import { upload } from "./commands/upload.js"
import { validate } from "./commands/validate.js"
import { defaultSource } from "./util/config.js"

const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Save a CLI auth token. Multiple tokens can be stored, one per --source server.",
  },
  args: {
    token: { type: "positional", description: "The pzt- token from dev.puzzmo.com", required: true },
    source: { type: "string", description: "Server this token belongs to", default: defaultSource },
  },
  run: ({ args }) => login(args.token, args.source),
})

const uploadCommand = defineCommand({
  meta: {
    name: "upload",
    description: "Discover puzzmo.json files and upload each game's build and sync the puzzmo.json.",
  },
  args: {
    dir: { type: "positional", description: "Directory to scan", required: false, default: "." },
    verbose: { type: "boolean", description: "Print request URLs and full error bodies", alias: "v" },
    "create-missing": {
      type: "boolean",
      description: "Create games that don't exist yet without an interactive prompt (for CI).",
    },
  },
  run: ({ args }) => upload(args.dir, { verbose: args.verbose, createMissing: args["create-missing"] }),
})

const validateCommand = defineCommand({
  meta: { name: "validate", description: "Validate every puzzmo.json under [dir]" },
  args: {
    dir: { type: "positional", description: "Directory to scan", required: false, default: "." },
  },
  run: ({ args }) => validate(args.dir),
})

const changedCommand = defineCommand({
  meta: { name: "changed", description: "Report which games changed since their last deployed build (for CI)." },
  args: {
    dir: { type: "positional", description: "Directory to scan", required: false, default: "." },
    json: { type: "boolean", description: "Output a JSON report for every discovered game" },
    list: { type: "boolean", description: "Output only the changed game folders, one per line" },
    matrix: { type: "boolean", description: "Output a GitHub Actions matrix of the changed games" },
    ref: { type: "string", description: "Git ref to compare against (default HEAD)" },
    against: {
      type: "enum",
      options: ["latest", "next", "previous"],
      description: "Which deployed build to use as the baseline (default latest)",
    },
    "include-uncommitted": { type: "boolean", description: "Also count uncommitted working-tree changes" },
  },
  run: ({ args }) =>
    changed(args.dir, {
      json: args.json,
      list: args.list,
      matrix: args.matrix,
      ref: args.ref,
      against: args.against as ChangedAgainst | undefined,
      includeUncommitted: args["include-uncommitted"],
    }),
})

// Commands that operate across every puzzmo.json in a repo live under `puzzmo games`.
const gamesCommand = defineCommand({
  meta: { name: "games", description: "Commands that run across all the games in your repo" },
  subCommands: { changed: changedCommand, upload: uploadCommand, validate: validateCommand },
})

const migrateCommand = defineCommand({
  meta: { name: "migrate", description: "List and select migration skills from dev.puzzmo.com" },
  run: () => migrate(),
})

const gameCreateCommand = defineCommand({
  meta: { name: "create", description: "Scaffold a new Puzzmo game project" },
  args: {
    strategy: { type: "enum", options: ["import", "blank", "prompt"], description: "How to seed the new game" },
    prompt: { type: "string", description: "Game description (used with --strategy prompt)" },
    name: { type: "string", description: "Game display name" },
    slug: { type: "string", description: "Game slug (defaults to a slugified --name)" },
    teamID: { type: "string", description: "Team ID to write into puzzmo.json" },
    url: { type: "string", description: "Source URL (used with --strategy import)" },
    agent: { type: "string", description: "LLM agent id to drive scaffolding" },
    token: { type: "string", description: "Save this token before creating the game" },
    pm: { type: "enum", options: ["npm", "yarn", "pnpm"], description: "Package manager to use" },
  },
  run: ({ args }) =>
    gameCreate({
      strategy: args.strategy,
      prompt: args.prompt,
      name: args.name,
      slug: args.slug,
      teamID: args.teamID,
      url: args.url,
      agent: args.agent,
      accessToken: args.token,
      pm: args.pm,
    }),
})

const gameCommand = defineCommand({
  meta: { name: "game", description: "Game project commands" },
  subCommands: { create: gameCreateCommand },
})

/** Warn that a top-level command moved under `puzzmo games`, then run it anyway. */
const movedToGames = (name: string) => console.warn(`"puzzmo ${name}" is now "puzzmo games ${name}". The old form still works for now.`)

// Deprecated top-level aliases, kept hidden so existing scripts (e.g. `puzzmo upload`) keep working.
const uploadAlias = defineCommand({
  meta: { ...uploadCommand.meta, hidden: true },
  args: uploadCommand.args,
  run: ({ args }) => {
    movedToGames("upload")
    return upload(args.dir, { verbose: args.verbose })
  },
})

const validateAlias = defineCommand({
  meta: { ...validateCommand.meta, hidden: true },
  args: validateCommand.args,
  run: ({ args }) => {
    movedToGames("validate")
    return validate(args.dir)
  },
})

const main = defineCommand({
  meta: { name: "puzzmo", description: "Puzzmo CLI" },
  subCommands: {
    login: loginCommand,
    games: gamesCommand,
    migrate: migrateCommand,
    game: gameCommand,
    upload: uploadAlias,
    validate: validateAlias,
    "agent-test": defineCommand({
      meta: { name: "agent-test", description: "Run the agent test harness", hidden: true },
      run: () => agentTest(),
    }),
  },
})

runMain(main)
