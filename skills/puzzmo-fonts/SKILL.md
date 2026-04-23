---
name: puzzmo-fonts
description: Set up Puzzmo platform fonts in a game using the SDK font utilities
---

# Use Puzzmo Fonts

Configure the game to use Puzzmo's font stack. These are ASCII-subset fonts optimized for small payloads -- they may not contain all characters, so always provide fallbacks.

## Available Font Families

| Family             | Weights                                                        | Use Case                                                 |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------- |
| **Poppins**        | ExtraLight, Light, Regular, Medium, SemiBold, Bold, BoldItalic | Primary UI text -- labels, buttons, modals, tile letters |
| **Red Hat Mono**   | Regular, Bold                                                  | Monospace -- timers, scores, coordinate labels           |
| **Zodiak**         | Light, Regular, Bold, Extrabold, Black (+ italics)             | Display/heading text -- titles, large decorative type    |
| **Dongle**         | Light, Regular, Bold                                           | Playful/casual display text                              |
| **Rubik**          | Light, Regular                                                 | Geometric sans-serif alternative                         |
| **League Spartan** | Variable (200-800), Bold                                       | Compact headings and UI labels                           |
| **Cody Star**      | Regular                                                        | Decorative/star-outline display                          |

## Steps

1. **Choose fonts for the game.** Most games use Poppins as the base and pick one or two others for variety. Common combos:
   - Word/tile games: `Poppins-SemiBold` for tiles, `RedHatMono-Bold` for scores
   - Display-heavy games: `Zodiak-Bold` for headings, `Poppins-Regular` for body

2. **Load fonts via CSS.** Create or update a fonts stylesheet that declares `@font-face` rules pointing at the Puzzmo CDN subset URLs:

   ```css
   @font-face {
     font-family: "Poppins-SemiBold";
     src: url("https://www.puzzmo.com/assets/fonts-subset/Poppins-SemiBold-subset.ttf");
     font-display: swap;
   }

   @font-face {
     font-family: "RedHatMono-Bold";
     src: url("https://www.puzzmo.com/assets/fonts-subset/RedHatMono-Bold-subset.ttf");
     font-display: swap;
   }
   ```

   Include this stylesheet in your `index.html` or import it from your entry point.

3. **Apply fonts in game styles.** Always include system fallbacks since the subset fonts only cover ASCII:

   ```css
   .game-root {
     font-family: "Poppins-SemiBold", system-ui, sans-serif;
   }

   .score {
     font-family: "RedHatMono-Bold", ui-monospace, monospace;
   }
   ```

4. **For SVG thumbnails**, use the SDK's font utilities in your `appBundle.ts` to embed fonts directly in the SVG:

   ```ts
   import { svgFontFaceCSSRaw } from "@puzzmo/sdk/fonts"

   export function renderThumbnail(puzzle: string): string {
     return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
       <style>${svgFontFaceCSSRaw(["Poppins-SemiBold", "RedHatMono-Bold"])}</style>
       <!-- thumbnail content -->
     </svg>`
   }
   ```

   Available font names for `svgFontFaceCSSRaw`: `Poppins-Regular`, `Poppins-Bold`, `Poppins-BoldItalic`, `Poppins-Medium`, `Poppins-SemiBold`, `Poppins-ExtraLight`, `Poppins-Light`, `RedHatMono-Bold`, `RedHatMono-Regular`, `Dongle-Regular`, `Rubik-Light`, `Rubik-Regular`, `NotoSansSymbols2-Regular`.

## Important Notes

- These are **ASCII subset** fonts. Characters outside the basic Latin range will fall through to the fallback font. Do not rely on them for extended Unicode, accented characters, or symbols.
- `NotoSansSymbols2-Regular` is the only full (non-subset) font -- use it when you need symbol glyphs.
- Use `font-display: swap` so the game remains interactive while fonts load.
- Per-game font choice is a style decision. Pick fonts that match the game's personality and keep the set small for fast loading.

## Success Criteria

- Font `@font-face` declarations load without network errors
- Game text renders with the chosen Puzzmo fonts
- SVG thumbnails embed fonts correctly via `svgFontFaceCSSRaw`
- System fallbacks are specified for all `font-family` declarations
