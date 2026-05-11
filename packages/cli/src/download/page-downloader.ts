import fs from "node:fs"
import path from "node:path"
import https from "node:https"
import http from "node:http"

/** Fetch that tolerates expired/self-signed SSL certificates */
const fetchPage = async (
  url: string,
): Promise<{ ok: boolean; status: number; text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> }> => {
  const parsed = new URL(url)
  const isHttps = parsed.protocol === "https:"

  return new Promise((resolve, reject) => {
    const mod = isHttps ? https : http
    const opts = isHttps ? { rejectUnauthorized: false } : {}

    const req = mod.get(url, opts, (res) => {
      const chunks: Uint8Array[] = []
      res.on("data", (chunk: Uint8Array) => chunks.push(chunk))
      res.on("end", () => {
        const buffer = Buffer.concat(chunks)
        const ab = new ArrayBuffer(buffer.byteLength)
        const view = new Uint8Array(ab)
        view.set(buffer)
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          status: res.statusCode ?? 0,
          text: async () => buffer.toString("utf-8"),
          arrayBuffer: async () => ab,
        })
      })
    })
    req.on("error", reject)
  })
}

/** Extracts the <title> from HTML */
export const extractTitle = (html: string): string | undefined => {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html)
  return match?.[1]?.trim() || undefined
}

/** Download a single asset ref, returning true if successful */
const downloadAsset = async (
  ref: string,
  baseURL: URL,
  srcDir: string,
  downloaded: Set<string>,
  content: Map<string, string>,
  optional: boolean,
): Promise<boolean> => {
  if (downloaded.has(ref)) return false
  if (ref.startsWith("data:") || ref.startsWith("#") || ref.startsWith("javascript:")) return false

  try {
    const assetURL = new URL(ref, baseURL)
    // Only download same-origin assets
    if (assetURL.origin !== baseURL.origin) return false

    const assetPath = assetURL.pathname.replace(/^\//, "")
    if (!assetPath) return false
    const localPath = path.join(srcDir, assetPath)

    fs.mkdirSync(path.dirname(localPath), { recursive: true })

    const assetResponse = await fetchPage(assetURL.href)
    if (!assetResponse.ok) {
      if (optional) console.warn(`  Warning: could not download optional asset ${ref} (${assetResponse.status})`)
      return false
    }

    const ab = await assetResponse.arrayBuffer()
    fs.writeFileSync(localPath, new Uint8Array(ab))

    // Cache text content for JS/CSS so we can scan them for more refs
    if (/\.(js|css|mjs)(\?.*)?$/i.test(assetPath)) {
      content.set(ref, Buffer.from(ab).toString("utf-8"))
    }

    downloaded.add(ref)
    return true
  } catch {
    if (optional) console.warn(`  Warning: failed to download optional asset ${ref}`)
    return false
  }
}

/** Downloads an HTML page and its referenced assets into a src/ directory */
export const downloadPage = async (url: string, outputDir: string): Promise<{ title?: string }> => {
  const srcDir = path.join(outputDir, "src")
  fs.mkdirSync(srcDir, { recursive: true })

  // Download the HTML
  const response = await fetchPage(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  let html = await response.text()

  const baseURL = new URL(url)
  const downloaded = new Set<string>()
  const assetContent = new Map<string, string>()

  // Find referenced assets (src, href, url())
  const assetRefs = extractAssetRefs(html)

  for (const ref of assetRefs) {
    const ok = await downloadAsset(ref, baseURL, srcDir, downloaded, assetContent, false)
    if (ok) html = html.replaceAll(ref, new URL(ref, baseURL).pathname.replace(/^\//, ""))
  }

  // Second pass: scan downloaded JS/CSS files for string literals referencing
  // paths with known asset extensions (images, fonts, audio, video).
  // These are optional — the game may still work without them.
  const jsAssetRefs = new Set<string>()
  for (const [, text] of assetContent) {
    for (const ref of extractAssetFileRefs(text)) {
      if (!downloaded.has(ref)) jsAssetRefs.add(ref)
    }
  }

  if (jsAssetRefs.size > 0) {
    console.log(`  Found ${jsAssetRefs.size} additional asset reference${jsAssetRefs.size === 1 ? "" : "s"} in JS/CSS files`)
    for (const ref of jsAssetRefs) {
      await downloadAsset(ref, baseURL, srcDir, downloaded, assetContent, true)
    }
  }

  // Write the HTML file
  fs.writeFileSync(path.join(srcDir, "index.html"), html)

  const assetMsg = downloaded.size === 0 ? "no other assets" : `${downloaded.size} asset${downloaded.size === 1 ? "" : "s"}`
  console.log(`  Saved index.html + ${assetMsg} to ${path.relative(process.cwd(), srcDir)}/`)
  return { title: extractTitle(html) }
}

/** Extracts asset references from HTML using regex */
const extractAssetRefs = (html: string): string[] => {
  const refs: string[] = []

  // src="..." and href="..."
  const attrRegex = /(?:src|href)=["']([^"']+)["']/gi
  let match
  while ((match = attrRegex.exec(html)) !== null) {
    if (match[1]) refs.push(match[1])
  }

  // url("...") in CSS
  const urlRegex = /url\(["']?([^"')]+)["']?\)/gi
  while ((match = urlRegex.exec(html)) !== null) {
    if (match[1]) refs.push(match[1])
  }

  return [...new Set(refs)]
}

/** Known asset file extensions to look for in JS/CSS string literals */
const assetExtensions = "webp|png|jpe?g|gif|svg|ico|mp3|ogg|wav|mp4|webm|woff2?|ttf|eot"

/** Extracts paths with known asset extensions from JS/CSS string literals */
const extractAssetFileRefs = (source: string): string[] => {
  const refs: string[] = []

  const regex = new RegExp(`["'\`](/[^"'\`\\s]*\\.(?:${assetExtensions}))(?:\\?[^"'\`\\s]*)?["'\`]`, "gi")
  let match
  while ((match = regex.exec(source)) !== null) {
    if (match[1]) refs.push(match[1])
  }
  return [...new Set(refs)]
}
