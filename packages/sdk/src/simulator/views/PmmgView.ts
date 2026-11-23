import { spritesIn, TableBoard, type TableBoardFrame, type TableBoardLook } from "../../tableBoard"
import type { TableBoardCapability, TableBoardNode } from "../../types"
import { drawPmmgOverlay, nodeAt, type PmmgOverlayToggles, type PmmgOverlayView } from "../pmmgOverlay"
import { createPmmgRenderer, loadPmmgFonts, type PmmgRenderPhase, type PmmgRenderer, type SimulatorSprite } from "../pmmgRenderer"
import { getStoredPmmgPrefs, persistPmmgPrefs, type PmmgPrefs } from "../state"
import type { SimulatorContext, SimulatorView } from "../types"

/** What a board is given, as a neighbour's is */
type Move = { puzzle: string; input: string }

const overlayToggles: [keyof PmmgOverlayToggles, string, string][] = [
  ["bounds", "Bounds", "The scene's width and height"],
  ["grid", "Grid", "Lines every grid step, for a scene that sets grid"],
  ["boxes", "Boxes", "Each sprite's box, as it's turned and scaled"],
  ["anchors", "Anchors", "Each node's anchor; hollow for a node with no sprite"],
  ["keys", "Keys", "Each node's key"],
]

const phaseLabels: Record<PmmgRenderPhase, string> = {
  render: "render threw",
  sprites: "A sprite couldn't be made",
  scene: "Puzzmo would refuse this scene",
}

/**
 * The Pmmg tab, shown when the game has a pmmg bundle: its table board drawn by Puzzmo's own renderer as the game is
 * played, with a debug overlay, every sprite it has made, and the scene it returned
 */
