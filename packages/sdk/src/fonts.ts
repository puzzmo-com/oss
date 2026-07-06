// Serve fonts straight from the CDN, which sends `Access-Control-Allow-Origin: *`. www.puzzmo.com
// 308-redirects these to Azure blob storage, and that redirect response carries no CORS header — so a
// cross-origin/sandboxed consumer (e.g. the thumbnail iframe's opaque origin) is blocked at the redirect.
const fontSubsetBase = "https://cdn.puzzmo.com/assets/fonts-subset"
const fontFullBase = "https://cdn.puzzmo.com/assets/fonts"

/**
 * Maps PostScript-style font names used in thumbnail SVGs to their font URLs.
 * Uses subset fonts where available for smaller payloads.
 */
const fontURLMap = {
  "Poppins-Regular": `${fontSubsetBase}/Poppins-Regular-subset.ttf`,
  "Poppins-Bold": `${fontSubsetBase}/Poppins-Bold-subset.ttf`,
  "Poppins-BoldItalic": `${fontSubsetBase}/Poppins-BoldItalic-subset.ttf`,
  "Poppins-Medium": `${fontSubsetBase}/Poppins-Medium-subset.ttf`,
  "Poppins-SemiBold": `${fontSubsetBase}/Poppins-SemiBold-subset.ttf`,
  "Poppins-ExtraLight": `${fontSubsetBase}/Poppins-ExtraLight-subset.ttf`,
  "Poppins-Light": `${fontSubsetBase}/Poppins-Light-subset.ttf`,
  "RedHatMono-Bold": `${fontSubsetBase}/RedHatMono-Bold-subset.ttf`,
  "RedHatMono-Regular": `${fontSubsetBase}/RedHatMono-Regular-subset.ttf`,
  "Dongle-Regular": `${fontSubsetBase}/Dongle-Regular-subset.ttf`,
  "Rubik-Light": `${fontSubsetBase}/Rubik-Light-subset.ttf`,
  "Rubik-Regular": `${fontSubsetBase}/Rubik-Regular-subset.ttf`,
  "NotoSansSymbols2-Regular": `${fontFullBase}/NotoSansSymbols2-Regular.ttf`,
} as const satisfies Record<string, string>

export type ThumbnailFontName = keyof typeof fontURLMap

/** Every font the SDK can serve to thumbnails. Pass to `svgFontFaceCSS`/`svgFontFaceCSSRaw` to declare them all. */
export const thumbnailFontNames = Object.keys(fontURLMap) as ThumbnailFontName[]

function fontFaceRules(fontNames: ThumbnailFontName[]): string {
  return fontNames
    .map((name) => {
      const url = fontURLMap[name]
      return `@font-face { font-family: "${name}"; src: url("${url}"); }`
    })
    .filter(Boolean)
    .join("\n")
}

/** Generates an SVG `<style>` block with `@font-face` declarations for the given font names. */
export function svgFontFaceCSS(fontNames: ThumbnailFontName[]): string {
  return `<style>${fontFaceRules(fontNames)}</style>`
}

/** Returns raw `@font-face` CSS for use inside a JSX `<style>` element. */
export function svgFontFaceCSSRaw(fontNames: ThumbnailFontName[]): string {
  return fontFaceRules(fontNames)
}
