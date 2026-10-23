// Precompress static assets as .br and .gz so @fastify/static (with preCompressed: true)
// can serve them directly, skipping on-the-fly compression on every request.

import { createReadStream, createWriteStream } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { constants, createBrotliCompress, createGzip } from "node:zlib"

const compressibleExtensions = new Set([".js", ".css", ".html", ".svg", ".json", ".map", ".wasm", ".txt"])

export interface PrecompressDirOptions {
  distDir: string
  minSizeBytes?: number
}

/** Walks distDir and writes .br / .gz siblings next to every compressible file above minSizeBytes. */
export const precompressDir = async ({ distDir, minSizeBytes = 1024 }: PrecompressDirOptions) => {
  const start = Date.now()
  const files = await walk(distDir)
  const results = await Promise.all(files.map((file) => compressOne(file, minSizeBytes)))
  const compressed = results.filter(Boolean).length
  console.log(`Precompressed ${compressed}/${files.length} files in ${Date.now() - start}ms`)
}

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(fullPath)))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files
}

const compressOne = async (filePath: string, minSizeBytes: number) => {
  if (filePath.endsWith(".br") || filePath.endsWith(".gz")) return false
  const ext = path.extname(filePath)
  if (!compressibleExtensions.has(ext)) return false
  const stats = await stat(filePath)
  if (stats.size < minSizeBytes) return false

  await Promise.all([
    pipeline(createReadStream(filePath), createGzip({ level: 9 }), createWriteStream(`${filePath}.gz`)),
    pipeline(
      createReadStream(filePath),
      createBrotliCompress({
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 11,
          [constants.BROTLI_PARAM_SIZE_HINT]: stats.size,
        },
      }),
      createWriteStream(`${filePath}.br`),
    ),
  ])
  return true
}
