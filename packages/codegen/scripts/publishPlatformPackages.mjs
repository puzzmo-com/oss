// Run: node scripts/publishPlatformPackages.mjs [--dry-run]
// Created: 2026-10-01
//
// Stamps out one npm package per platform around the binaries CI just built, and publishes
// each to public npm. Runs from puzzmo-com/oss, where the crate is mirrored, because that
// repo is public and already has npm trusted publishing (OIDC) wired up -- see the "Why
// public npm" section of packages/codegen/README.md in the monorepo.
//
// Expects the built binaries under ./binaries/<platform>/, which is the layout
// actions/download-artifact produces when every build job uploads under its platform name.
import { execFileSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))

// Matches the `supported` map in resolve.js -- a platform missing from either side silently
// stops resolving, so change them together.
const PLATFORMS = {
  "darwin-arm64": { os: "darwin", cpu: "arm64" },
  "darwin-x64": { os: "darwin", cpu: "x64" },
  "linux-arm64": { os: "linux", cpu: "arm64" },
  "linux-x64": { os: "linux", cpu: "x64" },
  "win32-x64": { os: "win32", cpu: "x64" },
}

const SCOPE = "@puzzmo"
const dryRun = process.argv.includes("--dry-run")
const workDir = process.env.GITHUB_WORKSPACE ?? join(scriptDir, "../../..")

const downloaded = readdirSync(join(workDir, "binaries"))
const missing = Object.keys(PLATFORMS).filter((p) => !downloaded.includes(p))
// Publishing a subset would leave the five packages on different versions, which the
// wrapper's optionalDependencies cannot express. Refuse rather than drift.
if (missing.length) throw new Error(`No binary was built for: ${missing.join(", ")}`)

const published = Object.keys(PLATFORMS).map(publishedVersion)
// npm trusted publishing attaches a publisher to a package that already exists, so a name
// nobody has ever published cannot be published from CI. Say so plainly rather than letting
// npm fail with a permissions error that reads like a broken token.
if (!dryRun && !published.some(Boolean)) {
  throw new Error(
    "None of the platform packages exist on npm yet, so trusted publishing has nothing to attach to.\n" +
      "Publish each name once by hand (a package.json with the right name, os and cpu is enough),\n" +
      "enable trusted publishing on it, then re-run this workflow.",
  )
}

const version = nextVersion()
console.log(`Publishing ${Object.keys(PLATFORMS).length} packages at ${version}\n`)

for (const [platform, { os, cpu }] of Object.entries(PLATFORMS)) {
  const exe = os === "win32" ? "puzzmo-codegen.exe" : "puzzmo-codegen"
  const stagingDir = join(workDir, "staging", platform)
  mkdirSync(stagingDir, { recursive: true })

  const binary = join(stagingDir, exe)
  copyFileSync(join(workDir, "binaries", platform, exe), binary)
  // upload-artifact drops the executable bit, so put it back before packing.
  chmodSync(binary, 0o755)

  const manifest = {
    name: `${SCOPE}/codegen-${platform}`,
    version,
    description: `puzzmo-codegen binary for ${platform}`,
    license: "MIT",
    // os/cpu let yarn skip the four packages this machine cannot run.
    os: [os],
    cpu: [cpu],
    files: [exe],
    repository: { type: "git", url: "git+https://github.com/puzzmo-com/oss.git" },
  }
  writeFileSync(join(stagingDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`${dryRun ? "[dry run] " : ""}${manifest.name}@${version}`)
  if (dryRun) continue

  // --access public because scoped packages default to restricted; --provenance matches the
  // rest of the OSS repo and works here because the repo is public. Auth is OIDC, no token.
  execFileSync("npm", ["publish", "--provenance", "--access", "public"], { cwd: stagingDir, stdio: "inherit" })
}

console.log(`\nDone. Set packages/codegen's optionalDependencies to ${version} in the monorepo.`)

/**
 * The version of a platform package already on npm, or null when it has never been published.
 *
 * Tests the output rather than the exit code: some npm builds answer `view` for an unpublished
 * package with a default version and exit 0, so a try/catch alone reads "missing" as "0.0.0".
 */
function publishedVersion(platform) {
  let out
  try {
    out = execFileSync("npm", ["view", `${SCOPE}/codegen-${platform}`, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    return null
  }

  const version = out.trim()
  return /^\d+\.\d+\.\d+/.test(version) ? version : null
}

/** One version for all five packages: the highest already on npm, patch-incremented. */
function nextVersion() {
  let highest = [0, 0, 0]

  for (const version of published) {
    if (!version) continue
    const parts = version.split(".").map(Number)
    if (parts.length === 3 && parts.every((n) => Number.isInteger(n)) && gt(parts, highest)) highest = parts
  }

  return `${highest[0]}.${highest[1]}.${highest[2] + 1}`
}

function gt(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}
