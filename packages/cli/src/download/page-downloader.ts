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

  // Find referenced assets (src, href, url())
  const assetRefs = extractAssetRefs(html)

  for (const ref of assetRefs) {
    if (downloaded.has(ref)) continue
    if (ref.startsWith("data:") || ref.startsWith("#") || ref.startsWith("javascript:")) continue

    try {
      const assetURL = new URL(ref, baseURL)
      // Only download same-origin assets
      if (assetURL.origin !== baseURL.origin) continue

      const assetPath = assetURL.pathname.replace(/^\//, "")
      if (!assetPath) continue
      const localPath = path.join(srcDir, assetPath)

      fs.mkdirSync(path.dirname(localPath), { recursive: true })

      const assetResponse = await fetchPage(assetURL.href)
      if (!assetResponse.ok) continue

      const ab = await assetResponse.arrayBuffer()
      fs.writeFileSync(localPath, new Uint8Array(ab))

      // Rewrite reference in HTML to local path
      html = html.replaceAll(ref, assetPath)
      downloaded.add(ref)
    } catch {
      // Skip assets that fail to download
    }
  }

  // Write the HTML file
  fs.writeFileSync(path.join(srcDir, "index.html"), html)

  console.log(`  Saved index.html + ${downloaded.size} asset(s) to ${path.relative(process.cwd(), srcDir)}/`)
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
