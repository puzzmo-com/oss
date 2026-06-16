import type { GameSettingsUIComponents } from "../../types"
import type { SimulatorContext, SimulatorView } from "../types"
import { persistGameSettings, clearGameSettings } from "../state"

/**
 * Settings tab — renders the settings UI the game registered via INITIALIZE_SETTINGS, lets you
 * change values (persisted to localStorage and pushed to the game as SETTINGS_UPDATE, matching the
 * production host) and reflects UPDATE_SETTINGS_FROM_EMBED writes coming from the game.
 */
export function createSettingsView(): SimulatorView {
  const renderContent = (ctx: SimulatorContext): string => {
    const components = ctx.state.settingsComponents
    if (!components || components.length === 0) {
      return `<div class="sim-settings-empty">No settings registered by the game yet.<br>The game calls <code>sdk.settings.initialize(components)</code> to describe its settings UI.</div>`
    }

    const reset = `<div class="sim-settings-actions"><button class="simulator-btn tiny" id="sim-settings-reset">Reset to defaults</button></div>`
    return `<div class="sim-settings-form">${components.map((c) => renderComponent(c, ctx.state.gameSettings)).join("")}</div>${reset}`
  }

  const rerender = (ctx: SimulatorContext) => {
    const content = ctx.getElement<HTMLElement>("#sim-settings-content")
    if (!content) return
    content.innerHTML = renderContent(ctx)
    bindControls(ctx)
  }

  // Persist the current settings and push the full object to the game, like the production host does
  const applySettings = (ctx: SimulatorContext) => {
    persistGameSettings(ctx.state.gameSettings)
    ctx.sendToGame("SETTINGS_UPDATE", ctx.state.gameSettings)
  }

  const bindControls = (ctx: SimulatorContext) => {
    const content = ctx.getElement<HTMLElement>("#sim-settings-content")
    if (!content) return

    content.querySelectorAll<HTMLElement>("[data-setting]").forEach((el) => {
      const name = el.getAttribute("data-setting")!
      const valueType = el.getAttribute("data-setting-type")

      el.addEventListener("change", () => {
        let value: any
        if (el instanceof HTMLInputElement && el.type === "checkbox") value = el.checked
        else if (valueType === "number") value = Number((el as HTMLSelectElement).value)
        else value = (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value

        ctx.state.gameSettings = { ...ctx.state.gameSettings, [name]: value }
        applySettings(ctx)
      })
    })

    content.querySelector("#sim-settings-reset")?.addEventListener("click", () => {
      clearGameSettings()
      ctx.state.gameSettings = defaultsFromComponents(ctx.state.settingsComponents ?? [])
      applySettings(ctx)
      rerender(ctx)
    })
  }

  return {
    id: "settings",
    label: "Set",

    render() {
      return `
        <div class="settings-view-container">
          <div id="sim-settings-content"></div>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      rerender(ctx)
    },

    onMessage(type, data, ctx) {
      if (type === "INITIALIZE_SETTINGS") {
        ctx.state.settingsComponents = data?.components ?? []
        // The game sends its resolved settings (defaults merged with what we put in READY_DATA);
        // saved values win so a stale default from the game can't clobber a stored choice
        ctx.state.gameSettings = { ...data?.settings, ...ctx.state.gameSettings }
        persistGameSettings(ctx.state.gameSettings)
        rerender(ctx)
        return
      }

      if (type === "UPDATE_SETTINGS_FROM_EMBED") {
        ctx.state.gameSettings = { ...ctx.state.gameSettings, ...data?.settings }
        persistGameSettings(ctx.state.gameSettings)
        rerender(ctx)
      }
    },
  }
}

/** Renders a single settings UI component as HTML, reading its current value from `settings` */
function renderComponent(component: GameSettingsUIComponents, settings: Record<string, any>): string {
  switch (component.type) {
    case "title":
      return `<div class="sim-settings-heading">${escapeHTML(component.value)}</div>`
    case "subtitle":
      return `<div class="sim-settings-subheading">${escapeHTML(component.value)}</div>`
    case "paragraph":
      return `<p class="sim-settings-paragraph">${escapeHTML(component.value)}</p>`
    case "separator":
      return `<div class="simulator-divider"></div>`
    case "split":
      return `<div class="sim-settings-split">${component.content.map((c) => renderComponent(c, settings)).join("")}</div>`
    case "boolean": {
      const checked = (settings[component.name] ?? component.defaultValue) ? "checked" : ""
      const subtitle = component.subtitle ? `<div class="sim-settings-subtitle">${escapeHTML(component.subtitle)}</div>` : ""
      return `
        <div class="simulator-field">
          <label class="sim-settings-row">
            <input type="checkbox" data-setting="${component.name}" ${checked} />
            <span class="simulator-label">${escapeHTML(component.title)}</span>
          </label>
          ${subtitle}
        </div>`
    }
    case "enum": {
      const current = settings[component.name] ?? component.defaultValue
      const options = component.values
        .map(
          (v, i) =>
            `<option value="${escapeHTML(v)}" ${v === current ? "selected" : ""}>${escapeHTML(component.displays[i] ?? v)}</option>`,
        )
        .join("")
      return `
        <div class="simulator-field">
          ${fieldLabel(component)}
          <select class="simulator-select" data-setting="${component.name}">${options}</select>
        </div>`
    }
    case "number": {
      const current = settings[component.name] ?? component.defaultValue
      const options = component.values.map((v) => `<option value="${v}" ${v === current ? "selected" : ""}>${v}</option>`).join("")
      return `
        <div class="simulator-field">
          ${fieldLabel(component)}
          <select class="simulator-select" data-setting="${component.name}" data-setting-type="number">${options}</select>
        </div>`
    }
    case "text": {
      const current = String(settings[component.name] ?? component.defaultValue ?? "")
      const input = component.textarea
        ? `<textarea class="simulator-textarea" data-setting="${component.name}">${escapeHTML(current)}</textarea>`
        : `<input class="simulator-input" type="text" data-setting="${component.name}" value="${escapeHTML(current)}" />`
      return `
        <div class="simulator-field">
          ${fieldLabel(component)}
          ${input}
        </div>`
    }
    default:
      return `<div class="sim-settings-unsupported">Unsupported component type: ${escapeHTML((component as any).type)}</div>`
  }
}

/** Title + optional subtitle markup for a value-producing component */
function fieldLabel(component: { title: string; subtitle?: string }): string {
  const subtitle = component.subtitle ? `<div class="sim-settings-subtitle">${escapeHTML(component.subtitle)}</div>` : ""
  return `<span class="simulator-label">${escapeHTML(component.title)}</span>${subtitle}`
}

/** Collects name → defaultValue pairs from components, recursing into split groups */
function defaultsFromComponents(components: GameSettingsUIComponents[]): Record<string, any> {
  const defaults: Record<string, any> = {}
  for (const component of components) {
    if (component.type === "split") Object.assign(defaults, defaultsFromComponents(component.content))
    else if ("name" in component) defaults[component.name] = component.defaultValue
  }
  return defaults
}

function escapeHTML(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
