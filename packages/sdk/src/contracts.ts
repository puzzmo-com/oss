// Dependency-free public contracts for the SDK's plugin + simulator extension points.
//
// This module deliberately imports NOTHING: it's exported as the `@puzzmo/sdk/contracts` subpath so
// consumers under strict NodeNext module resolution can import the real types. (The main `@puzzmo/sdk`
// entry's declarations use bundler-style extensionless re-exports, which NodeNext can't follow — they
// degrade to `any`. A self-contained module sidesteps that.) The plugin types here are the canonical
// definitions; `plugins.ts` re-exports them so there's a single source of truth.

/** The SDK-owned timer methods exposed to plugins. */
export interface SDKTimer {
  /** Get elapsed time in milliseconds */
  timeMs: () => number
  /** Get elapsed time in seconds */
  timeSecs: () => number
  /** Get added/penalty time in milliseconds */
  addedTimeMs: () => number
  /** Get added/penalty time in seconds */
  addedTimeSecs: () => number
  /** Get elapsed time without penalties in seconds */
  timeWithoutPenaltySecs: () => number
  /** Get formatted display strings [elapsed, added] */
  display: () => [string, string]
  /** Add penalty time in milliseconds */
  addPenalty: (ms: number) => void
  /** Check if timer is paused */
  isPaused: () => boolean
  /** Check if timer has been started */
  isRunning: () => boolean
}

/**
 * The bootstrap payload exposed to plugins. `currentUser` is typed for convenience; the rest of the
 * host payload (`startOrFindGameplay`, `theme`, `hostContext`, …) is reachable via the index
 * signature so this stays self-contained and doesn't have to restate the full `BootstrapGameData`.
 */
export interface SDKPluginBootstrap {
  /** The signed-in Puzzmo user, or null when the viewer is anonymous. */
  currentUser?: {
    id?: string
    name?: string | null
    username?: string
    usernameID?: string
    type?: string
    roles?: string
    /** Nakama account id for multiplayer; null when not logged into Nakama. */
    nakamaID?: string | null
  } | null
  [key: string]: any
}

/**
 * The low-level seam a plugin is handed in `setup`. It exposes the same host transport the core SDK
 * uses, so a plugin can send/receive message types the slim core does not surface itself (e.g.
 * `SENSORY_EVENT`, `SIDEBAR_UPDATE`, the `COLLAB_*` family). The host already understands the full
 * protocol; plugins just opt extra channels back in.
 */
export interface SDKPluginContext {
  /** Send a host message. The type is intentionally open so plugins can use the full protocol. */
  send: (type: string, json: unknown) => void
  /** Subscribe to a host message by type. Returns an unsubscribe function. */
  on: (type: string, handler: (data: any) => void) => () => void
  /** The SDK-owned timer (read-only for plugins; the SDK still drives it). */
  timer: SDKTimer
  /** The resolved bootstrap payload, or null until `gameReady()` has resolved. */
  bootstrap: () => SDKPluginBootstrap | null
}

/**
 * A Puzzmo SDK plugin. `setup` wires up host messaging and returns the plugin's public API, which is
 * hung off `sdk.plugins[name]`. Keep `name` a string literal so the `sdk.plugins` map stays typed.
 */
export interface SDKPlugin<Name extends string = string, API = unknown> {
  /** Unique key the returned API is exposed under (`sdk.plugins[name]`). */
  name: Name
  /** Wire up host messaging and return the plugin's public API. */
  setup: (ctx: SDKPluginContext) => API
}

/** Maps a tuple of plugins to the `{ [name]: API }` shape exposed at `sdk.plugins`. */
export type PluginAPIs<Plugins extends readonly SDKPlugin[]> = {
  [Plugin in Plugins[number] as Plugin["name"]]: Plugin extends SDKPlugin<string, infer API> ? API : never
}

/** The simulator context a plugin-provided view renders into (the subset views use). */
export interface SimulatorContext {
  /** Find an element inside the simulator panel by selector. */
  getElement: <T extends HTMLElement>(selector: string) => T | null
  /** Update the badge count on this view's tab. Pass 0/undefined to hide it. */
  updateBadge: (tabId: string, count: number | undefined) => void
  /** Send a host→game message down to the game (the simulator acts as the host). */
  sendToGame: (type: string, data: any) => void
}

/** A simulator tab/view a plugin contributes via `createSimulator({ views })`. */
export interface SimulatorView {
  /** Tab id (also the message-badge key). */
  id: string
  /** Tab label. */
  label: string
  /** Returns the tab's HTML. */
  render(): string
  /** Wire up event listeners after render. */
  bind(context: SimulatorContext): void
  /** Called when the tab becomes active. */
  onActivate?(context: SimulatorContext): void
  /** Handle a message coming from the game. */
  onMessage?(type: string, data: any, context: SimulatorContext): void
}
