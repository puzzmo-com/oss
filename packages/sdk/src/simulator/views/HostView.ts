import type { HostContext } from "../../types"
import type { HostContextPreset, SimulatorContext, SimulatorView } from "../types"
import { clearHostContext, persistHostContext } from "../state"

// Generic scenarios every game can exercise; game-specific ones (per-game embed settings) arrive
// via `SimulatorConfig.hostContextPresets`. Adapted from the jig's host flag/context presets.
const builtInPresets: HostContextPreset[] = [
  { name: "app (desktop)", context: [{ type: "app", layout: "desktop", host: null }] },
  { name: "app (mobile)", context: [{ type: "app", layout: "mobile", host: null }] },
  { name: "app (ios)", context: [{ type: "app", layout: "mobile", host: "ios-app" }] },
  { name: "embed", context: [{ type: "embed" }] },
  { name: "embed (no UI)", context: [{ type: "embed", noUI: true }] },
  { name: "sandbox", context: [{ type: "sandbox" }] },
]

/**
 * Host tab — edit the `hostContext` array the simulator sends in READY_DATA, so host-context
 * dependent features (embed settings, sandbox mode, mobile layout, …) can be exercised locally.
 * The bootstrap is only read at game boot, so applying a change persists it to localStorage and
 * restarts (reloads) the page — the same flow as the Theme tab.
 */
export function createHostView(gamePresets: HostContextPreset[] = []): SimulatorView {
  const presets = [...builtInPresets, ...gamePresets]

  return {
    id: "host",
    label: "Host",

    render() {
      const options = presets.map((p, i) => `<option value="${i}">${escapeHTML(p.name)}</option>`).join("")
      return `
        <style>
          #simulator-tab-host .host-note { opacity: 0.5; font-size: 10px; margin: 4px 0 8px; }
          #simulator-tab-host .host-error { color: #f66; font-size: 11px; margin-top: 6px; white-space: pre-wrap; }
          #simulator-tab-host .host-actions { display: flex; gap: 6px; margin-top: 8px; }
          #simulator-tab-host .simulator-textarea { min-height: 140px; font-family: monospace; }
        </style>
        <div class="simulator-section">
          <div class="simulator-section-title">Host Context</div>
          <div class="host-note" id="host-source"></div>
          <select class="simulator-select" id="host-presets">
            <option value="">Preset…</option>
            ${options}
          </select>
          <textarea class="simulator-textarea" id="host-json" spellcheck="false"></textarea>
          <div class="host-actions">
            <button class="simulator-btn primary" id="host-apply">Apply &amp; Restart</button>
            <button class="simulator-btn subtle" id="host-reset">Reset</button>
          </div>
          <div class="host-error" id="host-error"></div>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      const jsonEl = ctx.getElement<HTMLTextAreaElement>("#host-json")
      const presetsEl = ctx.getElement<HTMLSelectElement>("#host-presets")
      const errorEl = ctx.getElement<HTMLElement>("#host-error")
      const sourceEl = ctx.getElement<HTMLElement>("#host-source")
      if (!jsonEl || !presetsEl || !errorEl || !sourceEl) return

      jsonEl.value = JSON.stringify(ctx.state.hostContext, null, 2)
      sourceEl.textContent = ctx.state.hostContextIsOverridden
        ? "Using this tab's override. Changes apply on restart."
        : "Using the vite config / default context. Changes apply on restart."

      presetsEl.addEventListener("change", () => {
        const preset = presets[Number(presetsEl.value)]
        if (preset) jsonEl.value = JSON.stringify(preset.context, null, 2)
      })

      ctx.getElement<HTMLButtonElement>("#host-apply")?.addEventListener("click", () => {
        let parsed: unknown
        try {
          parsed = JSON.parse(jsonEl.value)
        } catch (e) {
          errorEl.textContent = `Invalid JSON: ${(e as Error).message}`
          return
        }
        if (!Array.isArray(parsed) || !parsed.every((c) => c && typeof c === "object" && typeof c.type === "string")) {
          errorEl.textContent = `hostContext must be an array of { type: string, ... } objects`
          return
        }
        console.log("Simulator: hostContext changed, reloading...", parsed)
        persistHostContext(parsed as HostContext[])
        window.location.reload()
      })

      ctx.getElement<HTMLButtonElement>("#host-reset")?.addEventListener("click", () => {
        clearHostContext()
        window.location.reload()
      })
    },
  }
}

/** Minimal HTML-escape so preset names can't break the simulator markup. */
function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