export function createPmmgView(loadBundle: () => Promise<unknown>): SimulatorView {
  const prefs = getStoredPmmgPrefs()
  let ctx!: SimulatorContext
  let loading: Promise<void> | null = null
  let busy = false
  let loadError: string | null = null
  let renderer: PmmgRenderer | null = null
  let contract: unknown
  let fonts: string[] = []
  let fontWarnings: string[] = []
  let board: TableBoard | null = null
  /** The board gave up after failing, as a neighbour's does */
  let stopped = false
  let frame: TableBoardFrame | null = null
  let hovered: string | null = null
  /** A sprite picked here or on the board, outlined wherever it's drawn */
  let selected: string | null = null
  // What neighbours would see: the game's table state once it sends any, until then its session's puzzle and saves
  let source: "table" | "session" = "session"
  let tablePuzzle: string | null = null
  /** The latest two moves, the newest last, for replaying the last one */
  const moves: Move[] = []
  /** A move came in while the tab was hidden */
  let behind = false

  const el = <T extends HTMLElement>(id: string) => ctx.getElement<T>(`#sim-pmmg-${id}`)

  const overlay = (): PmmgOverlayView => ({
    bounds: prefs.bounds,
    grid: prefs.grid,
    boxes: prefs.boxes,
    anchors: prefs.anchors,
    keys: prefs.keys,
    boxOf: (id) => renderer?.anySprite(id),
    hovered,
    highlighted: selected,
    devicePixelRatio: window.devicePixelRatio || 1,
  })

  /** What the host would say about where the board is shown, from the tab's choices */
  const look = (): TableBoardLook => ({
    fidelity: prefs.fidelity,
    backgroundStyle: prefs.backgroundStyle === "theme" ? undefined : prefs.backgroundStyle,
  })

  const currentMove = (): Move | null => {
    if (moves.length) return moves[moves.length - 1]
    const puzzle = ctx.state.puzzleData
    return puzzle === null ? null : { puzzle, input: ctx.state.currentInputStr }
  }

  const load = async () => {
    loadError = null
    busy = true
    refresh()
    try {
      const mod = (await loadBundle()) as { default?: unknown } | null
      const bundle = (mod?.default ?? mod) as { table?: TableBoardCapability } | null
      const table = bundle?.table
      if (!table || typeof table.render !== "function") {
        loadError = "The pmmg bundle has no table capability: export default createPmmgBundle({ table: { contract: 1, render } })"
        return
      }
      contract = table.contract
      fonts = Array.isArray(table.fonts) ? table.fonts.filter((font) => typeof font === "string") : []
      const loaded = await loadPmmgFonts(table.fonts)
      fontWarnings = loaded.warnings
      if (contract !== 1) fontWarnings.push(`contract is ${JSON.stringify(contract)}, and Puzzmo knows contract 1`)
      renderer = createPmmgRenderer(table, { fontFaces: loaded.fontFaces })
      renderer.onRender = () => refresh()
    } catch (error) {
      loadError = `The pmmg bundle didn't load: ${messageOf(error)}`
      // Tried again the next time the tab opens
      loading = null
    } finally {
      busy = false
    }
  }

  const activate = async () => {
    await (loading ??= load())
    if (renderer && !board) start(false)
    else if (behind && prefs.follow) catchUp()
    refresh()
  }

  /** A new board showing the latest move, or animating into it from the one before */
  const start = (replay: boolean) => {
    const current = currentMove()
    const canvas = el<HTMLCanvasElement>("canvas")
    const stage = el("stage")
    if (!renderer || !current || !canvas || !stage) return refresh()
    board?.dispose()
    stopped = false
    frame = null
    hovered = null
    const created = new TableBoard(canvas, renderer, "simulator", () => {
      if (board !== created) return
      stopped = true
      refresh()
    })
    board = created
    created.onDrawn = (drawn) => {
      if (board !== created) return
      frame = drawn
      drawPmmgOverlay(drawn, overlay())
    }
    created.resize(stage.clientWidth, stage.clientHeight)
    // The look and theme first: a board without a theme queues updates, and two queued would skip the first
    created.setLook(look())
    created.setTheme(ctx.state.selectedTheme)
    const previous = replay ? moves[moves.length - 2] : undefined
    if (previous) created.update(previous)
    created.update(current)
    behind = false
    refresh()
  }

  const catchUp = () => {
    const move = currentMove()
    if (board && move) board.update(move)
    behind = false
  }

  const push = (move: Move) => {
    const last = moves[moves.length - 1]
    if (last && last.puzzle === move.puzzle && last.input === move.input) return
    moves.push(move)
    if (moves.length > 2) moves.shift()
    const showing = ctx.state.activeTab === "pmmg"
    if (showing && renderer && !board) start(false)
    else if (prefs.follow && showing && board) board.update(move)
    else if (prefs.follow) behind = true
    updateReplay()
  }

  const updateReplay = () => {
    const replay = el<HTMLButtonElement>("replay")
    if (replay) replay.disabled = !renderer || moves.length < 2
  }

  const refresh = () => {
    if (!ctx) return
    renderStatus()
    updateReplay()
    renderStats()
    renderProblems()
    const count = el("sprite-count")
    const latest = renderer?.latest
    if (count) count.textContent = latest ? ` ${renderer!.spritesAt(latest.update.pixelsPerUnit).length}` : ""
    if (prefs.subtab === "sprites") renderSprites()
    if (prefs.subtab === "scene") renderScene()
  }

  const renderStatus = () => {
    const status = el("status")
    if (!status) return
    if (loadError) return void (status.innerHTML = `<span class="pmmg-error">${escapeHTML(loadError)}</span>`)
    if (!renderer) return void (status.textContent = busy ? "Loading the pmmg bundle…" : "Open this tab to load the pmmg bundle")
    const from =
      source === "table"
        ? "Drawing what neighbours see: the game's UPDATE_TABLE_GAME_STATE"
        : "Drawing the session's puzzle and saves, as the game hasn't sent UPDATE_TABLE_GAME_STATE (sdk.table.updateGameState)"
    const waiting = currentMove() ? "" : `<div class="pmmg-dim">Waiting for the game's first state</div>`
    status.innerHTML = `
      <div>table · contract ${escapeHTML(String(contract))} · fonts: ${escapeHTML(fonts.join(", ") || "none")}</div>
      <div class="pmmg-dim">${escapeHTML(from)}</div>${waiting}`
  }

  const renderStats = () => {
    const stats = el("stats")
    const report = renderer?.latest
    if (!stats) return
    if (!report) return void (stats.textContent = "")
    const scene = report.scene
    const lines = [
      scene && [
        `${number(scene.width)}×${number(scene.height)} units`,
        `${scene.nodes.length} nodes`,
        `${scene.effects?.length ?? 0} effects`,
        scene.grid && `grid ${number(scene.grid)}`,
      ],
      [
        `render #${report.render}: ${number(report.renderMs)} ms`,
        report.spritesMs && `${number(report.spritesMs)} ms of SVG`,
        `made ${report.made.length}`,
        `${number(report.update.pixelsPerUnit)} px/unit`,
        report.update.skipped && `${report.update.skipped} skipped`,
      ],
    ]
    const text = lines
      .filter((line) => !!line)
      .map((line) => (line as unknown[]).filter(Boolean).join(" · "))
      .map((line) => `<div>${escapeHTML(line)}</div>`)
    if (matchMedia("(prefers-reduced-motion: reduce)").matches)
      text.push(`<div class="pmmg-dim">Reduced motion is on, so changes show at once, as they do at the table</div>`)
    stats.innerHTML = text.join("")
  }

  const renderProblems = () => {
    const problems = el("problems")
    if (!problems) return
    const report = renderer?.latest
    const rows: string[] = []
    if (report?.error) {
      const stack = report.error.stack && report.error.stack !== report.error.message ? report.error.stack : ""
      rows.push(`<div class="pmmg-problem error"><b>${phaseLabels[report.error.phase]}</b> ${escapeHTML(report.error.message)}
        ${stack ? `<details><summary>Stack</summary><pre class="pmmg-json">${escapeHTML(stack)}</pre></details>` : ""}</div>`)
    }
    if (stopped)
      rows.push(
        `<div class="pmmg-problem error">The board stopped, as a neighbour's does after its renders fail. Redraw to start again.</div>`,
      )
    for (const warning of [...fontWarnings, ...(renderer?.warnings ?? [])])
      rows.push(`<div class="pmmg-problem warn">${escapeHTML(warning)}</div>`)
    if (renderer)
      rows.push(
        `<div class="pmmg-problem note">The bundle runs in this page here. At the table it runs in a worker with no DOM and no network, so anything that reaches for window, document or fetch only works here.</div>`,
      )
    problems.innerHTML = rows.join("")
  }

  const renderSprites = () => {
    const list = el("sprites")
    const summary = el("sprite-summary")
    if (!list || !summary) return
    const report = renderer?.latest
    if (!renderer || !report) {
      list.replaceChildren()
      summary.textContent = renderer ? "Nothing rendered yet" : ""
      renderDetail([])
      return
    }
    const ppu = report.update.pixelsPerUnit
    const all = renderer.spritesAt(ppu).sort((a, b) => a.id.localeCompare(b.id))
    const used = report.scene ? spritesIn(report.scene) : null
    const filter = (el<HTMLInputElement>("filter")?.value ?? "").trim().toLowerCase()
    const shown = filter ? all.filter((sprite) => sprite.id.toLowerCase().includes(filter)) : all
    const unused = used ? all.filter((sprite) => !used.has(sprite.id)).length : 0
    const others = renderer.resolutions().filter((resolution) => resolution !== ppu)
    summary.textContent = [
      `${all.length} at ${number(ppu)} px/unit`,
      unused && `${unused} not in this scene`,
      others.length && `also made at ${others.map(number).join(", ")}`,
      filter && `${shown.length} match`,
    ]
      .filter(Boolean)
      .join(" · ")
    list.replaceChildren(...shown.map((sprite) => spriteTile(sprite, used)))
    renderDetail(all)
  }

  const spriteTile = (sprite: SimulatorSprite, used: Set<string> | null) => {
    const tile = document.createElement("button")
    tile.type = "button"
    tile.className = `pmmg-sprite${used && !used.has(sprite.id) ? " unused" : ""}${sprite.id === selected ? " selected" : ""}`
    tile.title = `${sprite.id}\n${number(sprite.width)}×${number(sprite.height)} units, ${sprite.kind}${used && !used.has(sprite.id) ? ", not in this scene" : ""}`
    const picture = document.createElement("span")
    picture.className = "pmmg-sprite-picture"
    picture.append(spriteCanvas(sprite, 72, 64))
    const id = document.createElement("span")
    id.className = "pmmg-sprite-id"
    id.textContent = sprite.id
    const meta = document.createElement("span")
    meta.className = "pmmg-sprite-meta"
    meta.textContent = `${number(sprite.width)}×${number(sprite.height)} ${sprite.kind}`
    tile.append(picture, id, meta)
    tile.addEventListener("click", () => select(selected === sprite.id ? null : sprite.id))
    return tile
  }

  const renderDetail = (all: SimulatorSprite[]) => {
    const detail = el("detail")
    if (!detail) return
    const sprite = selected ? all.find((candidate) => candidate.id === selected) : undefined
    if (!sprite) return void (detail.innerHTML = "")
    const users = usersOf(sprite.id)
    detail.innerHTML = `
      <div class="pmmg-detail">
        <div class="pmmg-detail-head">
          <span class="pmmg-detail-id">${escapeHTML(sprite.id)}</span>
          <button class="simulator-btn tiny" type="button" data-pmmg-deselect>Close</button>
        </div>
        <div class="pmmg-detail-picture"></div>
        <dl class="pmmg-facts">
          <dt>Kind</dt><dd>${sprite.kind === "svg" ? "SVG markup" : "Drawn on a canvas"}</dd>
          <dt>Box</dt><dd>${number(sprite.width)}×${number(sprite.height)} units, anchor ${number(sprite.anchor[0])}, ${number(sprite.anchor[1])}</dd>
          <dt>Pixels</dt><dd>${sprite.bitmap.width}×${sprite.bitmap.height} at ${number(sprite.pixelsPerUnit)} px/unit</dd>
          <dt>Made</dt><dd>render #${sprite.render}</dd>
          <dt>Used by</dt><dd>${users.length ? escapeHTML(users.slice(0, 24).join(", ") + (users.length > 24 ? `, and ${users.length - 24} more` : "")) : "nothing in this scene"}</dd>
        </dl>
        ${sprite.svg ? `<details><summary>SVG, ${sprite.svg.length.toLocaleString()} characters</summary><pre class="pmmg-json">${escapeHTML(sprite.svg)}</pre></details>` : ""}
      </div>`
    detail.querySelector(".pmmg-detail-picture")?.append(spriteCanvas(sprite, 300, 160))
    detail.querySelector("[data-pmmg-deselect]")?.addEventListener("click", () => select(null))
  }

  /** The keys of every node in the latest scene that shows a sprite, itself or in a keyframe */
  const usersOf = (spriteID: string) => {
    const scene = renderer?.latest?.scene
    if (!scene) return []
    const inFrames = (node: TableBoardNode) =>
      [node.enter, node.exit].some((run) => run?.keyframes.some((frame) => frame.sprite === spriteID))
    const nodes = scene.nodes.filter((node) => node.sprite === spriteID || inFrames(node)).map((node) => node.key)
    const effects = (scene.effects ?? [])
      .filter((effect) => effect.keyframes.some((frame) => frame.sprite === spriteID))
      .map((effect) => `${effect.key} (effect)`)
    return [...nodes, ...effects]
  }

  const select = (spriteID: string | null) => {
    selected = spriteID
    if (prefs.subtab === "sprites") renderSprites()
    board?.redraw()
  }

  const renderScene = () => {
    const update = el("update")
    const scene = el("scene")
    const report = renderer?.latest
    if (!update || !scene) return
    if (!report) {
      update.textContent = ""
      scene.textContent = renderer ? "Nothing rendered yet" : ""
      return
    }
    update.textContent = [
      `render #${report.render}`,
      `puzzle ${report.update.puzzle.length.toLocaleString()} chars`,
      `input ${report.update.input.length.toLocaleString()} chars`,
      report.update.previous ? "animating from the board before" : "first draw",
      `${report.update.skipped} skipped`,
      `${report.update.fidelity} fidelity on ${report.update.backgroundStyle}`,
      report.scene ? "as Puzzmo keeps it" : "as returned, since Puzzmo refused it",
    ].join(" · ")
    scene.textContent = json(report.scene ?? report.raw)
  }

  const showSubtab = () => {
    const root = el("root")
    root?.querySelectorAll<HTMLElement>("[data-pmmg-subtab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.pmmgSubtab === prefs.subtab)
    })
    root?.querySelectorAll<HTMLElement>("[data-pmmg-pane]").forEach((pane) => {
      pane.classList.toggle("active", pane.dataset.pmmgPane === prefs.subtab)
    })
    refresh()
  }

  /** Where the pointer is on the board, in board units */
  const pointOn = (event: MouseEvent): [number, number] | null => {
    const canvas = el<HTMLCanvasElement>("canvas")
    if (!canvas || !frame) return null
    const rect = canvas.getBoundingClientRect()
    if (!rect.width) return null
    const ratio = canvas.width / rect.width
    return [((event.clientX - rect.left) * ratio) / frame.scale, ((event.clientY - rect.top) * ratio) / frame.scale]
  }

  const describe = (point: [number, number] | null) => {
    const hover = el("hover")
    if (!hover) return
    const drawn = point && frame ? nodeAt(frame.nodes, point, (id) => renderer?.anySprite(id)) : null
    const node = drawn ? frame!.scene.nodes.find((candidate) => candidate.key === drawn.key) : undefined
    const key = drawn?.key ?? null
    if (key !== hovered) {
      hovered = key
      board?.redraw()
    }
    if (!point) return void (hover.textContent = "Hover the board to see a node, click one to pick its sprite")
    if (!drawn) return void (hover.textContent = `${number(point[0])}, ${number(point[1])}`)
    const facts = [
      drawn.key,
      drawn.sprite,
      node && `at ${number(node.x)}, ${number(node.y)}`,
      node?.rotation && `${number(node.rotation)}°`,
      node?.scale && `scale ${node.scale.map(number).join(", ")}`,
      node?.opacity !== undefined && `opacity ${number(node.opacity)}`,
      node?.tint && `tint ${node.tint}`,
      node?.brightness !== undefined && `brightness ${number(node.brightness)}`,
      node?.blend && node.blend !== "normal" && node.blend,
      node?.parent && `in ${node.parent}`,
      drawn.exiting && "exiting",
    ]
    hover.textContent = facts.filter(Boolean).join(" · ")
  }

  return {
    id: "pmmg",
    label: "Pmmg",

    render() {
      return `
        <div class="pmmg-view pmmg-backdrop-${prefs.backdrop}" id="sim-pmmg-root">
          <div class="pmmg-status" id="sim-pmmg-status">Open this tab to load the pmmg bundle</div>
          <div class="data-subtabs">
            <button class="data-subtab" type="button" data-pmmg-subtab="layout">Layout</button>
            <button class="data-subtab" type="button" data-pmmg-subtab="sprites">Sprites<span id="sim-pmmg-sprite-count"></span></button>
            <button class="data-subtab" type="button" data-pmmg-subtab="scene">Scene</button>
          </div>
          <div class="pmmg-pane" data-pmmg-pane="layout">
            <div class="pmmg-actions">
              <button class="simulator-btn tiny" type="button" id="sim-pmmg-replay" title="Draws the move before the last, then animates into the last" disabled>Replay last move</button>
              <button class="simulator-btn tiny" type="button" id="sim-pmmg-redraw" title="A new board, showing the latest move">Redraw</button>
              <label class="pmmg-check" title="Each new move animates in, as a neighbour's board would"><input type="checkbox" data-pmmg-pref="follow" /> Follow game</label>
            </div>
            <div class="pmmg-actions">
              <label class="pmmg-check" title="High for a neighbour beside the player, low for a board seen in passing, like an ambient table or the lobby's">
                Fidelity
                <select class="simulator-select" id="sim-pmmg-fidelity">
                  <option value="high">High</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label class="pmmg-check" title="Whether what's behind the board is dark or light: Puzzmo uses the game's felt when it has a scheme, and the theme's otherwise">
                Background
                <select class="simulator-select" id="sim-pmmg-background-style">
                  <option value="theme">Theme's</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
            </div>
            <div class="pmmg-stage" id="sim-pmmg-stage"><canvas class="pmmg-backdrop" id="sim-pmmg-canvas"></canvas></div>
            <div class="pmmg-hover" id="sim-pmmg-hover">Hover the board to see a node, click one to pick its sprite</div>
            <div class="pmmg-toggles">
              ${overlayToggles.map(([key, label, title]) => `<label class="pmmg-check" title="${title}"><input type="checkbox" data-pmmg-pref="${key}" /> ${label}</label>`).join("")}
              <select class="simulator-select pmmg-backdrop-select" id="sim-pmmg-backdrop" title="What's behind the board">
                <option value="checker">Checker</option>
                <option value="theme">Theme bg</option>
                <option value="black">Black</option>
                <option value="white">White</option>
              </select>
            </div>
            <div class="pmmg-stats" id="sim-pmmg-stats"></div>
            <div class="pmmg-problems" id="sim-pmmg-problems"></div>
          </div>
          <div class="pmmg-pane" data-pmmg-pane="sprites">
            <div class="pmmg-actions">
              <input class="simulator-input" id="sim-pmmg-filter" placeholder="Filter by ID" />
              <button class="simulator-btn tiny" type="button" id="sim-pmmg-clear" title="Forgets every sprite, as a new table would, and draws again">Clear sprites</button>
            </div>
            <div class="pmmg-stats" id="sim-pmmg-sprite-summary"></div>
            <div id="sim-pmmg-detail"></div>
            <div class="pmmg-sprites" id="sim-pmmg-sprites"></div>
          </div>
          <div class="pmmg-pane" data-pmmg-pane="scene">
            <div class="pmmg-stats" id="sim-pmmg-update"></div>
            <pre class="pmmg-json" id="sim-pmmg-scene"></pre>
          </div>
        </div>
      `
    },

    bind(context) {
      ctx = context
      const root = el("root")
      if (!root) return
      root.style.setProperty("--pmmg-theme-bg", ctx.state.selectedTheme.g_bg)

      root.querySelectorAll<HTMLButtonElement>("[data-pmmg-subtab]").forEach((button) => {
        button.addEventListener("click", () => {
          prefs.subtab = button.dataset.pmmgSubtab as PmmgPrefs["subtab"]
          persistPmmgPrefs(prefs)
          showSubtab()
        })
      })

      root.querySelectorAll<HTMLInputElement>("[data-pmmg-pref]").forEach((input) => {
        const key = input.dataset.pmmgPref as keyof PmmgOverlayToggles | "follow"
        input.checked = prefs[key]
        input.addEventListener("change", () => {
          prefs[key] = input.checked
          persistPmmgPrefs(prefs)
          if (key === "follow" && input.checked) catchUp()
          board?.redraw()
        })
      })

      const backdrop = el<HTMLSelectElement>("backdrop")
      if (backdrop) {
        backdrop.value = prefs.backdrop
        backdrop.addEventListener("change", () => {
          prefs.backdrop = backdrop.value as PmmgPrefs["backdrop"]
          persistPmmgPrefs(prefs)
          root.className = `pmmg-view pmmg-backdrop-${prefs.backdrop}`
        })
      }

      const fidelity = el<HTMLSelectElement>("fidelity")
      if (fidelity) {
        fidelity.value = prefs.fidelity
        fidelity.addEventListener("change", () => {
          prefs.fidelity = fidelity.value as PmmgPrefs["fidelity"]
          persistPmmgPrefs(prefs)
          board?.setLook(look())
        })
      }

      const backgroundStyle = el<HTMLSelectElement>("background-style")
      if (backgroundStyle) {
        backgroundStyle.options[0].textContent = `Theme's (${ctx.state.selectedTheme.type})`
        backgroundStyle.value = prefs.backgroundStyle
        backgroundStyle.addEventListener("change", () => {
          prefs.backgroundStyle = backgroundStyle.value as PmmgPrefs["backgroundStyle"]
          persistPmmgPrefs(prefs)
          board?.setLook(look())
        })
      }

      el("replay")?.addEventListener("click", () => start(true))
      el("redraw")?.addEventListener("click", () => start(false))
      el("clear")?.addEventListener("click", () => {
        renderer?.clear()
        start(false)
      })
      el("filter")?.addEventListener("input", () => renderSprites())

      const canvas = el<HTMLCanvasElement>("canvas")
      canvas?.addEventListener("mousemove", (event) => describe(pointOn(event)))
      canvas?.addEventListener("mouseleave", () => describe(null))
      canvas?.addEventListener("click", (event) => {
        const point = pointOn(event)
        const drawn = point && frame ? nodeAt(frame.nodes, point, (id) => renderer?.anySprite(id)) : null
        if (drawn?.sprite) select(selected === drawn.sprite ? null : drawn.sprite)
      })

      const stage = el("stage")
      if (stage) new ResizeObserver(([entry]) => board?.resize(entry.contentRect.width, entry.contentRect.height)).observe(stage)

      showSubtab()
    },

    onActivate() {
      void activate()
    },

    onMessage(type, data, context) {
      if (type === "UPDATE_TABLE_GAME_STATE" && typeof data?.inputString === "string") {
        if (typeof data.puzzleString === "string") tablePuzzle = data.puzzleString
        const puzzle = tablePuzzle ?? context.state.puzzleData
        if (puzzle === null) return
        if (source !== "table") {
          source = "table"
          moves.length = 0
        }
        push({ puzzle, input: data.inputString })
      } else if (type === "UPLOAD_NEW_GAME_STATE" && source === "session") {
        const input = data?.input?.boardState ?? data?.boardState
        const puzzle = context.state.puzzleData
        if (typeof input === "string" && puzzle !== null) push({ puzzle, input })
      } else if (type === "READY_GAME_LOADED" && context.state.activeTab === "pmmg") {
        void activate()
      }
    },
  }
}

