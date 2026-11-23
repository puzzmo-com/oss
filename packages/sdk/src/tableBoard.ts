// A neighbour's board drawn from its game's pmmg bundle (see TableBoardCapability). The bundle turns each update into a
// scene of keyed nodes and makes the sprites they show, in its sandbox; this draws scenes on a canvas and does all the
// animating: a node that changes moves from its old values to its new ones, new nodes enter, gone ones exit, and
// effects play over the top. Every board at the table draws from one animation loop, only while one moves. It's in the
// SDK so puzzmo.com's table and the simulator's Pmmg tab draw a board the same way.
//
// A board draws wherever its canvas is: on the page, or in a worker on a canvas the page handed over, which keeps the
// drawing off the page's main thread. A worker has no document, so there the page says what it knows of the screen
// through setTableBoardEnvironment, and sizes the canvas's element from onFit.
//
// Updates queue: the step on screen plays out, at most one update waits behind it (a newer one
// replaces it), and the next render goes from what's showing to what's waiting, so the renderer animates across any
// update that was passed over.

import { parseEasing } from "./easing"
import type {
  TableBoardAnimation,
  TableBoardBackgroundStyle,
  TableBoardBlend,
  TableBoardFidelity,
  TableBoardKeyframe,
  TableBoardNode,
  TableBoardScene,
  TableBoardUpdate,
  Theme,
} from "./types"
import { sceneLimits } from "./tableBoardScene"

export { sceneLimits, spritesIn, validateScene } from "./tableBoardScene"

/** A sprite's picture, at one resolution */
export type SpriteBitmap = {
  bitmap: ImageBitmap
  /** In board units */
  width: number
  height: number
  anchor: [number, number]
}

/** What a board draws from: Puzzmo's sandboxed pmmg bundle at the table, the game's own code in the simulator */
export type TableBoardRenderer = {
  /** The board after an update, once every sprite it names is here to draw */
  render(update: TableBoardUpdate): Promise<TableBoardScene>
  /** A sprite at a resolution, once a render has made it */
  sprite(id: string, pixelsPerUnit: number): SpriteBitmap | undefined
}

/** One frame as a board drew it, for a debugging overlay drawn over the top */
export type TableBoardFrame = {
  /** The board's canvas, its transform reset, so the overlay draws in device pixels */
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  /** Device pixels per board unit on the canvas */
  scale: number
  scene: TableBoardScene
  /** Every node with a place this frame, in drawing order, children after their parents */
  nodes: TableBoardDrawnNode[]
}

export type TableBoardDrawnNode = {
  key: string
  /** The sprite it showed, keyframes applied; none for a node that only carries its children */
  sprite?: string
  /** Where it sits in board units, its parents' places folded in, as a canvas transform */
  matrix: [number, number, number, number, number, number]
  alpha: number
  /** Gone from the scene and playing its exit */
  exiting: boolean
}

/** Where a board is shown, which the bundle can draw it for; the background is the theme's when it's left out */
export type TableBoardLook = { fidelity: TableBoardFidelity; backgroundStyle?: TableBoardBackgroundStyle }

type View = { puzzle: string; input: string }

/** The longest a step holds the queue, however long its animations run */
const maxStepMs = 3_000
/** How long a board's width has to hold before its sprites are made again at the new size */
const settleMs = 250
/** Failed renders in a row a board survives once it has drawn; one that hasn't gives up at once */
const failuresBeforeGivingUp = 3

const boards = new Set<TableBoard>()
let frame = 0

