import type { KeyboardConfig, MessagesReceived, Theme } from "../types"

/**
 * The on-screen keyboard, drawn under the game at the size the real host draws it, so a game can be
 * checked against the space it actually gets on a touch device.
 *
 * The sizes here — both heights, the key widths, the row split, the drag-cursor thresholds — are
 * mirrored from `@puzzmo-com/keyboard` (PlayGameKeyboard.tsx, Letter.tsx), which is what puzzmo.com
 * renders. That package is workspace-private and React; this one is published to npm with a single
 * dependency, so it cannot be imported. The numbers have to be kept in step by hand.
 *
 * The wireframe styling is deliberate: only the box model is faithful, so only the box model is
 * drawn. Key icons, press animation, key repeat, haptics and `kbdStyles` are all dropped rather
 * than approximated. CSS the game sets on the keys themselves is the exception, both the config's
 * blanket `keyStyles` and its per-key `individualKeyStyles`: it is applied as sent, because a game
 * tuning it needs to see it.
 */

/** Space the keys occupy. */
const kbdHeight = 200
/** Extra padding under the keys, matching Apple keyboards. Nothing to do with safe areas. */
const paddingBottom = 24
/** What the keyboard takes off the bottom of the game, and what the game must lay out without. */
export const dockedKeyboardHeight = kbdHeight + paddingBottom

/** Drag-cursor thresholds, from useKeyboardCursor in @puzzmo-com/keyboard. */
const sequentialMovesThreshold = 6
const movementScale = 2.5
const minDragTimeMs = 100

/** Key widths as a share of the row, from getKeyWidth. */
const keyWidth = (isL: boolean, isXL: boolean) => (isL ? "14.7%" : isXL ? "17.85%" : "9.75%")

