// The simulator's stand-in for Puzzmo's pmmg sandbox. The game's table capability runs in this page, not in a worker in an
// opaque-origin frame, but under the sandbox's rules, so what draws here draws at the table: a sprite is made once per
// resolution and an ID already made is never made again, SVG sprites become bitmaps in sheets with only the fonts the
// bundle names, the scene is cloned as postMessage would clone it, and Puzzmo's own validateScene checks it.
// Mirrors runtimes.ts and sandbox.ts in @puzzmo-com/pmmg-bundle-sandbox, so keep them in step.

import { thumbnailFontNames, thumbnailFontURL, type ThumbnailFontName } from "../fonts"
import { spritesIn, validateScene, type SpriteBitmap, type TableBoardRenderer } from "../tableBoard"
import type { TableBoardCapability, TableBoardScene, TableBoardSprites, TableBoardUpdate } from "../types"

/** A sprite as the simulator keeps it: the picture Puzzmo would keep, and what made it */
export type SimulatorSprite = SpriteBitmap & {
  id: string
  kind: "draw" | "svg"
  pixelsPerUnit: number
  /** The markup an SVG sprite was made from */
  svg?: string
  /** The render that made it, counting from 1 */
  render: number
}

export type PmmgRenderPhase = "render" | "sprites" | "scene"

/** What one render did, for the Pmmg tab */
export type PmmgRenderReport = {
  render: number
  update: TableBoardUpdate
  /** How long the bundle's render took, then its SVG sprites */
  renderMs: number
  spritesMs: number
  /** What the bundle returned, before Puzzmo's checks */
  raw?: unknown
  scene?: TableBoardScene
  /** The IDs this render made */
  made: string[]
  error?: { phase: PmmgRenderPhase; message: string; stack?: string }
}

export type PmmgRenderer = Omit<TableBoardRenderer, "sprite"> & {
  sprite(id: string, pixelsPerUnit: number): SimulatorSprite | undefined
  /** Every sprite made at a resolution */
  spritesAt(pixelsPerUnit: number): SimulatorSprite[]
  /** The sprite at whatever resolution it was last made, for its box in board units */
  anySprite(id: string): SimulatorSprite | undefined
  /** The resolutions sprites have been made at */
  resolutions(): number[]
  /** Things that work here but are likely wrong at the table */
  warnings: string[]
  latest: PmmgRenderReport | null
  /** Forgets every sprite, as a new table would */
  clear(): void
  /** Told after every render, failed or not */
  onRender?: (report: PmmgRenderReport) => void
}

type Box = { width: number; height: number; anchor: [number, number] }

export type SVGSpriteRequest = { id: string; box: Box; svg: string; defs: number }

/** Turns SVG sprites into bitmaps, given the defs they share and the `@font-face` rules for the bundle's fonts */
export type Rasterise = (
  svgs: SVGSpriteRequest[],
  defs: string[],
  pixelsPerUnit: number,
  fontFaces: string,
) => Promise<{ id: string; bitmap: ImageBitmap }[]>

type PmmgRendererOptions = {
  /** `@font-face` rules for the bundle's fonts as data URLs, from `loadPmmgFonts` */
  fontFaces?: string
  /** Tests swap it out, having no Image to decode SVG with */
  rasterise?: Rasterise
}

