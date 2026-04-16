---
name: puzzmo-theme
description: Convert hardcoded colors to use Puzzmo theme tokens for light/dark mode support
---

# Puzzmo Theme

Convert the game's colors to use Puzzmo theme tokens, enabling automatic light/dark mode.

## Steps

1. Review the theme object received from `sdk.gameReady()`.

   You should be replacing every statically assigned (#XXXXXX) color with a color dynamically linked from the puzzmo theme.
   Here is your guide to choosing the right theme color, based on how colors are actually used across all Puzzmo games.
   
   Here is the general rule of thumb for picking colors aside from black/white: Puzzmo has 5 colors that come from the theme that should be used for all colored game elements, with this priority: `g_key`, `player`, `alt1`, `alt2`, `alt3`. If you need more colors, perform a hue shift on one of those to find a color that's differentiated.
   
   Primarily, these are the 5 colors you should be using for every colorful element in the game. All Puzzmo games are designed to never use a color semantically, like for example, red for error. That may not be the case with the game that you are being brought in to reassign colors for. It may be appropriate for you to ask the user if a particular color should be replaced with a theme color or if it should remain statically defined if it seems like that color may be being used to convey semantic information.
   
   If you need UI colors like black and white for frame elements, or need more nuance to determine what to do, there is additional detail provided below:
   
   ## Backgrounds
   
   - **`g_bg`** — Default tile/cell background. The "paper" your game is drawn on. Use for the primary interactive surface.
   - **`g_bgAlt`** — Alternating tile background for visual rhythm. Use when you have a grid and need to distinguish adjacent cells (checkerboards, alternating rows).
   - **`g_bgDark`** — A darker surface for layering or inset areas. Use for card backs, recessed panels, or secondary content areas that need visual separation from `g_bg`.
   - **`g_blank`** — True void/empty. Use for cells that don't exist or are permanently empty (not the same as unsolved).
   - **`a_bg`** — UI container background (modals, settings panels, taken-piece trays). Use for chrome around the game, not the game board itself.
   - **`a_bgAlt`** — Subtle border/divider accent in UI areas. Use for outlines or secondary containers adjacent to `a_bg`.
   
   ## Text & Foreground
   
   - **`fg`** — Primary text and stroke color. Your default for letters, labels, borders, and any drawn elements. This is the workhorse.
   - **`g_textDark`** — Text guaranteed readable on light backgrounds. Use when you have a tile/element whose background varies by theme and you need dark-on-light contrast specifically.
   - **`g_textLight`** — Text guaranteed readable on dark backgrounds. The inverse of `g_textDark`. Use for text overlaid on `g_bgDark`, `alwaysDark`, or other dark surfaces.
   - **`g_outline`** — Board/frame border. Use for the outer boundary of the game area or structural outlines. Not for individual tile borders (use `fg` with opacity for that).
   
   ## Accent & Brand
   
   - **`g_key`** — Primary game accent. Use for the single most important interactive or informational highlight: hint indicators, special tile types, "found word" feedback. One meaning per game.
   - **`keyStrong`** — Bold/emphasized accent. Use when `g_key` needs extra punch: completed answers, check warnings, speech bubbles, active annotations.
   - **`keyLight`** — Muted accent for secondary UI. Use for softer accents near key-colored elements — button borders, subtle highlights.
   
   ## Player & Interaction
   
   - **`player`** — Player action color. Use for the thing the player is currently doing: selected tiles, move highlights, cursor position, active button backgrounds, progress indicators. This is the "you are here" color.
   - **`playerFG`** — Text on player-colored backgrounds. Always pair with `player`.
   - **`playerLight`** — Softer player accent. Use for secondary effects tied to player action: sparkles, trails, hover states, area highlights around the selection.
   
   ## Additional Accents
   
   - **`alt1`**, **`alt2`**, **`alt3`** — Extra palette slots. Use when your game needs more than key + player to distinguish categories, tile types, or player states. Assign one meaning per game and document it. Most games don't use these.
   
   ## State Colors
   
   - **`g_unsolved`** — Inactive/pending/locked state. Use for tiles or elements the player hasn't reached yet. Communicates "not yet" rather than "empty."
   - **`a_puzmo`** — Victory/achievement/celebration (Puzzmo yellow). Use for win-state UI: victory borders, checkmate indicators, completed thumbnails, badges, achievement icons. The "you did it" color.
   
   ## Theme-Invariant
   
   - **`alwaysDark`** — Stays dark in every theme. Use for elements that must always be dark regardless of light/dark mode: card game piece fills (black pieces), drop shadows, structural outlines that need guaranteed contrast.
   - **`alwaysLight`** — Stays light in every theme. The inverse: white chess pieces, card face highlights, text that must stay white on a dark surface even in light mode.
   
   ## Rules of Thumb
   
   - **Opacity variants of `fg`** (e.g. `fg10`, `fg20`, `fg50`) — Use for progressive disclosure: subtle borders, draft states, speculative actions. Avoids introducing new colors for "slightly less important text."
   - **`a_puzmo` vs `g_key`** — `g_key` is mid-game feedback ("correct," "special"), `a_puzmo` is end-state celebration ("won," "perfect," "achievement").
   - **`player` vs `g_key`** — `player` marks what the user is actively touching/selecting, `g_key` marks what the game is calling attention to. Player is "your action," key is "game feedback."
   - **Card games** (Poker, Solitaire, Chess) lean heavily on `alwaysDark`/`alwaysLight` because card/piece colors must be invariant across themes.
   - **Word/tile games** lean heavily on `g_bg`/`g_bgAlt`/`fg`/`g_unsolved` because the grid is the primary surface.

2. Create a `applyTheme(theme)` function that maps theme tokens to CSS custom properties:

   ```ts
   function applyTheme(theme: Theme) {
     const root = document.documentElement
     root.style.setProperty("--game-bg", theme.g_bg)
     root.style.setProperty("--game-fg", theme.fg)
     root.style.setProperty("--game-accent", theme.key)
     root.style.setProperty("--game-player", theme.player)
     // ... map all colors the game uses
   }
   ```

3. Replace all hardcoded color values in CSS with `var(--game-*)` custom properties.

4. Wire up theme updates for live changes:

   ```ts
   sdk.on("settingsUpdate", (settings) => {
     if (settings.theme) applyTheme(settings.theme)
   })
   ```

5. The game's fonts should use Puzzmo's available fonts where appropriate:
   - `Poppins` - UI text (various weights)
   - `Zodiak` - Display/heading text
   - `Red Hat Mono` - Monospace

## Success Criteria

- The `build` script completes without errors
- Game renders correctly with both light and dark themes
- Theme changes are applied without page reload
