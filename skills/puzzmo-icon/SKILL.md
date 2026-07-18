---
name: puzzmo-icon
description: Use this skill when the user wants to "design a Puzzmo icon", "make a game icon", "create an SVG icon for Puzzmo", or asks for help producing an icon that meets the dev.puzzmo.com Icon modal requirements.
---

# Puzzmo Game Icon

A Puzzmo game icon is a **two-color SVG** stored at 28×28 and **recolored at runtime** for every surface it appears on. There is no opportunity for shading, gradients, or accent colors — only foreground (`#000000`) and background (`#FFFFFF`) are allowed, and both get swapped per surface. Design accordingly.

The canonical UI is the Icon modal in the dev.puzzmo.com developer portal (where you paste or upload the SVG for your game); the server re-validates every uploaded SVG before accepting it, so the rules below are enforced regardless of what the modal shows.

## Hard rules (server-validated)

The server will **reject** any SVG that fails these. Self-check before delivering:

1. **Under 8,000 characters total.** Optimize with SVGO or hand-trim if needed.
2. **Has `width="N"` and `height="N"` attributes, with quotes** (regex `width="(\d+)"`). `width='28'` (single quotes) or no width at all → rejected. Author at 28×28; the endpoint resizes on request.
3. **Contains `#000000`** somewhere (this is the foreground sentinel).
4. **Contains `#FFFFFF`** somewhere (this is the background sentinel).
5. **No other colors.** Not `#000`, not `black`, not `rgb(0,0,0)`, not `#0a0a0a`. Exactly `#000000` and `#FFFFFF` only — hex must be 6-digit uppercase. The validator scans for `#[0-9a-fA-F]{3,8}` and rejects anything else.
6. **SVG-safe markup.** The server runs DOMPurify with the SVG + SVG-filters profiles. Avoid `<script>`, event handlers (`onload=`), external references, foreign objects.

The modal includes "white → #FFFFFF" and "black → #000000" helper buttons because authors paste shorthand by mistake. Output the full 6-digit uppercase hex from the start.

## Design rules (not server-enforced but matter)