export class TableBoard {
  private scene: TableBoardScene | null = null
  /** The resolution the scene's sprites were made at, and the one the canvas wants once its width settles */
  private spritesPpu = 0
  private wantedPpu = 0
  private live = new Map<string, Live>()
  private order: Live[] = []
  /** When everything the last step started has finished, loops aside */
  private until = 0
  private looping = false
  private shown: View | null = null
  private waiting: View | null = null
  private skipped = 0
  private rendering = false
  private failures = 0
  private disposed = false
  /** The box the board fits inside, and the width it's drawn at there */
  private boxWidth = 0
  private boxHeight = 0
  private cssWidth = 0
  /** The canvas's width in device pixels, which sets the board's scale */
  private pixelWidth = 0
  private height = 0
  private pendingHeight = 0
  private needsFit = false
  private settleTimer: ReturnType<typeof setTimeout> | undefined
  private stepTimer: ReturnType<typeof setTimeout> | undefined
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  private theme: Theme | null = null
  private look: TableBoardLook = { fidelity: "high" }
  private layers: OffscreenCanvasRenderingContext2D[] = []
  dirty = false
  /** Called after every frame with where each node was drawn, for the simulator's debug overlay */
  onDrawn?: (frame: TableBoardFrame) => void
  /** Called with the canvas's size on the page whenever it changes, for a canvas whose element is on another thread */
  onFit?: (cssWidth: number, cssHeight: number) => void
  private fittedWidth = 0
  private fittedHeight = 0

  constructor(
    private canvas: HTMLCanvasElement | OffscreenCanvas,
    private renderer: TableBoardRenderer,
    /** Steady for the board's life, for the renderer's caches */
    private boardID: string,
    /** Told when the board stops for good: frozen on its last scene if it had one (`drew`), else blank */
    private onBroken: (error: unknown, drew: boolean) => void,
  ) {
    this.ctx = (canvas as OffscreenCanvas).getContext("2d")!
    boards.add(this)
  }

  /** The newest view of the board; it shows once the step on screen has played out */
  update(view: View) {
    if (this.waiting) this.skipped++
    else if (this.shown && view.input === this.shown.input && view.puzzle === this.shown.puzzle) return
    this.waiting = view
    this.pump()
  }

  /** A new theme makes new sprites, so the board is drawn again in it; nothing's drawn before the first */
  setTheme(theme: Theme) {
    if (theme === this.theme) return
    this.theme = theme
    if (this.shown && !this.waiting) this.waiting = this.shown
    this.pump()
  }

  /** How much detail to draw and what's behind the board; a change draws it again, as a theme's does. Set it before the theme. */
  setLook(look: TableBoardLook) {
    if (look.fidelity === this.look.fidelity && look.backgroundStyle === this.look.backgroundStyle) return
    this.look = look
    if (this.shown && !this.waiting) this.waiting = this.shown
    this.pump()
  }

  /**
   * The box the board fits inside, as a thumbnail does: as wide as it can be without running past the bottom. A box
   * with no height of its own is only a width. The fitted width sets the canvas's pixel size and, once it settles, the
   * sprites' resolution
   */
  resize(boxWidth: number, boxHeight: number) {
    if ((boxWidth === this.boxWidth && boxHeight === this.boxHeight) || boxWidth <= 0) return
    this.boxWidth = boxWidth
    this.boxHeight = boxHeight
    // Before the first scene its shape isn't known, so its first sprites are made for the box's width
    if (!this.scene) this.cssWidth = boxWidth
    // On the next frame rather than in the resize observer: sizing the canvas there loops the observer
    this.needsFit = true
    this.dirty = true
    wake()
  }

  /** Draws the board again on the next frame, for an overlay that changed when nothing on the board did */
  redraw() {
    this.dirty = true
    wake()
  }

  /** Stops for good, showing the last scene as it ends, so a broken renderer reads as a neighbour who's paused */
  freeze() {
    if (this.disposed) return
    if (this.scene) this.draw(Infinity)
    this.dispose()
  }

  dispose() {
    this.disposed = true
    clearTimeout(this.settleTimer)
    clearTimeout(this.stepTimer)
    boards.delete(this)
  }

