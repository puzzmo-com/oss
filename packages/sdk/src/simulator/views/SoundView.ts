import type { SimulatorContext, SimulatorView } from "../types"

interface SoundEvent {
  id: string
  haptic?: string
  time: string
}

/**
 * Sound tab — the host side of a game's audio. Games play their own sounds, so this is about the
 * parts the host owns: the sound-enabled gate (games boot muted, so this is what lets you hear
 * anything) and a log of the cues the game asked us for, with any haptic it wanted.
 */
export function createSoundView(): SimulatorView {
  const events: SoundEvent[] = []
  let soundEnabled = true

  const renderList = (): string => {
    if (events.length === 0) return `<div class="sound-empty">No sensory events yet. Play the game to hear from it.</div>`
    return events
      .map(
        (e) =>
          `<div class="sound-row"><span class="sound-id">${escapeHTML(e.id)}</span>${
            e.haptic ? `<span class="sound-haptic">${escapeHTML(e.haptic)}</span>` : ""
          }<span class="sound-time">${e.time}</span></div>`,
      )
      .join("")
  }

  const refresh = (ctx: SimulatorContext) => {
    const list = ctx.getElement<HTMLElement>("#sound-events")
    if (list) list.innerHTML = renderList()
    ctx.updateBadge("sound", events.length)
  }

  return {
    id: "sound",
    label: "Sound",

    render() {
      return `
        <style>
          #simulator-tab-sound .sound-row { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; font-family: monospace; font-size: 11px; }
          #simulator-tab-sound .sound-id { color: var(--accent, #6cf); }
          #simulator-tab-sound .sound-haptic { opacity: 0.7; }
          #simulator-tab-sound .sound-time { opacity: 0.5; }
          #simulator-tab-sound .sound-empty { opacity: 0.5; font-size: 11px; padding: 4px 0; }
          #simulator-tab-sound .sound-controls { margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
          #simulator-tab-sound .sound-toggle { font-size: 11px; display: flex; align-items: center; gap: 4px; }
        </style>
        <div class="simulator-section">
          <div class="simulator-section-title">Sensory Events</div>
          <div class="sound-controls">
            <label class="sound-toggle"><input type="checkbox" id="sound-enabled" ${soundEnabled ? "checked" : ""} /> Sound enabled</label>
            <button class="simulator-btn" id="sound-clear">Clear</button>
          </div>
          <div id="sound-events">${renderList()}</div>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      const clearBtn = ctx.getElement<HTMLButtonElement>("#sound-clear")
      clearBtn?.addEventListener("click", () => {
        events.length = 0
        refresh(ctx)
      })

      // Games boot muted and wait for the host, so tell it where the toggle sits on every bind
      const enabledBox = ctx.getElement<HTMLInputElement>("#sound-enabled")
      enabledBox?.addEventListener("change", () => {
        soundEnabled = Boolean(enabledBox.checked)
        ctx.sendToGame("SOUND_ENABLED", { enabled: soundEnabled })
      })
      ctx.sendToGame("SOUND_ENABLED", { enabled: soundEnabled })
    },

    onMessage(type: string, data: any, ctx: SimulatorContext) {
      // bind() runs before the game is listening, so the gate has to be re-sent once it boots,
      // which is what the production host does too. Without this the game stays muted all session.
      if (type === "READY_GAME_LOADED") {
        ctx.sendToGame("SOUND_ENABLED", { enabled: soundEnabled })
        return
      }

      if (type !== "SENSORY_EVENT") return
      // Cues are objects; a bare string is a game still on the legacy host-resolves-it path.
      const id = typeof data === "string" ? data : (data?.id ?? JSON.stringify(data))
      events.unshift({ id, haptic: typeof data === "string" ? undefined : data?.haptic, time: timeNow() })
      if (events.length > 100) events.pop()
      refresh(ctx)
    },
  }
}

/** Current wall-clock time as HH:MM:SS, matching the simulator's message log formatting. */
function timeNow(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

/** Minimal HTML-escape so event ids can't break the simulator markup. */
function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