/** Runs a table capability the way Puzzmo's sandbox does, keeping every sprite and what each render did */
export const createPmmgRenderer = (table: TableBoardCapability, options: PmmgRendererOptions = {}): PmmgRenderer => {
  const rasterise = options.rasterise ?? rasteriseSVGSprites
  const fontFaces = options.fontFaces ?? ""
  const kept = new Map<number, Map<string, SimulatorSprite>>()
  // The IDs the bundle has made at each resolution, as the worker records them; forgotten after a failure, as there
  const made = new Map<number, Set<string>>()
  // A sprite made again is compared with the first once, not on every render
  const compared = new Set<string>()
  let renders = 0
  let reset = false
  // One canvas for every drawn sprite, as the worker has: resizing it clears it, and its state with it
  let canvas: OffscreenCanvas | null = null

  const warn = (message: string) => {
    if (!renderer.warnings.includes(message)) renderer.warnings.push(message)
  }

  const render = async (update: TableBoardUpdate): Promise<TableBoardScene> => {
    const ppu = update.pixelsPerUnit
    const report: PmmgRenderReport = { render: ++renders, update, renderMs: 0, spritesMs: 0, made: [] }
    renderer.latest = report
    let phase: PmmgRenderPhase = "render"
    try {
      if (reset) made.clear()
      reset = false
      const known = made.get(ppu) ?? made.set(ppu, new Set()).get(ppu)!
      const atScale = kept.get(ppu) ?? kept.set(ppu, new Map()).get(ppu)!
      // What this render asked for, so a second making in the same render is compared too
      const fresh = new Map<string, { box: Box; svg?: string }>()
      const drawn: SimulatorSprite[] = []
      const svgs: SVGSpriteRequest[] = []
      const defs: string[] = []

      const madeAgain = (id: string, box: unknown, svg?: string) => {
        const key = `${ppu}|${id}`
        const keptSprite = atScale.get(id)
        const first = fresh.get(id) ?? (keptSprite && { box: keptSprite as Box, svg: keptSprite.svg })
        if (!first || compared.has(key)) return
        compared.add(key)
        let size: Box
        try {
          size = boxOf(box)
        } catch {
          return
        }
        const sameBox =
          size.width === first.box.width &&
          size.height === first.box.height &&
          size.anchor[0] === first.box.anchor[0] &&
          size.anchor[1] === first.box.anchor[1]
        if (!sameBox) warn(`"${id}" was made again with a different box. Puzzmo keeps the first, so put what differs into the ID`)
        else if (svg !== undefined && first.svg !== undefined && svg !== first.svg)
          warn(`"${id}" was made again with different SVG. Puzzmo keeps the first, so put what differs into the ID`)
      }

      const sprites: TableBoardSprites = {
        has: (id) => known.has(id) || fresh.has(id),
        draw(id, box, paint) {
          if (sprites.has(id)) return madeAgain(id, box)
          const size = boxOf(box)
          canvas ??= new OffscreenCanvas(1, 1)
          canvas.width = Math.max(1, Math.ceil(size.width * ppu))
          canvas.height = Math.max(1, Math.ceil(size.height * ppu))
          const ctx = canvas.getContext("2d")!
          ctx.setTransform(ppu, 0, 0, ppu, 0, 0)
          paint(ctx)
          fresh.set(id, { box: size })
          drawn.push({ id, kind: "draw", bitmap: canvas.transferToImageBitmap(), ...size, pixelsPerUnit: ppu, render: report.render })
        },
        svg(id, box, svg, shared) {
          if (sprites.has(id)) return madeAgain(id, box, String(svg))
          const size = boxOf(box)
          const text = shared ? String(shared) : ""
          let index = defs.indexOf(text)
          if (index < 0) index = defs.push(text) - 1
          fresh.set(id, { box: size, svg: String(svg) })
          svgs.push({ id, box: size, svg: String(svg), defs: index })
        },
      }

      const started = performance.now()
      let raw: unknown = table.render(update, sprites)
      report.renderMs = performance.now() - started
      if (raw && typeof (raw as { then?: unknown }).then === "function")
        throw new Error("render returned a Promise. Puzzmo's sandbox doesn't wait for one, so build the scene and return it")
      for (const id of fresh.keys()) known.add(id)
      // The scene leaves the sandbox by postMessage, and anything that can't be cloned fails the render there
      try {
        raw = structuredClone(raw)
      } catch (error) {
        throw new Error(`The scene can't leave the sandbox: ${messageOf(error)}`)
      }
      report.raw = raw

      phase = "sprites"
      const spritesStarted = performance.now()
      const bitmaps = svgs.length ? await rasterise(svgs, defs, ppu, fontFaces) : []
      report.spritesMs = performance.now() - spritesStarted
      for (const { id, bitmap } of bitmaps) {
        const request = svgs.find((sprite) => sprite.id === id)!
        drawn.push({ id, kind: "svg", bitmap, ...request.box, svg: request.svg, pixelsPerUnit: ppu, render: report.render })
      }
      for (const sprite of drawn) {
        atScale.get(sprite.id)?.bitmap.close()
        atScale.set(sprite.id, sprite)
      }
      report.made = drawn.map((sprite) => sprite.id)

      phase = "scene"
      const scene = validateScene(raw)
      const missing = [...spritesIn(scene)].filter((id) => !atScale.has(id))
      if (missing.length) throw new Error(`The scene names sprites it never made: ${missing.slice(0, 5).join(", ")}`)
      report.scene = scene
      return scene
    } catch (error) {
      // As the host does: the worker's record of what it sent may not match what arrived, so the next render makes all again
      reset = true
      report.error = { phase, message: messageOf(error), stack: error instanceof Error ? error.stack : undefined }
      throw error
    } finally {
      renderer.onRender?.(report)
    }
  }

  const renderer: PmmgRenderer = {
    render,
    sprite: (id, ppu) => kept.get(ppu)?.get(id),
    spritesAt: (ppu) => [...(kept.get(ppu)?.values() ?? [])],
    anySprite: (id) => {
      let latest: SimulatorSprite | undefined
      for (const atScale of kept.values()) {
        const sprite = atScale.get(id)
        if (sprite && (!latest || sprite.render > latest.render)) latest = sprite
      }
      return latest
    },
    resolutions: () => [...kept.keys()],
    warnings: [],
    latest: null,
    clear() {
      for (const atScale of kept.values()) for (const sprite of atScale.values()) sprite.bitmap.close()
      kept.clear()
      made.clear()
      compared.clear()
      renderer.warnings.length = 0
    },
  }
  return renderer
}