  /** Starts the next render when the queue allows one */
  private pump() {
    if (this.disposed || this.rendering || !this.theme) return
    const now = performance.now()
    const stepDone = now >= Math.min(this.until, this.stepStart + maxStepMs) || instant()
    if (this.waiting && !stepDone) {
      clearTimeout(this.stepTimer)
      this.stepTimer = setTimeout(() => this.pump(), Math.min(this.until, this.stepStart + maxStepMs) - now + 1)
      return
    }
    // The same view again at a new resolution: nothing changes, so nothing animates
    const next = this.waiting ?? (this.shown && this.wantedPpu && this.wantedPpu !== this.spritesPpu ? this.shown : null)
    if (!next) return
    this.waiting = null
    const skipped = this.skipped
    this.skipped = 0
    void this.render(next, skipped)
  }

  private stepStart = 0

  private async render(next: View, skipped: number) {
    this.rendering = true
    const ppu = this.wantedPpu || this.ppuFor(this.scene?.width ?? lastWidth.get(this.renderer))
    try {
      const scene = await this.renderer.render({
        board: this.boardID,
        puzzle: next.puzzle,
        input: next.input,
        previous: this.shown ?? undefined,
        skipped,
        theme: this.theme!,
        fidelity: this.look.fidelity,
        backgroundStyle: this.look.backgroundStyle ?? this.theme!.type,
        pixelsPerUnit: ppu,
      })
      if (this.disposed) return
      this.failures = 0
      lastWidth.set(this.renderer, scene.width)
      this.spritesPpu = ppu
      // The first scene says how wide the board is; if the guess was off, its sprites are made again at the right size
      this.wantedPpu = this.ppuFor(scene.width)
      this.show(scene, this.shown ? performance.now() : -Infinity)
      this.shown = next
    } catch (error) {
      if (this.disposed) return
      this.failures++
      if (!this.shown || this.failures >= failuresBeforeGivingUp) {
        this.freeze()
        return this.onBroken(error, !!this.shown)
      }
      console.warn("A table board couldn't render:", error)
      // Tried again with whatever's newest
      this.waiting ??= next
    } finally {
      this.rendering = false
    }
    this.pump()
  }

  /** Device pixels per board unit: the canvas's exactly, so sprites drawn at their own size are the board's size */
  private ppuFor(width: number | undefined) {
    const dpr = pixelRatio()
    if (!width) return dpr
    // Before the first scene the canvas isn't sized, so it's a guess from the box
    const pixels = this.pixelWidth || this.cssWidth * dpr
    // Rounded only past where floats wobble, so the same size always names the same sprites
    return pixels ? Math.round((pixels / width) * 1e6) / 1e6 : dpr
  }

  /** Matches the scene to what's on screen by key, and starts what moves; `now` of -Infinity shows it settled */
  private show(scene: TableBoardScene, now: number) {
    const still = now === -Infinity || instant()
    const at = still ? 0 : now
    this.stepStart = at
    let until = at
    let looping = false
    const previous = this.live
    const next = new Map<string, Live>()

    for (const node of scene.nodes) {
      const parent = node.parent ? next.get(node.parent)! : null
      const old = previous.get(node.key)
      const target = valuesOf(node)
      if (old && !old.exit) {
        const timing = still ? null : node.transition === false ? null : (node.transition ?? scene.transition ?? null)
        const from = baseAt(old, at)
        old.from = from
        old.to = target
        old.start = at + (timing?.delay ?? 0)
        old.duration = timing?.duration ?? 0
        old.ease = easing(timing?.easing)
        old.node = node
        old.parent = parent
        until = Math.max(until, old.start + old.duration)
        next.set(node.key, old)
      } else {
        const live: Live = { node, parent, from: target, to: target, start: at, duration: 0, ease: linear, effects: [] }
        if (node.enter && !still) {
          live.enter = running(node.enter, at)
          until = Math.max(until, live.enter.end)
        }
        next.set(node.key, live)
      }
    }

    // Gone from the scene: exits from where it is now, in its place in the drawing order, then goes
    const order: Live[] = scene.nodes.map((node) => next.get(node.key)!)
    for (let i = 0; i < this.order.length; i++) {
      const old = this.order[i]
      if (next.get(old.node.key) === old) continue
      // Already leaving: it plays on, or it's gone. Starting its exit again would bring back every node that ever left
      if (old.exit) {
        if (!still && old.exit.end > at) insertAfterPrevious(order, this.order, i, old)
        continue
      }
      if (!old.node.exit || still) continue
      old.frozen = { ...baseAt(old, at), ...frozenParent(old, at) }
      old.exit = running(old.node.exit, at)
      old.effects = []
      until = Math.max(until, old.exit.end)
      insertAfterPrevious(order, this.order, i, old)
    }

    if (!still) {
      for (const effect of scene.effects ?? []) {
        const live = next.get(effect.key)
        if (!live) continue
        const run = running(effect, at, effect.iterations ?? 1)
        live.effects.push(run)
        if (run.end === Infinity) looping = true
        else until = Math.max(until, run.end)
      }
    }
    for (const live of next.values()) {
      live.effects = live.effects.filter((run) => run.end > at)
      if (live.effects.some((run) => run.end === Infinity)) looping = true
    }

    this.live = next
    this.order = order
    this.until = until
    this.looping = looping
    const grew = !this.scene || scene.height / scene.width > this.height / (this.scene.width || 1)
    this.scene = scene
    // A board grows at once, and shrinks once what's leaving has left
    if (grew || still) {
      this.height = scene.height
      this.pendingHeight = 0
    } else this.pendingHeight = scene.height
    this.fit()
    this.dirty = true
    wake()
  }

