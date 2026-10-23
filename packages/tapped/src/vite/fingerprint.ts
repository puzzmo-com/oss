// Fingerprints build outputs that some Vite plugins emit outside Vite's asset pipeline.
// Example: vite-plugin-monaco-editor and @stylexswc/unplugin both emit a static filename
// and inject a hardcoded URL into index.html, so their outputs miss Vite's fingerprinting
// and can't be cached immutably. For each configured file: hash the content, move it into
// <distDir>/<destPrefix>/ with the hash injected before the extension, and patch the URL
// in index.html. Relocating into /assets/ (via the default destPrefix) reuses the existing
// directory-based cache policy without needing filename pattern matching.

import { createHash } from "node:crypto"
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

export interface FingerprintStaticAssetsOptions {
  distDir: string
  /** Relative paths within distDir to fingerprint. */
  targets: string[]
  /** Where fingerprinted outputs land. Defaults to "assets/external". */
  destPrefix?: string
  /** Defaults to <distDir>/index.html. */
  indexHtmlPath?: string
}

/** Fingerprints each target, relocates it under destPrefix, and patches its URL in index.html. */
export const fingerprintStaticAssets = async ({
  distDir,
  targets,
  destPrefix = "assets/external",
  indexHtmlPath,
}: FingerprintStaticAssetsOptions) => {
  const indexHtml = indexHtmlPath ?? path.join(distDir, "index.html")
  let html = await readFile(indexHtml, "utf-8")

  for (const rel of targets) {
    const srcPath = path.join(distDir, rel)
    const contents = await readFile(srcPath)
    const hash = createHash("sha256").update(contents).digest("base64url").slice(0, 8)

    const destRel = path.posix.join(destPrefix, insertHash(rel, hash))
    const destPath = path.join(distDir, destRel)
    // fs.rename silently overwrites — turn that into a loud build failure.
    try {
      await access(destPath)
      throw new Error(`Destination ${destRel} already exists — collision with another build output`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    }
    await mkdir(path.dirname(destPath), { recursive: true })
    await rename(srcPath, destPath)

    const oldURL = `/${rel}`
    const newURL = `/${destRel}`
    const patched = html.split(oldURL).join(newURL)
    if (patched === html) {
      throw new Error(`Could not find ${oldURL} in ${indexHtml} — build output may have changed`)
    }
    html = patched
    console.log(`Fingerprinted ${rel} -> ${destRel}`)
  }

  await writeFile(indexHtml, html)
}

const insertHash = (rel: string, hash: string) => {
  const ext = path.extname(rel)
  const base = rel.slice(0, -ext.length)
  return `${base}-${hash}${ext}`
}
