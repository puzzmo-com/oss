import { execSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { uploadFiles } from "../lib/api.js"
import { getAPIURL, getToken } from "../lib/config.js"

/** Collects all files in a directory recursively */
const collectFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(full))
    else files.push(full)
  }
  return files
}

/** Tries to get the current git SHA, returns null if not in a git repo */
const getGitSHA = (): string | null => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim()
  } catch {
    return null
  }
}

/** Hashes all file contents to produce a deterministic SHA */
const hashFiles = (filePaths: string[]): string => {
  const hash = crypto.createHash("sha256")
  for (const fp of filePaths.sort()) {
    hash.update(fs.readFileSync(fp))
  }
  return hash.digest("hex").slice(0, 12)
}

/** Formats a byte count as a human-readable string */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Uploads game build artifacts to Puzzmo */
export const upload = async (gameSlug: string, dir: string) => {
  const token = getToken()
  if (!token) {
    console.error("Not logged in. Run `puzzmo login <token>` or set PUZZMO_TOKEN.")
    process.exit(1)
  }

  const distDir = path.resolve(dir)
  if (!fs.existsSync(distDir)) {
    console.error(`Directory not found: ${dir}`)
    process.exit(1)
  }

  const files = collectFiles(distDir)
  if (!files.length) {
    console.error(`Directory is empty: ${dir}`)
    process.exit(1)
  }

  // Determine SHA
  const sha = getGitSHA() || hashFiles(files)

  console.log(`\nUploading ${gameSlug} (${sha.slice(0, 8)})`)
  console.log(`Directory: ${distDir}`)
  console.log("")

  let totalBytes = 0
  for (const file of files) {
    const size = fs.statSync(file).size
    totalBytes += size
    const rel = path.relative(distDir, file)
    console.log(`  ${rel} (${formatBytes(size)})`)
  }

  const apiURL = getAPIURL()
  const defaultURL = "https://api.puzzmo.com"

  console.log(`\n${files.length} file(s), ${formatBytes(totalBytes)} total`)
  if (apiURL !== defaultURL) console.log(`Uploading to ${apiURL}...`)
  else console.log("Uploading...")

  const result = await uploadFiles(token, gameSlug, sha, files, distDir, (batch, totalBatches, uploaded) => {
    console.log(`  Batch ${batch}/${totalBatches} done (${uploaded} file(s) uploaded)`)
  })

  console.log(`\nDone - ${result.versionID}`)
  console.log(`CDN: ${result.cdnBase}`)
}
