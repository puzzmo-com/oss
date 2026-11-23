import type {
  TableBoardAnimation,
  TableBoardBlend,
  TableBoardEffect,
  TableBoardKeyframe,
  TableBoardNode,
  TableBoardScene,
  TableBoardTiming,
} from "./types"

// A scene comes from a game's code, so the host takes nothing on trust: every field is checked and copied, and anything
// unknown is dropped. A scene that breaks a rule is refused whole, with the reason, rather than drawn in part. In the
// SDK so the simulator's Pmmg tab refuses the same scenes Puzzmo's table does.

/** The most of each thing one scene can hold */
export const sceneLimits = {
  nodes: 5000,
  effects: 5000,
  keyframes: 32,
  /** The longest delay or duration, in ms */
  ms: 10_000,
  /** The largest board, in board units */
  size: 100_000,
  text: 200,
  /** How many nodes deep a node can sit, itself counted. Each isolated level draws on a layer the canvas's size */
  depth: 16,
  /** The brightest a node draws, however its own, its keyframes' and its parents' brightness multiply */
  brightness: 10,
}

/** The scene with only what the host knows how to draw, or throws saying what's wrong with it */
export const validateScene = (input: unknown): TableBoardScene => {
  const scene = record(input, "The scene")
  const width = positive(scene.width, "The scene's width", sceneLimits.size)
  const height = positive(scene.height, "The scene's height", sceneLimits.size)
  const rawNodes = list(scene.nodes, "The scene's nodes", sceneLimits.nodes)
  const keys = new Set<string>()
  const parents = new Map<string, string | undefined>()
  // Isolated nodes whose children are being listed, innermost last, and those whose run of children is over
  const open: string[] = []
  const closed = new Set<string>()
  const nodes = rawNodes.map((raw, index) => {
    const node = validateNode(raw, `Node ${index}`)
    if (keys.has(node.key)) throw new Error(`Node ${index}'s key "${node.key}" is used twice`)
    if (node.parent !== undefined && !keys.has(node.parent))
      throw new Error(`Node "${node.key}"'s parent "${node.parent}" must come before it`)
    keys.add(node.key)
    parents.set(node.key, node.parent)
    const ancestors = new Set<string>()
    for (let at = node.parent; at !== undefined; at = parents.get(at)) ancestors.add(at)
    if (ancestors.size >= sceneLimits.depth) throw new Error(`Node "${node.key}" is nested over ${sceneLimits.depth} nodes deep`)
    while (open.length && !ancestors.has(open[open.length - 1])) closed.add(open.pop()!)
    const split = [...ancestors].find((key) => closed.has(key))
    if (split) throw new Error(`Node "${node.key}" is in isolated "${split}", so it must come straight after its other children`)
    if (node.isolate) open.push(node.key)
    return node
  })
  const out: TableBoardScene = { width, height, nodes }
  if (scene.grid !== undefined) out.grid = positive(scene.grid, "The scene's grid", width)
  if (scene.transition !== undefined) out.transition = timing(scene.transition, "The scene's transition")
  if (scene.effects !== undefined) {
    out.effects = list(scene.effects, "The scene's effects", sceneLimits.effects).map((raw, index) => {
      const effect = validateEffect(raw, `Effect ${index}`)
      if (!keys.has(effect.key)) throw new Error(`Effect ${index} is for "${effect.key}", which isn't in the scene`)
      return effect
    })
  }
  return out
}

/** Every sprite a scene names, in its nodes and in its keyframes */
export const spritesIn = (scene: TableBoardScene): Set<string> => {
  const ids = new Set<string>()
  const fromFrames = (animation?: TableBoardAnimation) => animation?.keyframes.forEach((frame) => frame.sprite && ids.add(frame.sprite))
  for (const node of scene.nodes) {
    if (node.sprite) ids.add(node.sprite)
    fromFrames(node.enter)
    fromFrames(node.exit)
  }
  scene.effects?.forEach(fromFrames)
  return ids
}

