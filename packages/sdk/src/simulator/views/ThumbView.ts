import type { AppBundle, ThumbnailConfig } from "../../types"
import type { SimulatorContext, SimulatorView } from "../types"
import { persistRenderContext, persistRenderHost } from "../state"

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

export interface ThumbViewExtended extends SimulatorView {
  updatePreview: (ctx: SimulatorContext) => void
}

export function createThumbView(): ThumbViewExtended {
  const updatePreview = (ctx: SimulatorContext) => {
    const previewEl = ctx.getElement<HTMLElement>("#simulator-thumb-preview")
    const fnEl = ctx.getElement<HTMLElement>("#simulator-thumb-fn")

    // Match the page background (theme) behind the thumbnail SVG.
    previewEl?.style.setProperty("--sim-thumb-bg", ctx.state.selectedTheme.g_bg)

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

      const svgString = thumbFn.fn(puzzleStr, ctx.state.currentInputStr, thumbnailConfig)
      if (previewEl) previewEl.innerHTML = svgString
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
            <span class="simulator-label">Thumbnail Preview</span>
            <button class="simulator-btn tiny" id="simulator-thumb-refresh">Refresh</button>
          </div>
          <div id="simulator-thumb-preview">
            <span class="simulator-empty">No thumbnail function found</span>
          </div>
          <div id="simulator-thumb-fn"></div>
          <div class="simulator-divider"></div>
          <div class="simulator-field">
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
      const renderContextField = ctx.getElement<HTMLElement>("#simulator-render-context-field")

      const updateContextVisibility = () => {
        if (renderContextField) {
          renderContextField.style.display = ctx.state.renderHost === "opengraph" ? "block" : "none"
        }
      }

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
          updateContextVisibility()
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

      updateContextVisibility()
    },

    onActivate(ctx: SimulatorContext) {
      // Defer to allow thumbnail function to be registered
      setTimeout(() => ctx.updateThumbnail(), 0)
    },

    updatePreview,
  }
}
