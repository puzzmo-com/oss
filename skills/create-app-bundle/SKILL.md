---
name: create-app-bundle
description: Create app metadata, thumbnail, and offline configuration for the Puzzmo platform
---

# Create App Bundle

Set up the metadata and assets needed for the game to appear on Puzzmo.

## Steps

1. Create a `public/` directory for static assets if it doesn't exist.

2. Add the `appBundlePlugin` to `vite.config.ts`:

   ```ts
   import { defineConfig } from "vite"
   import { puzzmoSimulator, appBundlePlugin } from "@puzzmo/sdk/vite"

   export default defineConfig({
     plugins: [puzzmoSimulator({ slug: "your-game-slug", fixturesGlob: "/fixtures/puzzles/**/*.json" }), appBundlePlugin()],
     build: {
       outDir: "dist",
       assetsDir: "assets",
     },
   })
   ```

   The `appBundlePlugin` runs after the main build and produces `dist/app-bundle.js` as a separate ES module library build from `src/appBundle.js`.

3. Create `src/appBundle.js` (or `src/appBundle.ts`) that exports the `renderThumbnail` function:

```ts
export type AppBundle = {
  /** Renders a puzzle and optional state string into an SVG  */
  renderThumbnail(puzzleStr: string, inputStr?: string, config?: ThumbnailConfig): string
}
```

You can find the `ThumbnailConfig` type definition in `@puzzmo-com/sdk/types`.

The function should return an SVG string that visually represents the puzzle. You could use code from the original game but the goal is a drastically simplified rendering that captures the essence of the puzzle in a small thumbnail. The thumbnail will be used on the Puzzmo platform to represent the puzzle in lists and previews.

4. Verify the build output has:
   - `dist/index.html`
   - All JS/CSS properly bundled
   - All static assets in `dist/`
   - `dist/app-bundle.js` with the `renderThumbnail` export

## Success Criteria

- `npm run build` completes without errors
- `dist/` directory contains a complete, self-contained game
- Thumbnail SVG exists and renders