  animating(now: number) {
    return this.looping || now < this.until || (this.pendingHeight > 0 && now >= this.until)
  }

  /** Draws the board as it is at `now`; true while something still moves */
  draw(now: number) {
    this.dirty = false
    const scene = this.scene
    if (!scene || !this.cssWidth) return false
    if (this.needsFit) this.fit()
    if (this.pendingHeight && now >= this.until) {
      this.height = this.pendingHeight
      this.pendingHeight = 0
      this.fit()
    }
    const { ctx, canvas } = this
    const scale = canvas.width / scene.width
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const worlds = new Map<Live, World>()
    // Isolated nodes being drawn, innermost last: each one's children go on a layer of their own, put down when its
    // run of children ends
    const open: { owner: Live; layer: OffscreenCanvasRenderingContext2D }[] = []
    const target = () => (open.length ? open[open.length - 1].layer : ctx)
    const close = () => {
      const { owner, layer } = open.pop()!
      const into = target()
      into.setTransform(1, 0, 0, 1, 0, 0)
      into.globalAlpha = 1
      into.globalCompositeOperation = compositeFor(owner.node.blend)
      into.drawImage(layer.canvas, 0, 0)
      into.globalCompositeOperation = "source-over"
    }
    // Only gathered when something is listening
    const drawn: TableBoardDrawnNode[] | null = this.onDrawn ? [] : null
    for (const live of this.order) {
      if (live.exit && now >= live.exit.end) continue
      while (open.length && !isInside(live, open[open.length - 1].owner)) close()
      const world = worldOf(live, now, worlds)
      if (world && drawn)
        drawn.push({ key: live.node.key, sprite: world.sprite, matrix: world.matrix, alpha: world.alpha, exiting: !!live.exit })
      if (!world || world.alpha <= 0) continue
      if (live.node.isolate) open.push({ owner: live, layer: this.layer(open.length) })
      if (world.sprite) this.drawSprite(target(), world.sprite, world, world.alpha, scale, live.node.blend)
    }
    while (open.length) close()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = "source-over"
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (drawn) this.onDrawn!({ ctx, scale, scene, nodes: drawn })
    return this.animating(now)
  }

  /** A cleared layer the canvas's size for isolated nodes at `depth`, kept from frame to frame */
  private layer(depth: number) {
    let layer = this.layers[depth]
    if (!layer || layer.canvas.width !== this.canvas.width || layer.canvas.height !== this.canvas.height)
      layer = this.layers[depth] = new OffscreenCanvas(this.canvas.width, this.canvas.height).getContext("2d")!
    layer.setTransform(1, 0, 0, 1, 0, 0)
    layer.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
    return layer
  }