const validateNode = (input: unknown, label: string): TableBoardNode => {
  const raw = record(input, label)
  const node: TableBoardNode = { key: text(raw.key, `${label}'s key`), x: finite(raw.x, `${label}'s x`), y: finite(raw.y, `${label}'s y`) }
  if (raw.sprite !== undefined) node.sprite = text(raw.sprite, `${label}'s sprite`)
  if (raw.parent !== undefined) node.parent = text(raw.parent, `${label}'s parent`)
  if (raw.blend !== undefined) {
    if (!blends.includes(raw.blend as TableBoardBlend)) throw new Error(`${label}'s blend must be one of ${blends.join(", ")}`)
    node.blend = raw.blend as TableBoardBlend
  }
  if (raw.isolate === true) node.isolate = true
  Object.assign(node, appearance(raw, label))
  if (raw.transition === false) node.transition = false
  else if (raw.transition !== undefined) node.transition = timing(raw.transition, `${label}'s transition`)
  if (raw.enter !== undefined) node.enter = animation(raw.enter, `${label}'s enter`)
  if (raw.exit !== undefined) node.exit = animation(raw.exit, `${label}'s exit`)
  return node
}

const validateEffect = (input: unknown, label: string): TableBoardEffect => {
  const raw = record(input, label)
  const effect: TableBoardEffect = { key: text(raw.key, `${label}'s key`), ...animation(raw, label) }
  if (raw.iterations !== undefined) {
    const iterations = Number(raw.iterations)
    if (!(iterations >= 1)) throw new Error(`${label}'s iterations must be 1 or more`)
    effect.iterations = iterations
  }
  return effect
}

/** The values a node and a keyframe share */
const appearance = (raw: Record<string, unknown>, label: string) => {
  const out: Partial<TableBoardKeyframe> = {}
  if (raw.rotation !== undefined) out.rotation = finite(raw.rotation, `${label}'s rotation`)
  if (raw.scale !== undefined) out.scale = pair(raw.scale, `${label}'s scale`)
  if (raw.opacity !== undefined) out.opacity = clamp(finite(raw.opacity, `${label}'s opacity`), 0, 1)
  if (raw.brightness !== undefined) out.brightness = clamp(finite(raw.brightness, `${label}'s brightness`), 0, sceneLimits.brightness)
  if (raw.tint !== undefined) out.tint = text(raw.tint, `${label}'s tint`)
  return out
}

const animation = (input: unknown, label: string): TableBoardAnimation => {
  const raw = record(input, label)
  let last = -1
  const keyframes = list(raw.keyframes, `${label}'s keyframes`, sceneLimits.keyframes).map((rawFrame, index) => {
    const frameLabel = `${label}'s keyframe ${index}`
    const frame = record(rawFrame, frameLabel)
    const offset = finite(frame.offset, `${frameLabel}'s offset`)
    if (offset < 0 || offset > 1 || offset < last) throw new Error(`${frameLabel}'s offset must be from 0 to 1, in order`)
    last = offset
    const out: TableBoardKeyframe = { offset, ...appearance(frame, frameLabel) }
    if (frame.x !== undefined) out.x = finite(frame.x, `${frameLabel}'s x`)
    if (frame.y !== undefined) out.y = finite(frame.y, `${frameLabel}'s y`)
    if (frame.easing !== undefined) out.easing = text(frame.easing, `${frameLabel}'s easing`)
    if (frame.sprite !== undefined) out.sprite = text(frame.sprite, `${frameLabel}'s sprite`)
    return out
  })
  return { ...timing(raw, label), keyframes }
}

const timing = (input: unknown, label: string): TableBoardTiming => {
  const raw = record(input, label)
  const out: TableBoardTiming = { duration: clamp(finite(raw.duration, `${label}'s duration`), 0, sceneLimits.ms) }
  if (raw.delay !== undefined) out.delay = clamp(finite(raw.delay, `${label}'s delay`), 0, sceneLimits.ms)
  if (raw.easing !== undefined) out.easing = text(raw.easing, `${label}'s easing`)
  return out
}

const blends: TableBoardBlend[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]

const record = (value: unknown, label: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

const list = (value: unknown, label: string, max: number) => {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`)
  if (value.length > max) throw new Error(`${label} can hold at most ${max}, got ${value.length}`)
  return value as unknown[]
}

const text = (value: unknown, label: string) => {
  if (typeof value !== "string" || !value || value.length > sceneLimits.text)
    throw new Error(`${label} must be text of 1 to ${sceneLimits.text} characters`)
  return value
}

const finite = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

const positive = (value: unknown, label: string, max: number) => {
  const n = finite(value, label)
  if (n <= 0 || n > max) throw new Error(`${label} must be above 0 and at most ${max}`)
  return n
}

const pair = (value: unknown, label: string): [number, number] => {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} must be two numbers`)
  return [finite(value[0], label), finite(value[1], label)]
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