/** `theme.fg` at an alpha — the wireframe's only ink, so it stays legible on light and dark themes. */
const ink = (hex: string, alpha: number): string => {
  const value = hex.replace("#", "")
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value
  const int = parseInt(full, 16)
  if (full.length !== 6 || Number.isNaN(int)) return hex
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`
}

export interface DockedKeyboard {
  /** Show or hide the dock. Hiding gives the space back to the game. */
  setEnabled: (enabled: boolean) => void
  /** The game's latest config, or null when it has no keyboard up. */
  setConfig: (config: KeyboardConfig | null) => void
}

export interface DockedKeyboardOptions {
  /** The simulator's selected theme; the wireframe borrows only its background and foreground. */
  theme: Theme
  sendToGame: (type: keyof MessagesReceived, data: any) => void
}

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
const escapeHTML = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function createDockedKeyboard(options: DockedKeyboardOptions): DockedKeyboard {
  const { theme, sendToGame } = options

  let enabled = false
  let config: KeyboardConfig | null = null
  let element: HTMLElement | null = null

  // Shortening the page is not enough on its own: games fill the frame with an `inset: 0` absolute
  // element (BaseGameWrapper) that resolves against the viewport, not against `body`. Making the
  // game root `position: relative` turns it into the containing block — what the iframe edge does
  // in production — so the height reaches the game and its ResizeObserver re-lays out the board.
  const pageStyle = document.createElement("style")
  pageStyle.id = "sim-docked-kbd-page-style"
  pageStyle.textContent = `
    html.sim-kbd-docked #simulator {
      bottom: ${dockedKeyboardHeight + 4}px;
    }
  `

  /** The element the game mounted into: `#root` per the SDK's page template, else the page's first element. */
  const gameRoot = (): HTMLElement | null => document.getElementById("root") ?? (document.body.firstElementChild as HTMLElement | null)

  /** The game root's own inline height/position, restored when the dock comes down. */
  let restoreRootStyle: (() => void) | null = null

  const shrinkGameRoot = () => {
    const root = gameRoot()
    if (!root || restoreRootStyle) return
    const { height, maxHeight, position } = root.style
    restoreRootStyle = () => {
      root.style.height = height
      root.style.maxHeight = maxHeight
      root.style.position = position
      restoreRootStyle = null
    }
    root.style.height = `calc(100% - ${dockedKeyboardHeight}px)`
    root.style.maxHeight = `calc(100% - ${dockedKeyboardHeight}px)`
    if (getComputedStyle(root).position === "static") root.style.position = "relative"
  }

  /** The key face: an outline, plus whatever CSS the game set for this key. */
  const keyFaceStyles = (char: string, cfg: KeyboardConfig): string => {
    const disabled = cfg.disabled.includes(char)
    const highlight = cfg.highlight.includes(char)
    const border = disabled
      ? `1px dashed ${ink(theme.fg, 0.25)}`
      : highlight
        ? `2px solid ${ink(theme.fg, 0.75)}`
        : `1px solid ${ink(theme.fg, 0.4)}`

    return [
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "width:100%",
      "height:100%",
      "box-sizing:border-box",
      "border-radius:3px",
      "overflow:hidden",
      "background:transparent",
      "pointer-events:none",
      `border:${border}`,
      cssText(cfg.individualKeyStyles?.[char]?.background),
    ]
      .filter(Boolean)
      .join(";")
  }

  /** One small monospace label per key; the glyph only names the box. */
  const keyLabelStyles = (char: string, cfg: KeyboardConfig): string =>
    [
      "font:11px/1 Menlo, Monaco, Consolas, monospace",
      "letter-spacing:0.5px",
      "text-transform:uppercase",
      "white-space:nowrap",
      `color:${ink(theme.fg, cfg.disabled.includes(char) ? 0.3 : 0.65)}`,
      // Production applies the config's blanket keyStyles to the label of any non-highlight key.
      cfg.highlight.includes(char) ? "" : cssText(cfg.keyStyles),
      cssText(cfg.individualKeyStyles?.[char]?.text),
    ]
      .filter(Boolean)
      .join(";")

  const renderKey = (char: string, cfg: KeyboardConfig): string => {
    const label = cfg.symbols[char] ?? char
    const disabled = cfg.disabled.includes(char)
    const grow = cfg.flexGrowSymbols?.includes(char)
    const width = keyWidth(cfg.l.includes(char), cfg.xl.includes(char))

    // The wrapper carries the production box model: row share, full row height, gutters, and the
    // 12px below each key.
    const keyStyles = [
      `width:${width}`,
      `flex:${grow ? "1 0 auto" : "0 1 auto"}`,
      "height:100%",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:0 3px 12px",
      "position:relative",
      disabled ? "pointer-events:none" : "",
    ]
      .filter(Boolean)
      .join(";")

    const innerStyles = keyFaceStyles(char, cfg)
    const textStyles = keyLabelStyles(char, cfg)

    return `<div class="sim-docked-kbd-key" data-key="${escapeAttr(char)}" style="${keyStyles}">
      <div class="sim-docked-kbd-key-inner" style="${innerStyles}"><div style="${textStyles}">${escapeHTML(label)}</div></div>
    </div>`
  }

  const renderKeyboard = (cfg: KeyboardConfig): string => {
    const rows = cfg.layout.filter((row): row is string => !!row)
    const rowHeight = `calc(100% / ${rows.length})`
    const keys = rows
      .map((row, i) => {
        const positioning = cfg.rowPositioning?.[i] ?? "center"
        const style = `height:${rowHeight};display:flex;flex-direction:row;align-items:center;justify-content:${positioning}`
        return `<div style="${style}">${[...row].map((char) => renderKey(char, cfg)).join("")}</div>`
      })
      .join("")

    // The cursor wash, as in production: the keyboard dims while the drag cursor is steering.
    const wash = `<div id="sim-docked-kbd-cursor" style="position:absolute;inset:0;z-index:1;background:${ink(theme.fg, 0.12)};opacity:0;transition:opacity 0.1s ease-in-out;pointer-events:none"></div>`

    return `${keys}${wash}`
  }

  // Drag-cursor state, reset at the end of every gesture.
  let cursorActive = false
  let cursorPosition: [number, number] = [0, 0]
  let previousEvent: { clientX: number; clientY: number; pointerId: number } | null = null
  let sequentialMoves = 0
  let firstMoveTime: number | null = null
  /** The key the gesture started on; a press only lands if it ends on that same key. */
  let pressedKey: string | null = null

  const setCursorWash = (visible: boolean) => {
    const wash = element?.querySelector<HTMLElement>("#sim-docked-kbd-cursor")
    if (wash) wash.style.opacity = visible ? "0.5" : "0"
  }

  const resetGesture = () => {
    cursorActive = false
    cursorPosition = [0, 0]
    previousEvent = null
    sequentialMoves = 0
    firstMoveTime = null
    pressedKey = null
    setCursorWash(false)
  }

  /**
   * The key under a pointer event. Read by coordinate: the element captures the pointer, so every
   * event after pointerdown retargets to the container and `event.target` stops naming a key.
   */
  const keyAt = (event: PointerEvent): string | null =>
    document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".sim-docked-kbd-key")?.getAttribute("data-key") ?? null

  const onPointerDown = (event: PointerEvent) => {
    pressedKey = keyAt(event)
    // Capture, so a drag that wanders off the keyboard still reports its moves and its end.
    element?.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!config?.supportsDragCursor || !pressedKey) return
    // Chrome on a touchscreen keeps firing move events for a stationary finger.
    if (previousEvent && previousEvent.clientX === event.clientX && previousEvent.clientY === event.clientY) return

    if (previousEvent && previousEvent.pointerId !== event.pointerId) {
      sequentialMoves = 0
      firstMoveTime = null
    }
    if (!firstMoveTime) firstMoveTime = Date.now()

    if (!cursorActive) {
      sequentialMoves += 1
      // Both thresholds, so neither a slow settle nor a flick past a key starts steering.
      if (sequentialMoves >= sequentialMovesThreshold && Date.now() - firstMoveTime >= minDragTimeMs) {
        cursorActive = true
        setCursorWash(true)
      }
    }

    if (cursorActive && previousEvent) {
      cursorPosition = [
        cursorPosition[0] + (event.clientX - previousEvent.clientX) * movementScale,
        cursorPosition[1] + (event.clientY - previousEvent.clientY) * movementScale,
      ]
    }
    previousEvent = { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId }

    if (cursorActive) sendToGame("KEYBOARD_CURSOR_CHANGE", { position: cursorPosition })
  }

  const onPointerUp = (event: PointerEvent) => {
    // A gesture that steered the cursor never types — the game is told where the cursor landed instead.
    if (cursorActive) {
      sendToGame("KEYBOARD_CURSOR_END", {})
    } else if (pressedKey && keyAt(event) === pressedKey) {
      sendToGame("KEYBOARD_KEY_PRESS", { key: pressedKey })
    }
    resetGesture()
  }

  const mount = () => {
    if (element || !config) return

    element = document.createElement("div")
    element.id = "sim-docked-kbd"
    element.style.cssText = [
      "position:fixed",
      "left:0",
      "right:0",
      "bottom:0",
      `height:${dockedKeyboardHeight}px`,
      "box-sizing:border-box",
      "padding-top:8px",
      `padding-bottom:${paddingBottom}px`,
      "display:flex",
      "flex-direction:column",
      // Under the simulator panel (999999), over anything the game draws.
      "z-index:999998",
      "touch-action:none",
      "user-select:none",
      "-webkit-user-select:none",
      // Flat, in the game's own background, with a hairline marking where the game's space ends.
      `background:${theme.a_bg}`,
      `border-top:1px solid ${ink(theme.fg, 0.2)}`,
    ].join(";")
    element.innerHTML = renderKeyboard(config)

    element.addEventListener("pointerdown", onPointerDown)
    element.addEventListener("pointermove", onPointerMove)
    element.addEventListener("pointerup", onPointerUp)
    element.addEventListener("pointercancel", () => resetGesture())
    element.addEventListener("contextmenu", (event) => event.preventDefault())

    document.body.appendChild(element)
    if (!pageStyle.isConnected) document.head.appendChild(pageStyle)
    document.documentElement.classList.add("sim-kbd-docked")
    shrinkGameRoot()
  }

  const unmount = () => {
    if (!element) return
    element.remove()
    element = null
    document.documentElement.classList.remove("sim-kbd-docked")
    restoreRootStyle?.()
    resetGesture()
  }

  /**
   * Writes the current styles onto the keys already on screen. A style change must not rebuild the
   * DOM: a fresh element starts at its final computed value, so any `transition` a game sets would
   * never run and it would look like the game's CSS was wrong.
   */
  const restyleKeys = () => {
    const cfg = config
    if (!element || !cfg) return
    element.querySelectorAll<HTMLElement>(".sim-docked-kbd-key").forEach((key) => {
      const char = key.getAttribute("data-key")
      const face = key.firstElementChild as HTMLElement | null
      const label = face?.firstElementChild as HTMLElement | null
      if (!char || !face || !label) return
      face.style.cssText = keyFaceStyles(char, cfg)
      label.style.cssText = keyLabelStyles(char, cfg)
    })
  }

  const sync = () => {
    if (!enabled || !config) return unmount()
    if (!element) return mount()
    // Re-render in place; a config update is usually just a change of disabled keys, and the
    // pointer handlers live on the element.
    element.innerHTML = renderKeyboard(config)
    setCursorWash(cursorActive)
  }

  return {
    setEnabled(next) {
      enabled = next
      sync()
    },
    setConfig(next) {
      const stylingOnlyChange = element && next && config && layoutSignature(next) === layoutSignature(config)
      config = next
      if (stylingOnlyChange) restyleKeys()
      else sync()
    },
  }
}

/** Everything about a config except its per-key styling, so a styling-only update can be spotted. */
const layoutSignature = (cfg: KeyboardConfig): string =>
  JSON.stringify([
    cfg.layout,
    cfg.symbols,
    cfg.highlight,
    cfg.disabled,
    cfg.xl,
    cfg.l,
    cfg.flexGrowSymbols,
    cfg.rowPositioning,
    cfg.keyStyles,
  ])

/** Serializes a style object into inline CSS, so `{ backgroundColor: "red" }` becomes `background-color:red`. */
export const cssText = (styles?: Record<string, string>): string =>
  Object.entries(styles ?? {})
    .map(([prop, value]) => `${prop.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}:${escapeAttr(String(value))}`)
    .join(";")