  private drawSprite(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    id: string,
    world: World,
    alpha: number,
    scale: number,
    blend: TableBoardBlend | undefined,
  ) {
    const sprite = this.renderer.sprite(id, this.spritesPpu)
    if (!sprite || alpha <= 0) return
    const m = world.matrix
    const image: CanvasImageSource = world.tint ? tinted(sprite, world.tint) : sprite.bitmap
    // Within a percent of the size it was made at counts as that size, since the resolution is rounded
    const pixelPerfect = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && Math.abs(scale / this.spritesPpu - 1) < 1e-5
    ctx.globalAlpha = alpha
    ctx.globalCompositeOperation = compositeFor(blend)
    if (pixelPerfect) {
      // Only moved, at the size it was made: whole device pixels, so it's as sharp as its sprite
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const left = Math.round((m[4] - sprite.anchor[0]) * scale)
      const top = Math.round((m[5] - sprite.anchor[1]) * scale)
      ctx.drawImage(image, left, top)
      for (let extra = world.brightness - 1; extra > 0; extra--) {
        ctx.globalCompositeOperation = "lighter"
        ctx.globalAlpha = alpha * Math.min(1, extra)
        ctx.drawImage(image, left, top)
      }
    } else {
      ctx.setTransform(m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale, m[5] * scale)
      const draw = () => ctx.drawImage(image, -sprite.anchor[0], -sprite.anchor[1], sprite.width, sprite.height)
      draw()
      for (let extra = world.brightness - 1; extra > 0; extra--) {
        ctx.globalCompositeOperation = "lighter"
        ctx.globalAlpha = alpha * Math.min(1, extra)
        draw()
      }
    }
    ctx.globalCompositeOperation = "source-over"
  }

  /** The canvas's size on the page and in pixels, for its box and the board's shape */
  private fit() {
    const scene = this.scene
    if (!scene || !this.boxWidth) return
    this.needsFit = false
    const dpr = pixelRatio()
    const fitted = this.boxHeight > 0 ? Math.min(this.boxWidth, (this.boxHeight * scene.width) / this.height) : this.boxWidth
    // With a grid, the largest scale that fits and puts each grid step on whole device pixels
    const pixelWidth = Math.round(
      scene.grid ? Math.max(1, Math.floor(((fitted * dpr) / scene.width) * scene.grid)) * (scene.width / scene.grid) : fitted * dpr,
    )
    const cssWidth = pixelWidth / dpr
    this.pixelWidth = pixelWidth
    if (cssWidth !== this.cssWidth) {
      this.cssWidth = cssWidth
      clearTimeout(this.settleTimer)
      this.settleTimer = setTimeout(() => {
        this.wantedPpu = this.ppuFor(this.scene?.width)
        this.pump()
      }, settleMs)
    }
    const cssHeight = (this.cssWidth * this.height) / scene.width
    const width = pixelWidth
    const height = Math.round((pixelWidth * this.height) / scene.width)
    // An offscreen canvas has no element here to size
    if ("style" in this.canvas) {
      this.canvas.style.width = `${this.cssWidth}px`
      this.canvas.style.height = `${cssHeight}px`
    }
    if (this.cssWidth !== this.fittedWidth || cssHeight !== this.fittedHeight) {
      this.fittedWidth = this.cssWidth
      this.fittedHeight = cssHeight
      this.onFit?.(this.cssWidth, cssHeight)
    }
    // Setting a canvas's size, even to the same one, clears it
    if (width === this.canvas.width && height === this.canvas.height) return
    this.canvas.width = width
    this.canvas.height = height
    this.dirty = true
    wake()
  }
}

/** The renderer's last board width, so a new board's first sprites are made near the right size */
const lastWidth = new WeakMap<TableBoardRenderer, number>()

/** What a board needs to know of the screen it's shown on, which a worker can't read for itself */
export type TableBoardEnvironment = { devicePixelRatio: number; hidden: boolean; reducedMotion: boolean }

