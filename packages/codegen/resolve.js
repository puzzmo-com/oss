// Finds the puzzmo-codegen binary for this machine.
//
// Order: a local cargo build (for whoever is editing the Rust), then the prebuilt
// binary yarn installed for this platform. Returns null when neither exists, which
// callers must treat as "no fast path available" rather than an error -- the binary
// is an optimisation, and every caller has a slower route that still works.
const { existsSync } = require("node:fs")
const { join } = require("node:path")

// These live on public npm under the "puzzmo" scope (the one @puzzmo/sdk ships from) rather
// than the private "puzzmo-com" GitHub Packages scope, because npm.pkg.github.com needs auth
// on every read, which would stop a fresh clone installing without a PAT.

/** Npm package holding the prebuilt binary for the running platform, or null if unsupported. */
const platformPackage = () => {
  const { platform, arch } = process
  const supported = {
    "darwin-arm64": "@puzzmo/codegen-darwin-arm64",
    "darwin-x64": "@puzzmo/codegen-darwin-x64",
    "linux-arm64": "@puzzmo/codegen-linux-arm64",
    "linux-x64": "@puzzmo/codegen-linux-x64",
    "win32-x64": "@puzzmo/codegen-win32-x64",
  }
  return supported[`${platform}-${arch}`] ?? null
}

/** Absolute path to a usable binary, or null when this platform has none installed. */
const resolveBinary = () => {
  const exe = process.platform === "win32" ? "puzzmo-codegen.exe" : "puzzmo-codegen"

  // A local release build wins so edits to crates/ take effect without publishing.
  const local = join(__dirname, "../../crates/target/release", exe)
  if (existsSync(local)) return local

  const pkg = platformPackage()
  if (!pkg) return null

  try {
    return require.resolve(`${pkg}/${exe}`)
  } catch {
    // Linux musl, a skipped optional dependency, or an install that never ran.
    return null
  }
}

module.exports = { resolveBinary, platformPackage }