/** A sprite's picture on a canvas fitted inside a box, enlarged in whole pixels so its real pixels show, with its anchor */
const spriteCanvas = (sprite: SimulatorSprite, maxWidth: number, maxHeight: number) => {
  const dpr = window.devicePixelRatio || 1
  const { bitmap } = sprite
  const fit = Math.min(maxWidth / (bitmap.width / dpr), maxHeight / (bitmap.height / dpr), 8)
  const cssWidth = Math.max(1, (bitmap.width / dpr) * fit)
  const cssHeight = Math.max(1, (bitmap.height / dpr) * fit)
  const canvas = document.createElement("canvas")
  canvas.className = "pmmg-backdrop"
  canvas.width = Math.max(1, Math.round(cssWidth * dpr))
  canvas.height = Math.max(1, Math.round(cssHeight * dpr))
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas
  ctx.imageSmoothingEnabled = fit < 1
  try {
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  } catch {
    // Its bitmap was let go: made again since, or the sprites were cleared
  }
  const x = (sprite.anchor[0] / sprite.width) * canvas.width
  const y = (sprite.anchor[1] / sprite.height) * canvas.height
  const arm = 4 * dpr
  ctx.strokeStyle = "#f472b6"
  ctx.lineWidth = dpr
  ctx.beginPath()
  ctx.moveTo(x - arm, y)
  ctx.lineTo(x + arm, y)
  ctx.moveTo(x, y - arm)
  ctx.lineTo(x, y + arm)
  ctx.stroke()
  return canvas
}

const number = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""))

const json = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

const escapeHTML = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