const environment: Partial<TableBoardEnvironment> = {}

/** Says what the page knows of the screen, where boards draw without a document; what's left out is read from the globals */
export const setTableBoardEnvironment = (next: Partial<TableBoardEnvironment>) => void Object.assign(environment, next)

const pixelRatio = () => environment.devicePixelRatio ?? (devicePixelRatio || 1)

const instant = () =>
  (environment.hidden ?? document.hidden) ||
  (environment.reducedMotion ?? (reducedMotion ??= matchMedia("(prefers-reduced-motion: reduce)")).matches)
/** Made on first use, not when the module loads, so importing the table is safe where there's no window */
let reducedMotion: MediaQueryList | undefined

const wake = () => {
  if (!frame) frame = requestAnimationFrame(loop)
}

const loop = (now: number) => {
  frame = 0
  let moving = false
  for (const board of boards) {
    if (!board.dirty && !board.animating(now)) continue
    try {
      moving = board.draw(now) || moving
    } catch (error) {
      console.error("A table board couldn't be drawn:", error)
    }
  }
  if (moving) wake()
}

// Animation state

type RGB = [number, number, number]

/** A node's values: what transitions animate between */
type Values = { x: number; y: number; rotation: number; sx: number; sy: number; opacity: number; brightness: number; tint: RGB | null }

/** One animation playing on a node, its keyframes ready to sample */
type Running = { frames: TableBoardKeyframe[]; start: number; duration: number; end: number; iterations: number; ease: Ease[] }

type Ease = (t: number) => number

/** A node on screen and what it's doing */
type Live = {
  node: TableBoardNode
  parent: Live | null
  /** The transition from `from` to `to` */
  from: Values
  to: Values
  start: number
  duration: number
  ease: Ease
  enter?: Running
  exit?: Running
  /** Where an exiting node was, its parent's place folded in, since its parent may be gone */
  frozen?: Values & { parentMatrix?: Matrix; parentAlpha?: number }
  effects: Running[]
}

type World = { matrix: Matrix; alpha: number; brightness: number; tint: RGB | null; sprite?: string }

const linear: Ease = (t) => t

const valuesOf = (node: TableBoardNode): Values => ({
  x: node.x,
  y: node.y,
  rotation: node.rotation ?? 0,
  sx: node.scale?.[0] ?? 1,
  sy: node.scale?.[1] ?? 1,
  opacity: node.opacity ?? 1,
  brightness: node.brightness ?? 1,
  tint: node.tint ? parseColor(node.tint) : null,
})

/** A node's own values at `now`, its transition applied but not its animations */
const baseAt = (live: Live, now: number): Values => {
  if (live.frozen) return live.frozen
  if (!live.duration || now >= live.start + live.duration) return live.to
  const t = now <= live.start ? 0 : live.ease((now - live.start) / live.duration)
  return mix(live.from, live.to, t)
}

const mix = (a: Values, b: Values, t: number): Values => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  rotation: a.rotation + (b.rotation - a.rotation) * t,
  sx: a.sx + (b.sx - a.sx) * t,
  sy: a.sy + (b.sy - a.sy) * t,
  opacity: a.opacity + (b.opacity - a.opacity) * t,
  brightness: a.brightness + (b.brightness - a.brightness) * t,
  tint: a.tint && b.tint ? mixRGB(a.tint, b.tint, t) : b.tint,
})

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** An exiting node's parent as it was, so the node stays put if its parent goes first */
const frozenParent = (live: Live, now: number) => {
  if (!live.parent) return {}
  const world = worldOf(live.parent, now, new Map())
  return world ? { parentMatrix: world.matrix, parentAlpha: world.alpha } : {}
}

