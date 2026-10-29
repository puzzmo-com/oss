import { fontFiles } from "./fontFiles.gen"

// The subset fonts are the exact content-hashed woff2 files puzzmo.com's own pages load (served
// immutable, with `Access-Control-Allow-Origin: *` so sandboxed/cross-origin consumers like the
// thumbnail iframe's opaque origin can fetch them) — so on puzzmo.com a thumbnail's font is
// usually already in the browser cache. NotoSansSymbols2 has no subset and stays on the CDN,
// which also sends `Access-Control-Allow-Origin: *`.
const fontFullBase = "https://cdn.puzzmo.com/assets/fonts"

/**
 * Maps PostScript-style font names used in thumbnail SVGs to their font URLs.
 * Uses subset fonts where available for smaller payloads.
 */
const fontURLMap = {
  "Poppins-Regular": fontFiles["Poppins-Regular-subset"],
  "Poppins-Bold": fontFiles["Poppins-Bold-subset"],
  "Poppins-BoldItalic": fontFiles["Poppins-BoldItalic-subset"],
  "Poppins-Medium": fontFiles["Poppins-Medium-subset"],
  "Poppins-SemiBold": fontFiles["Poppins-SemiBold-subset"],
  "Poppins-ExtraLight": fontFiles["Poppins-ExtraLight-subset"],
  "Poppins-Light": fontFiles["Poppins-Light-subset"],
  "RedHatMono-Bold": fontFiles["RedHatMono-Bold-subset"],
  "RedHatMono-Regular": fontFiles["RedHatMono-Regular-subset"],
  "Dongle-Regular": fontFiles["Dongle-Regular-subset"],
  "Rubik-Light": fontFiles["Rubik-Light-subset"],
  "Rubik-Regular": fontFiles["Rubik-Regular-subset"],
  "NotoSansSymbols2-Regular": `${fontFullBase}/NotoSansSymbols2-Regular.ttf`,
} as const satisfies Record<string, string>

export type ThumbnailFontName = keyof typeof fontURLMap

/** Every font the SDK can serve to thumbnails. Pass to `svgFontFaceCSS`/`svgFontFaceCSSRaw` to declare them all. */
export const thumbnailFontNames = Object.keys(fontURLMap) as ThumbnailFontName[]

/** Generates an SVG `<style>` block with `@font-face` declarations for the given font names. */
export function svgFontFaceCSS(fontNames: ThumbnailFontName[]): string {
  return `<style>${fontFaceRules(fontNames)}</style>`
}

/** Returns raw `@font-face` CSS for use inside a JSX `<style>` element. */
export function svgFontFaceCSSRaw(fontNames: ThumbnailFontName[]): string {
  return fontFaceRules(fontNames)
}

function fontFaceRules(fontNames: ThumbnailFontName[]): string {
  return fontNames
    .map((name) => {
      const url = fontURLMap[name]
      return `@font-face { font-family: "${name}"; src: url("${url}"); font-display: swap; }`
    })
    .filter(Boolean)
    .join("\n")
}
