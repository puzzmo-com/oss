import path from "node:path"
import type { Plugin, UserConfig } from "vite"

import { fingerprintStaticAssets } from "./fingerprint.ts"
import { precompressDir } from "./precompress.ts"

export interface TappedPluginOptions {
  /**
   * Plugin outputs that escape Vite's pipeline and need post-build fingerprinting.
   * Hashed and relocated under /assets/external/ in the client dist.
   */
  fingerprintTargets?: string[]
  /** Emit .br/.gz siblings next to compressible client assets so @fastify/static can serve them directly. Defaults to false. */
  precompress?: boolean
  /** Page/query chunk splitter — splits files matching /pages/...Page and /queries/...Query into their own chunks. Defaults to true. */
  pageChunking?: boolean
}

/**
 * Bundles the Vite config a Tapped SSR app needs: bundler externals + optimizeDeps
 * exclusions for the SSR-only module, page/query chunk splitting, and opt-in post-build
 * fingerprinting and precompression.
 */
export const tapped = (options: TappedPluginOptions = {}): Plugin[] => {
  const { fingerprintTargets = [], precompress = false, pageChunking = true } = options

  let isSSRBuild = false
  let distDir = ""

  const configPlugin: Plugin = {
    name: "@puzzmo/tapped:config",
    config(): UserConfig {
      return {
        clearScreen: false,
        build: {
          rolldownOptions: {
            external: ["fsevents", /^node:/, /packages\/tapped\/src\/server/],
            output: pageChunking ? { manualChunks: pageQueryChunks } : undefined,
          },
        },
        optimizeDeps: {
          exclude: ["@puzzmo/tapped/src/server"],
        },
      }
    },
  }

  const buildPlugin: Plugin = {
    name: "@puzzmo/tapped:build",
    apply: "build",
    enforce: "post",
    configResolved(resolved) {
      isSSRBuild = !!resolved.build.ssr
      distDir = path.resolve(resolved.root, resolved.build.outDir)
    },
    async closeBundle() {
      if (isSSRBuild) return
      if (fingerprintTargets.length > 0) {
        await fingerprintStaticAssets({ distDir, targets: fingerprintTargets })
      }
      if (precompress) {
        await precompressDir({ distDir })
      }
    },
  }

  return [configPlugin, buildPlugin]
}

const pageQueryChunks = (id: string): string | undefined => {
  if (id.includes("/pages/") && id.includes("Page")) {
    return `page-${id.split("/pages/")[1].split(".")[0]}`
  }
  if (id.includes("/queries/") && id.includes("Query")) {
    return `query-${id.split("/queries/")[1].split(".")[0]}`
  }
}

export { fingerprintStaticAssets, precompressDir }
export type { FingerprintStaticAssetsOptions } from "./fingerprint.ts"
export type { PrecompressDirOptions } from "./precompress.ts"