const running = (animation: TableBoardAnimation, now: number, iterations = 1): Running => {
  const frames = [...animation.keyframes]
  // CSS's implied ends: the node's own values
  if (!frames.length || frames[0].offset > 0) frames.unshift({ offset: 0 })
  if (frames[frames.length - 1].offset < 1) frames.push({ offset: 1 })
  const start = now + (animation.delay ?? 0)
  const duration = Math.max(1, animation.duration)
  const fallback = animation.easing
  return {
    frames,
    start,
    duration,
    iterations,
    end: iterations === Infinity ? Infinity : start + duration * iterations,
    ease: frames.map((frame) => easing(frame.easing ?? fallback)),
  }
}

/** What an animation adds at `now`: null outside it, unless it fills (an enter before it starts, an exit after it ends) */
const sample = (run: Running, now: number, fill: boolean) => {
  if (now < run.start && !fill) return null
  if (now >= run.end && !fill) return null
  const elapsed = Math.max(0, Math.min(now, run.end === Infinity ? now : run.end) - run.start)
  let progress = elapsed / run.duration
  progress = now >= run.end ? 1 : progress - Math.floor(progress)
  const { frames } = run
  let i = 0
  while (i < frames.length - 2 && progress > frames[i + 1].offset) i++
  const a = frames[i]
  const b = frames[i + 1]
  const span = b.offset - a.offset || 1
  const t = run.ease[i](Math.min(1, Math.max(0, (progress - a.offset) / span)))
  let sprite: string | undefined
  for (const frame of frames) if (frame.offset <= progress && frame.sprite) sprite = frame.sprite
  const lerp = (x: number | undefined, y: number | undefined, identity: number) => (x ?? identity) + ((y ?? identity) - (x ?? identity)) * t
  return {
    x: lerp(a.x, b.x, 0),
    y: lerp(a.y, b.y, 0),
    rotation: lerp(a.rotation, b.rotation, 0),
    sx: lerp(a.scale?.[0], b.scale?.[0], 1),
    sy: lerp(a.scale?.[1], b.scale?.[1], 1),
    opacity: lerp(a.opacity, b.opacity, 1),
    brightness: lerp(a.brightness, b.brightness, 1),
    tint: a.tint || b.tint ? mixRGB(parseColor(a.tint ?? b.tint!), parseColor(b.tint ?? a.tint!), t) : null,
    sprite,
  }
}

/** Where a node is on the board at `now`, and how it's drawn, its parents' places folded in */
const worldOf = (live: Live, now: number, worlds: Map<Live, World>): World | null => {
  const known = worlds.get(live)
  if (known) return known
  const base = baseAt(live, now)
  let { x, y, rotation, sx, sy, opacity, brightness, tint } = base
  let sprite = live.node.sprite
  const runs: [Running | undefined, boolean][] = [
    [live.enter, true],
    [live.exit, true],
    ...live.effects.map((run): [Running, boolean] => [run, false]),
  ]
  for (const [run, fill] of runs) {
    if (!run) continue
    const at = sample(run, now, fill)
    if (!at) continue
    x += at.x
    y += at.y
    rotation += at.rotation
    sx *= at.sx
    sy *= at.sy
    opacity *= at.opacity
    brightness *= at.brightness
    if (at.tint) tint = at.tint
    if (at.sprite) sprite = at.sprite
  }
  let parentMatrix = identity
  let parentAlpha = 1
  let parentBrightness = 1
  if (live.frozen?.parentMatrix) {
    parentMatrix = live.frozen.parentMatrix
    parentAlpha = live.frozen.parentAlpha ?? 1
  } else if (live.parent) {
    const parent = worldOf(live.parent, now, worlds)
    if (!parent) return null
    parentMatrix = parent.matrix
    parentAlpha = parent.alpha
    parentBrightness = parent.brightness
  }
  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const local: Matrix = [cos * sx, sin * sx, -sin * sy, cos * sy, x, y]
  const world: World = {
    matrix: multiply(parentMatrix, snap(local)),
    alpha: parentAlpha * opacity,
    // Capped here, as each extra unit is another draw: multiplied unchecked, a scene's brightness could reach Infinity
    brightness: Math.min(parentBrightness * brightness, sceneLimits.brightness),
    tint,
    sprite,
  }
  worlds.set(live, world)
  return world
}

