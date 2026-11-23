// The Pmmg tab's debug overlay, drawn over a table board's frame from where TableBoard says each node went, and the
// hit-testing that finds the node under the pointer.

import type { TableBoardDrawnNode, TableBoardFrame } from "../tableBoard"

/** Which debugging marks the overlay draws */
export type PmmgOverlayToggles = {
  /** The scene's width and height */
  bounds: boolean
  /** Lines every `grid` units, for a scene that sets one */
  grid: boolean
  /** Each sprite's box, turned and scaled as it's drawn */
  boxes: boolean
  /** Where each node's anchor sits; hollow for a node with no sprite */
  anchors: boolean
  keys: boolean
}

export type PmmgOverlayView = PmmgOverlayToggles & {
  boxOf: (sprite: string) => SpriteBox | undefined
  /** The node under the pointer, outlined whatever the toggles say */
  hovered: string | null
  /** A sprite picked in the Sprites tab, whose nodes are outlined */
  highlighted: string | null
  devicePixelRatio: number
}

export type SpriteBox = { width: number; height: number; anchor: [number, number] }
type Point = [number, number]
type Matrix = TableBoardDrawnNode["matrix"]

const colors = {
  bounds: "#ffd700",
  grid: "rgba(96, 165, 250, 0.35)",
  box: "rgba(34, 211, 238, 0.85)",
  exiting: "#f87171",
  hovered: "#ffd700",
  highlighted: "#f472b6",
  anchor: "#f472b6",
  group: "#a78bfa",
  label: "#e8e8e8",
  labelBackground: "rgba(15, 15, 26, 0.8)",
}

/** Draws the overlay over the frame the board just drew, in its canvas's device pixels */
export const drawPmmgOverlay = (frame: TableBoardFrame, view: PmmgOverlayView) => {
  const { ctx, scale, scene, nodes } = frame
  const px = view.devicePixelRatio
  const toCanvas = ([x, y]: Point): Point => [x * scale, y * scale]
  ctx.save()
  ctx.lineWidth = px

  // Past a few hundred lines a grid is a wash of colour, not something to read
  if (view.grid && scene.grid && scene.width / scene.grid + scene.height / scene.grid <= 400) {
    ctx.strokeStyle = colors.grid
    ctx.beginPath()
    for (let x = scene.grid; x < scene.width; x += scene.grid) {
      const at = Math.round(x * scale) + px / 2
      ctx.moveTo(at, 0)
      ctx.lineTo(at, scene.height * scale)
    }
    for (let y = scene.grid; y < scene.height; y += scene.grid) {
      const at = Math.round(y * scale) + px / 2
      ctx.moveTo(0, at)
      ctx.lineTo(scene.width * scale, at)
    }
    ctx.stroke()
  }

  if (view.bounds) {
    ctx.strokeStyle = colors.bounds
    ctx.setLineDash([4 * px, 3 * px])
    ctx.strokeRect(px / 2, px / 2, scene.width * scale - px, scene.height * scale - px)
    ctx.setLineDash([])
  }

  for (const node of nodes) {
    const box = node.sprite ? view.boxOf(node.sprite) : undefined
    const hovered = node.key === view.hovered
    const highlighted = !!node.sprite && node.sprite === view.highlighted
    if (box && (view.boxes || hovered || highlighted)) {
      const corners = cornersOf(node.matrix, box).map(toCanvas)
      ctx.strokeStyle = hovered ? colors.hovered : highlighted ? colors.highlighted : node.exiting ? colors.exiting : colors.box
      ctx.lineWidth = (hovered || highlighted ? 2 : 1) * px
      // Dashed while it can't be seen, mid-fade or before its enter starts
      ctx.setLineDash(node.alpha <= 0 ? [3 * px, 3 * px] : [])
      ctx.beginPath()
      corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineWidth = px
    }
    if (view.anchors) {
      const [x, y] = toCanvas(apply(node.matrix, [0, 0]))
      if (box) {
        ctx.fillStyle = colors.anchor
        ctx.fillRect(x - 1.5 * px, y - 1.5 * px, 3 * px, 3 * px)
      } else {
        ctx.strokeStyle = colors.group
        ctx.beginPath()
        ctx.moveTo(x, y - 4 * px)
        ctx.lineTo(x + 4 * px, y)
        ctx.lineTo(x, y + 4 * px)
        ctx.lineTo(x - 4 * px, y)
        ctx.closePath()
        ctx.stroke()
      }
    }
  }

  // Labels last, so no box is drawn over one
  if (view.keys) {
    ctx.font = `${9 * px}px Menlo, Monaco, monospace`
    ctx.textBaseline = "top"
    for (const node of nodes) {
      const box = node.sprite ? view.boxOf(node.sprite) : undefined
      const [x, y] = box ? topLeftOf(cornersOf(node.matrix, box).map(toCanvas)) : toCanvas(apply(node.matrix, [0, 0]))
      const width = ctx.measureText(node.key).width
      ctx.fillStyle = colors.labelBackground
      ctx.fillRect(x, y, width + 4 * px, 11 * px)
      ctx.fillStyle = colors.label
      ctx.fillText(node.key, x + 2 * px, y + px)
    }
  }
  ctx.restore()
}

/** A sprite's four corners on the board, in board units: its box about its anchor, through the node's matrix */
export const cornersOf = (matrix: Matrix, box: SpriteBox): Point[] => {
  const [ax, ay] = box.anchor
  const local: Point[] = [
    [-ax, -ay],
    [box.width - ax, -ay],
    [box.width - ax, box.height - ay],
    [-ax, box.height - ay],
  ]
  return local.map((point) => apply(matrix, point))
}

/** The topmost node showing a sprite under a point in board units, or null */
export const nodeAt = (nodes: TableBoardDrawnNode[], point: Point, boxOf: PmmgOverlayView["boxOf"]): TableBoardDrawnNode | null => {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    if (!node.sprite || node.alpha <= 0) continue
    const box = boxOf(node.sprite)
    const local = box && invert(node.matrix, point)
    if (!box || !local) continue
    const x = local[0] + box.anchor[0]
    const y = local[1] + box.anchor[1]
    if (x >= 0 && y >= 0 && x <= box.width && y <= box.height) return node
  }
  return null
}

const apply = (m: Matrix, [x, y]: Point): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** Where a board point falls in a node's own units; null for a node squashed flat, as a card is mid-turn */
const invert = (m: Matrix, [x, y]: Point): Point | null => {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-12) return null
  const dx = x - m[4]
  const dy = y - m[5]
  return [(m[3] * dx - m[2] * dy) / det, (-m[1] * dx + m[0] * dy) / det]
}

const topLeftOf = (points: Point[]): Point => [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))]