/**
 * Loads the Puzzmo fonts a table capability names, as the sandbox does: into the page for drawn sprites, and as
 * `@font-face` data URLs for SVG ones, which can't reach any font outside their own markup
 */
export const loadPmmgFonts = async (names: unknown): Promise<{ fontFaces: string; warnings: string[] }> => {
  const warnings: string[] = []
  const rules: string[] = []
  const wanted = Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : []
  for (const name of wanted) {
    if (!(thumbnailFontNames as string[]).includes(name)) {
      warnings.push(`fonts names "${name}", which isn't a Puzzmo font, so the table won't load it`)
      continue
    }
    try {
      const response = await fetch(thumbnailFontURL(name as ThumbnailFontName))
      if (!response.ok) throw new Error(`the CDN answered ${response.status}`)
      const bytes = await response.arrayBuffer()
      document.fonts.add(await new FontFace(name, bytes.slice(0)).load())
      rules.push(`@font-face{font-family:"${name.replace(/["\\]/g, "")}";src:url(data:font/woff2;base64,${toBase64(bytes)})}`)
    } catch (error) {
      warnings.push(`The font ${name} didn't load: ${messageOf(error)}`)
    }
  }
  return { fontFaces: rules.join(""), warnings }
}

/** At most this many sprites in one sheet, and a sheet no wider than this, as in the sandbox's frame */
const sheetSprites = 64
const sheetWidth = 4096

/**
 * SVG sprites as bitmaps, many to one SVG sheet so each sheet decodes its fonts and shared definitions once. When a
 * sheet won't decode, each of its sprites is tried alone so the error can name the broken ones.
 */
export const rasteriseSVGSprites: Rasterise = async (svgs, defs, ppu, fontFaces) => {
  const out: { id: string; bitmap: ImageBitmap }[] = []
  // A sheet per set of shared definitions, so IDs in them can't clash
  const groups = new Map<number, SVGSpriteRequest[]>()
  for (const sprite of svgs) groups.set(sprite.defs, [...(groups.get(sprite.defs) ?? []), sprite])
  for (const [index, group] of groups) {
    for (let start = 0; start < group.length; start += sheetSprites) {
      const batch = group.slice(start, start + sheetSprites)
      try {
        out.push(...(await drawSheet(batch, defs[index], ppu, fontFaces)))
      } catch (error) {
        const broken: string[] = []
        for (const sprite of batch) await drawSheet([sprite], defs[index], ppu, fontFaces).catch(() => broken.push(sprite.id))
        const which = broken.length ? `${broken.slice(0, 5).join(", ")} won't decode` : messageOf(error)
        throw new Error(`An SVG sprite couldn't be drawn: ${which}`)
      }
    }
  }
  return out
}

const drawSheet = async (batch: SVGSpriteRequest[], shared: string, ppu: number, fontFaces: string) => {
  let x = 0
  let y = 0
  let rowHeight = 0
  let width = 1
  const placed = batch.map((sprite) => {
    const w = Math.max(1, Math.ceil(sprite.box.width * ppu))
    const h = Math.max(1, Math.ceil(sprite.box.height * ppu))
    if (x > 0 && x + w > sheetWidth) {
      x = 0
      y += rowHeight + 1
      rowHeight = 0
    }
    const at = { sprite, x, y, w, h }
    x += w + 1
    width = Math.max(width, x)
    rowHeight = Math.max(rowHeight, h)
    return at
  })
  const height = y + rowHeight
  const body = placed
    .map(
      ({ sprite, x, y, w, h }) =>
        `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${sprite.box.width} ${sprite.box.height}" preserveAspectRatio="none" overflow="hidden">${sprite.svg}</svg>`,
    )
    .join("")
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${fontFaces}</style>${shared}${body}</svg>`
  const url = URL.createObjectURL(new Blob([sheet], { type: "image/svg+xml" }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const out: { id: string; bitmap: ImageBitmap }[] = []
    for (const at of placed) out.push({ id: at.sprite.id, bitmap: await createImageBitmap(image, at.x, at.y, at.w, at.h) })
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** A sprite's box as the worker reads it: a positive size under 10,000 units, anchored at its centre unless it says */
const boxOf = (box: unknown): Box => {
  const raw = box as { width?: unknown; height?: unknown; anchor?: unknown } | undefined
  const width = Number(raw?.width)
  const height = Number(raw?.height)
  if (!(width > 0 && height > 0 && width < 10_000 && height < 10_000))
    throw new Error(`A sprite's box must have a positive width and height, got ${JSON.stringify(box)}`)
  const anchor: [number, number] = Array.isArray(raw!.anchor) ? [Number(raw!.anchor[0]), Number(raw!.anchor[1])] : [width / 2, height / 2]
  return { width, height, anchor }
}

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