type Matrix = [number, number, number, number, number, number]
const identity: Matrix = [1, 0, 0, 1, 0, 0]

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

/** Rounds away float noise in a whole turn, so a card at 360° still counts as unturned and draws pixel-perfect */
const snap = (m: Matrix): Matrix => m.map((v, i) => (i < 4 && Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : v)) as Matrix

/** A blend as the canvas names it: CSS's other modes are the canvas's own words, and its normal is source-over */
const compositeFor = (blend: TableBoardBlend | undefined): GlobalCompositeOperation =>
  !blend || blend === "normal" ? "source-over" : blend

/** Whether `live` is one of `owner`'s children, or theirs */
const isInside = (live: Live, owner: Live) => {
  for (let at = live.parent; at; at = at.parent) if (at === owner) return true
  return false
}

/** Puts an exiting node back after the node it followed, in the new drawing order */
const insertAfterPrevious = (order: Live[], oldOrder: Live[], index: number, live: Live) => {
  for (let i = index - 1; i >= 0; i--) {
    const at = order.indexOf(oldOrder[i])
    if (at >= 0) return void order.splice(at + 1, 0, live)
  }
  order.unshift(live)
}

const easings = new Map<string, Ease>()
const easing = (value: string | undefined): Ease => {
  if (!value) return linear
  let ease = easings.get(value)
  if (!ease) easings.set(value, (ease = parseEasing(value)))
  return ease
}

// Colours

/** Made on first use, as reducedMotion is */
let colorContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | undefined
const colors = new Map<string, RGB>()

/** A CSS colour as RGB, read back through a canvas so every syntax the browser knows works */
const parseColor = (value: string): RGB => {
  let rgb = colors.get(value)
  if (rgb) return rgb
  // An offscreen canvas where there is one, as a worker has no document
  // getContext is called on each canvas type, as TS 5.x can't resolve the "2d" overload on the union
  colorContext ??=
    typeof OffscreenCanvas === "undefined"
      ? document.createElement("canvas").getContext("2d")!
      : new OffscreenCanvas(1, 1).getContext("2d")!
  colorContext.fillStyle = "#000"
  colorContext.fillStyle = value
  const normal = String(colorContext.fillStyle)
  const hex = /^#([0-9a-f]{6})$/i.exec(normal)
  const parts = hex
    ? [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16))
    : (/rgba?\(([^)]+)\)/.exec(normal)?.[1].split(",").slice(0, 3).map(Number) ?? [0, 0, 0])
  rgb = [parts[0], parts[1], parts[2]]
  colors.set(value, rgb)
  return rgb
}

/** Tinted copies of a sprite, by colour; a tint that's animating makes a copy per step, so the set is capped */
const tints = new WeakMap<ImageBitmap, Map<string, OffscreenCanvas>>()
const tintsPerSprite = 48

const tinted = (sprite: SpriteBitmap, rgb: RGB): OffscreenCanvas => {
  // Steps of 4 in each channel: a tint mid-animation reuses copies, and the eye can't tell
  const key = rgb.map((c) => Math.round(c / 4) * 4).join(",")
  let copies = tints.get(sprite.bitmap)
  if (!copies) tints.set(sprite.bitmap, (copies = new Map()))
  let copy = copies.get(key)
  if (copy) return copy
  if (copies.size >= tintsPerSprite) copies.clear()
  const { width, height } = sprite.bitmap
  copy = new OffscreenCanvas(width, height)
  const ctx = copy.getContext("2d")!
  ctx.drawImage(sprite.bitmap, 0, 0)
  ctx.globalCompositeOperation = "multiply"
  ctx.fillStyle = `rgb(${key})`
  ctx.fillRect(0, 0, width, height)
  // Multiplying fills the transparent pixels too; the sprite's own alpha cuts them back out
  ctx.globalCompositeOperation = "destination-in"
  ctx.drawImage(sprite.bitmap, 0, 0)
  copies.set(key, copy)
  return copy
}
