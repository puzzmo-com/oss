import type { AppBundle, ThumbnailConfig } from "../../types"
import { normalizeThumbnailResult } from "../normalizeThumbnail"
import type { PreviewKind, SimulatorContext, SimulatorView } from "../types"
import { persistPreviewKind, persistRenderContext, persistRenderHost } from "../state"

/** Find thumbnail function on globalThis (looks for functions ending in "Thumbnail") */
function findThumbnailFn(): { name: string; fn: AppBundle["renderThumbnail"] } | null {
  const globalObj = globalThis as Record<string, unknown>
  for (const key of Object.keys(globalObj)) {
    if (key.endsWith("Thumbnail") && typeof globalObj[key] === "function") {
      return { name: key, fn: globalObj[key] as AppBundle["renderThumbnail"] }
    }
  }
  return null
}

/** The bundle's `getShareString` (if any), exposed to the sim via vite.ts's bundle loader. */
function findShareStringFn(): AppBundle["getShareString"] | null {
  const fn = (globalThis as Record<string, unknown>).getShareString
  return typeof fn === "function" ? (fn as NonNullable<AppBundle["getShareString"]>) : null
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function todayDateKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function titleFromSlug(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

/** Shown when Preview Kind = Text but the bundle doesn't export `getShareString`. */
const missingShareStringHtml = `
  <div class="simulator-share-missing">
    <p>The app bundle doesn't export <code>getShareString</code>.</p>
    <p>Add it to your app bundle to preview share strings here:</p>
    <pre>export const getShareString: AppBundle["getShareString"] = (
  inputStr, title, { puzzleString, dateKey, gameplaySlug },
) =&gt; ({ str: \`\${title}: ...\` })</pre>
  </div>
`

export interface ThumbViewExtended extends SimulatorView {
  updatePreview: (ctx: SimulatorContext) => void
}

export function createThumbView(): ThumbViewExtended {
  const updatePreview = (ctx: SimulatorContext) => {
    const previewEl = ctx.getElement<HTMLElement>("#simulator-thumb-preview")
    const fnEl = ctx.getElement<HTMLElement>("#simulator-thumb-fn")

    // Match the page background (theme) behind the thumbnail SVG.
    previewEl?.style.setProperty("--sim-thumb-bg", ctx.state.selectedTheme.g_bg)

    if (ctx.state.previewKind === "text") {
      const shareFn = findShareStringFn()
      if (!shareFn) {
        if (previewEl) previewEl.innerHTML = missingShareStringHtml
        if (fnEl) fnEl.textContent = ""
        return
      }
      if (fnEl) fnEl.textContent = "Using: getShareString()"

      try {
        const slug = ctx.gameSlug ?? "game"
        const result = shareFn(ctx.state.currentInputStr ?? "", titleFromSlug(slug), {
          puzzleString: ctx.state.puzzleData ?? "",
          dateKey: todayDateKey(),
          gameplaySlug: `simulator:${slug}`,
        })
        const str = result?.str ?? ""
        if (previewEl) {
          previewEl.innerHTML = `<pre class="simulator-share-preview" style="color: ${ctx.state.selectedTheme.fg}">${escapeHtml(str)}</pre>`
        }
      } catch (e) {
        console.error("Simulator: Share string error", e)
        if (previewEl) previewEl.innerHTML = `<span class="simulator-empty">Error: ${e}</span>`
      }
      return
    }

    const thumbFn = findThumbnailFn()
    if (!thumbFn) {
      if (previewEl) previewEl.innerHTML = '<span class="simulator-empty">No thumbnail function found</span>'
      if (fnEl) fnEl.textContent = ""
      return
    }

    if (fnEl) fnEl.textContent = `Using: ${thumbFn.name}()`

    try {
      const puzzleStr = ctx.state.puzzleData ?? ""

      const thumbnailConfig: ThumbnailConfig = {
        viewerIsOwner: true,
        theme: ctx.state.selectedTheme,
        strict: true,
        renderHost: ctx.state.renderHost,
        renderContext: ctx.state.renderContext,
      }

      const { svg } = normalizeThumbnailResult(thumbFn.fn(puzzleStr, ctx.state.currentInputStr, thumbnailConfig))
      if (previewEl) previewEl.innerHTML = svg
    } catch (e) {
      console.error("Simulator: Thumbnail error", e)
      if (previewEl) previewEl.innerHTML = `<span class="simulator-empty">Error: ${e}</span>`
    }
  }

  return {
    id: "thumb",
    label: "Thumb",

    render() {
      return `
        <div class="thumb-view-container">
          <div class="thumb-header">
            <span class="simulator-label">Preview</span>
            <button class="simulator-btn tiny" id="simulator-thumb-refresh">Refresh</button>
          </div>
          <div class="simulator-segmented" id="simulator-preview-kind" role="tablist">
            <button class="simulator-segmented-btn" data-preview-kind="image" type="button" role="tab">Image</button>
            <button class="simulator-segmented-btn" data-preview-kind="text" type="button" role="tab">Text</button>
          </div>
          <div id="simulator-thumb-preview">
            <span class="simulator-empty">No thumbnail function found</span>
          </div>
          <div id="simulator-thumb-fn"></div>
          <div class="simulator-divider"></div>
          <div class="simulator-field" id="simulator-render-host-field">
            <label class="simulator-label">Render Host</label>
            <select class="simulator-select" id="simulator-render-host-select">
              <option value="game">game</option>
              <option value="app">app</option>
              <option value="opengraph">opengraph</option>
            </select>
          </div>
          <div class="simulator-field" id="simulator-render-context-field" style="display: none;">
            <label class="simulator-label">Render Context</label>
            <select class="simulator-select" id="simulator-render-context-select">
              <option value="preview">preview</option>
              <option value="share">share</option>
              <option value="completed">completed</option>
              <option value="timeline">timeline</option>
            </select>
          </div>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      const refreshBtn = ctx.getElement<HTMLButtonElement>("#simulator-thumb-refresh")
      refreshBtn?.addEventListener("click", () => ctx.updateThumbnail())

      const renderHostSelect = ctx.getElement<HTMLSelectElement>("#simulator-render-host-select")
      const renderContextSelect = ctx.getElement<HTMLSelectElement>("#simulator-render-context-select")
      const renderHostField = ctx.getElement<HTMLElement>("#simulator-render-host-field")
      const renderContextField = ctx.getElement<HTMLElement>("#simulator-render-context-field")
      const previewKindContainer = ctx.getElement<HTMLElement>("#simulator-preview-kind")

      // Render Context is only meaningful for opengraph; render host + context are only meaningful for image previews.
      const applyFieldVisibility = () => {
        const isImage = ctx.state.previewKind !== "text"
        if (renderHostField) renderHostField.style.display = isImage ? "block" : "none"
        if (renderContextField) {
          renderContextField.style.display = isImage && ctx.state.renderHost === "opengraph" ? "block" : "none"
        }
      }

      const applySegmentedActive = () => {
        previewKindContainer?.querySelectorAll<HTMLButtonElement>(".simulator-segmented-btn").forEach((btn) => {
          const kind = btn.dataset.previewKind as PreviewKind | undefined
          btn.classList.toggle("active", kind === ctx.state.previewKind)
          btn.setAttribute("aria-selected", kind === ctx.state.previewKind ? "true" : "false")
        })
      }

      previewKindContainer?.querySelectorAll<HTMLButtonElement>(".simulator-segmented-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const kind = btn.dataset.previewKind as PreviewKind | undefined
          if (!kind || kind === ctx.state.previewKind) return
          ctx.state.previewKind = kind
          persistPreviewKind(kind)
          applySegmentedActive()
          applyFieldVisibility()
          ctx.updateThumbnail()
        })
      })

      // Initialize render host select
      if (renderHostSelect) {
        // Default to "game" if not set
        if (!ctx.state.renderHost) {
          ctx.state.renderHost = "game"
          persistRenderHost(ctx.state.renderHost)
        }
        renderHostSelect.value = ctx.state.renderHost || "game"

        renderHostSelect.addEventListener("change", () => {
          ctx.state.renderHost = renderHostSelect.value as ThumbnailConfig["renderHost"]
          persistRenderHost(ctx.state.renderHost)
          applyFieldVisibility()
          ctx.updateThumbnail()
        })
      }

      // Initialize render context select
      if (renderContextSelect) {
        // Default to "preview" if not set
        if (!ctx.state.renderContext) {
          ctx.state.renderContext = "preview"
          persistRenderContext(ctx.state.renderContext)
        }
        renderContextSelect.value = ctx.state.renderContext || "preview"

        renderContextSelect.addEventListener("change", () => {
          ctx.state.renderContext = renderContextSelect.value as ThumbnailConfig["renderContext"]
          persistRenderContext(ctx.state.renderContext)
          ctx.updateThumbnail()
        })
      }

      applySegmentedActive()
      applyFieldVisibility()
    },

    onActivate(ctx: SimulatorContext) {
      // Defer to allow thumbnail function to be registered
      setTimeout(() => ctx.updateThumbnail(), 0)
    },

    updatePreview,
  }
}