- **The two colors are not "black on white."** At render time they get substituted into whatever palette the surface needs — dark slate on cream, teal on dark teal, the game's brand color on white, etc. Treat `#000000` as "ink" and `#FFFFFF` as "paper." If your icon only makes sense as a black silhouette on white, it will look wrong inverted on the dark variants.
- **Designed for 28×28.** Most surfaces render small. Two-pixel detail will mush. Strokes should be ≥2 units at the 28-unit canvas; tight letterforms or thin diagonals will lose legibility.
- **Recognizable at a glance.** It appears alongside the game's name in lists and cards; it's an identity mark, not an illustration.
- **No text** unless the text _is_ the mark (e.g. a single letter, a number). Multi-letter text at 28px is unreadable.
- **No background fill.** Do not paint a `#FFFFFF` rectangle (or any other shape) across the whole canvas behind the icon. Surfaces supply their own background — adding one inside the SVG creates a visible card-within-a-card on every variant, and on the dark variants it becomes a bright rectangular slab that swallows the design. The server still requires the string `#FFFFFF` to appear, so `#FFFFFF` must be used for **silhouette mass** (the body of a recognizable shape, like `circuits`'s lightning bolt or `really-bad-chess`'s pawn) or **inner detail/cutout** (negative space carved into a black mass, like `typeshift`'s bracket interiors). Never as a back-card.
- **Negative space is the frame.** Leave the corners of the 28×28 canvas empty. The surface's color shows through and provides the visual padding.

## Visual style (from existing icons)

Patterns observed across the live public icons. Fetch a few via the gameIcon endpoint and read the SVG source to see these directly.

**Stroke widths are thick.** On the 28-unit canvas, strokes are consistently in the **2.5–2.82** range — roughly 1/10th of the canvas width. Concrete examples: crossword `2.5`, flip-art `2.5`, wordbind `2.5`, spelltower `2.818`. Anything thinner than 2 mushes at 20–28px render sizes.

**Standard opener.** Nearly every icon uses the same root:

```svg
<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
```

Note `fill="none"` on the root — fills are set explicitly per shape, never inherited.

**Two-color construction without a backdrop.** The icon is built from independent `#000000` and `#FFFFFF` shapes — but `#FFFFFF` is never a full-canvas backdrop. Use one of these two patterns:

- **Silhouette mass.** The icon's body is a single `#FFFFFF` shape (the recognizable silhouette), often outlined or detailed with `#000000` strokes/paths on top. Example: `circuits` — a `#FFFFFF` lightning-bolt path is the whole icon, with a `#000000` path drawing its interior detail.
- **Cutout / inverted detail.** A `#000000` shape forms the mass and `#FFFFFF` shapes are punched out of it as inner detail. Example: `typeshift` — black bracket forms with white letterforms cut out inside them.

Heads-up: some older public icons (`crossword`, `flip-art`, `bongo`, `wordbind`) do use a full-canvas white rect underneath. They predate this guidance. Read them for visual vocabulary (stroke weights, letterforms), but don't copy the layout pattern for new icons.

**Chunky geometric vocabulary.** Squares, rectangles, straight strokes, sharp corners dominate (crossword, flip-art, wordbind, spelltower, bongo). When organic curves appear (`really-bad-chess` pawn, `circuits` lightning bolt), the shape reads as a single recognizable silhouette mass, not as fine line work.

**Letterforms are blocky.** Where letters appear (`bongo` "Bb", `typeshift` "T", `memoku` "M"), they're heavy sans-serif rendered as filled paths — never thin, never scripty. Letter strokes are roughly as thick as the icon's outline strokes.

**Bleeding off the edge is intentional.** `typeshift` draws triangular notches at coordinates like `M6.5 0` and `M16.5 28` — outside the 28×28 viewBox — to create dynamism. Use sparingly; only for icons whose silhouette benefits from breaking the frame.

### Minimal valid template

A bare-bones icon that passes every server rule, uses both required colors, and has **no background fill** — the corners stay transparent so the surface shows through:

```svg
<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="14" cy="14" r="11" fill="#000000" />
  <circle cx="14" cy="14" r="4" fill="#FFFFFF" />
</svg>
```

A black ring (donut) with a white inner cutout. `#000000` is the silhouette mass; `#FFFFFF` is inner detail; nothing fills the canvas behind it. Replace the two circles with whatever the game's mark is — keep the principle of "mass + cutout, no backdrop."

## Render-target preview palette

Every saved icon is shown across these surfaces in the modal preview. Before delivering, picture (or generate data-URL previews of) your SVG under each — if any one looks broken, reconsider.

| Variant        | fg        | bg                      |
| -------------- | --------- | ----------------------- |
| On light       | `#1B1B28` | `#FFFFFF`               |
| On dark        | `#374351` | `#ECECEC`               |
| Orange/Cream   | `#FF6B35` | `#F7F5E6`               |
| Blue/Light     | `#2563EB` | `#EFF6FF`               |
| Green/Dark     | `#22C55E` | `#14532D`               |
| Purple/Light   | `#7C3AED` | `#F3E8FF`               |
| On Gray        | `#1F2937` | `#E5E7EB`               |
| Dark Slate     | `#E2E8F0` | `#1E293B`               |
| Dark Purple    | `#C4B5FD` | `#4C1D95`               |
| Dark Teal      | `#5EEAD4` | `#134E4A`               |
| Dark Orange    | `#FDBA74` | `#7C2D12`               |
| Brand (if set) | `#000000` | game's `highlightColor` |

The substitution is a literal string replace: every `#000000` becomes the fg, every `#FFFFFF` becomes the bg. Nothing else is touched.

## Reference: existing public games

Fetch any of these to compare against. The endpoint returns the raw SVG; pass `size`, `fg`, `bg` to render at a specific surface.

```
https://api.puzzmo.com/gameIcon?slug={slug}&size=128
https://api.puzzmo.com/gameIcon?slug={slug}&size=128&fg=1B1B28&bg=FFFFFF
https://api.puzzmo.com/gameIcon?slug={slug}&size=128&fg=E2E8F0&bg=1E293B
```

Public game slugs:

**Core (stable):** `crossword`, `spelltower`, `really-bad-chess`, `typeshift`, `flip-art`, `bongo`, `weather-memoku`, `memoku`, `circuits`, `wordbind`, `cubeclear`, `missing-link`, `pile-up-poker`, `pile-up-poker-pro`, `ribbit`

Game pages live at `https://puzzmo.com/game/{slug}` if you want to see the icon in context.

When designing a new icon, **fetch 4-6 existing ones first** to study the visual language (chunky shapes, clear silhouettes, mostly geometric, occasional letterforms). Pick ones in the same genre as the new game.

## Recommended workflow

1. **Understand the game.** What's the gameplay verb? What's the visual hook (a grid? a letter? a piece shape?)? Get this from the user.
2. **Study 4-6 references** via the gameIcon endpoint, picked from games closest in genre. Look at the _fetched SVG source_, not just the rendered image — note path counts, viewBox conventions, stroke widths.
3. **Draft the SVG.** 28×28 viewBox, `width="28" height="28"`, all paths in `#000000`, background rect (if used) in `#FFFFFF`. Keep it under ~3KB to leave room.
4. **Run the rule checklist** (the 6 hard rules above). The most common failures are: shorthand hex (`#000` instead of `#000000`), missing width/height, accidental third color from a pasted gradient.
5. **Mentally render against the 12 surface variants.** If the icon relies on the fg being darker than the bg (or vice versa), it breaks on the inverted ones. Two-color silhouettes that read either way are the safe pattern.
6. **Deliver the SVG as a fenced code block** so the user can paste it into the Icon modal's "Paste SVG text" field. Don't deliver a file path — the modal accepts pasted text.

## Common failure modes

- "It looks fine on white but disappears on dark." → fg/bg roles are reversible; design for both directions.
- "Server says 'colors other than #000000 and #FFFFFF'." → search the SVG for any `#` that isn't one of those two. Common culprits: `fill="none"` is fine, but `stroke="#FFF"` is rejected (shorthand). Inline `style="fill:#000"` is also rejected.
- "Server says 'must have width attribute with quotes'." → ensure `width="28"`, not `width=28` or `width='28'`.
- "Too detailed at 28px." → the modal previews at 56×56 which can hide this. Imagine it inline in a list at 20px.

## References

- Upload/preview UI: the Icon modal in the dev.puzzmo.com developer portal.
- Recolor endpoint: `https://api.puzzmo.com/gameIcon` (accepts `slug`, `size`, `fg`, `bg`).
- Game pages: `https://puzzmo.com/game/{slug}`.
