/**
 * Theme info provided by Puzzmo. We have scoped prefixes for domain specific areas.
 * The comments in JSDoc are based on Puzzmo's light theme colour scheme.
 */
export type Theme = {
  /** Themes display name */
  name: string
  /** How should it be bucketed? */
  type: "light" | "dark"
  /** The bright Pink */
  key: string // "#FFAAAC"
  /** The color to draw on a key */
  keyFG: string // "#000000",
  /** A bolder version of the bright pink */
  keyStrong: string // "#F7868B"
  /** A lighter version of the bright pink */
  keyLight: string // "#FFD2D3"
  /**
   * A variant of the key which is always above a certain level of brightness so that you
   * can show dark text on it for games
   */
  g_key: string // "#FFAAAC"

  /** A secondary color for the brand, in Puzzmo's case this is the puzzmo yellow */
  subBrand: string
  /** Foreground color for the secondary */
  subBrandFG: string

  /** The blue you traditionally see around a user avatar and selection */
  player: string //"#5DBAFC"
  /** A lighter variant on the user's blue */
  playerLight: string //"#9EDDFF"
  /** Text for on a background of player */
  playerFG: string // "#000000",

  /** Alt color, this one is an earthy green in the main theme */
  alt1: string // "#98B389"
  /** Alt color 2, this one is a faded yellow which looks quite like the puzmo yellow */
  alt2: string // "#FAC16C"
  /** Alt color 3, this one is a cute purple */
  alt3: string // "#D298FF"

  /** The foreground body text color */
  fg: string // "#000000"
  /** The red for showing errors */
  error: string // "#FF3C3C"

  /** Stays dark regardless of being in light/dark mode */
  alwaysDark: string // "#1B1D29"
  /** Stays light regardless of being in light/dark mode */
  alwaysLight: string // "#FFFFFF"

  /** The 'tile' usually */
  g_bg: string // "#FFFFFF"
  /** The 'tile' alternative in checkered patterns */
  g_bgAlt: string // "#EBEBEB"
  /** Sorta useful for content layers on the existing bg, a darker version */
  g_bgDark: string // "#D6D6D6"
  /** When _the text_ is on a light background, this is basically black */
  g_textDark: string // "#1B1B28"
  /** When _the text_ is dark background, this is white */
  g_textLight: string // "#FFFFFF"
  /** For voids in a game, this is black */
  g_blank: string // "#000000"
  /** For when a tile is not yet solved, this is a lighter grey */
  g_unsolved: string // "#C2C2C2"
  /** Border for a game frame, for example the crossword edge */
  g_outline: string // "#1B1D29"

  /** The light grey you see as the background for most pages */
  a_bg: string // "#F2F2F2"
  /** The darker grey which usually is seen as borders in the background */
  a_bgAlt: string // "#ECECEC"
  /** Used in the info bar BG */
  a_infoBG: string // "#FFFFFF"
  /** The yellow shade of the puzmonaut */
  a_puzmo: string // "#FFC000"
  /** Header colors */
  a_headerText: string // "#000000"
  /** When tabulating results, the background color for an even table row */
  a_table: string // "#EDEDED"
  /** When tabulating results, the background color for an odd table row */
  a_tableAlt: string // "#F4F4F4"
  /** Inline tag bg - used in the tagged friends */
  a_inlineTag: string // "#D9D9D9"
  /** Used to indicate a link */
  a_anchor: string // "#1F97EE"
}

/** Gameplay metrics sent to the host */
export type GamePlay = {
  /** The player's serialized progress. Game-facing APIs call this `inputString`; `boardState` is the wire/database name. */
  boardState: string
  elapsedTimeSecs: number
  additionalTimeAddedSecs: number
  pointsAwarded: number
  completed?: boolean
}

/** The play a game reports to `gameCompleted()` — pass progress as `inputString`. */
export type GameCompletedPlay = Omit<GamePlay, "boardState" | "elapsedTimeSecs" | "additionalTimeAddedSecs"> &
  Partial<Pick<GamePlay, "elapsedTimeSecs" | "additionalTimeAddedSecs">> & { inputString: string }

/** Things the server uses for meta-game augmentations */
export type AugmentationConfig = {
  deeds?: Deed[] | Readonly<Deed[]>
  /**
   * StableIDs of leaderboards declared with `hidden: true` that this play should surface. Lets a game pick which of
   * its extra leaderboards are worth showing for a given play. Only read at completion — ignored at checkpoints.
   *
   * Each stableID must belong to a leaderboard this game declared as `hidden: true` in its augmentations; anything
   * else is dropped server-side, as is anything past the first 12.
   */
  showLeaderboards?: string[] | readonly string[]
}

export type CheckpointConfig = {
  /** Can the system show ads at this checkpoint */
  interruptible: boolean
  /** Has the game gone on enough to auto-complete */
  complete: boolean
  /** Which parts of the completion pipeline to process at this checkpoint (e.g. `["leaderboards"]`). Empty means nothing is processed. */
  process: "leaderboards"[]
}

export type Deed = PipelineDeed | PersistedDeed

/** A deed only used inside the completion pipeline for the play it came from */
export type PipelineDeed = {
  id: string
  value: any
  textRepresentation?: string | null
  persist?: never
}

/**
 * A deed stored on the player's long-term history — persisted values must be numbers (and they will be persisted as ints after being
 * floored.)
 */
export type PersistedDeed = {
  id: string
  value: number
  textRepresentation?: string | null
  /** Store this deed on the player's long-term history, not just this play's completion pipeline */
  persist: true
}

/** A UI component the game asks the host to render in the post-game completion sidebar */
export type GameOverMessageUIComponent =
  | { type: "md"; text: string }
  | { type: "streak" }
  | { type: "augmentation"; value: string | number; display: string }

export type BootstrapGameData = {
  /** Per-user state scoped to this game (settings and identity). */
  userState: {
    /** Player's saved settings for all games, keyed by game slug; each value's shape is owned by that game. */
    gameSettings: any
    /** ID of the UserState record. */
    id: string
    /** ID of the user who owns this UserState record. */
    ownerID: string
  }
  /** The currently signed-in Puzzmo user, or null when the viewer is anonymous. */
  currentUser: BootstrapCurrentUser | null
  /** Result of starting a new GamePlay or resuming the player's existing one. */
  startOrFindGameplay: {
    /** The GamePlay record to bootstrap the game with. */
    gamePlayed: {
      /** Serialized game-specific board state. */
      boardState: string
      /** ID of the user who owns this gameplay. */
      ownerID: string
      /** True when the viewer owns the underlying puzzle (vs. viewing someone else's). */
      viewerOwnsPuzzle: boolean
      /** Whether the player has finished the puzzle. */
      completed: boolean
      /** When this GamePlay was created. */
      createdAt: string

      /** Points awarded for this gameplay (0 until completion). */
      pointsAwarded: number
      /** Seconds added to the clock (e.g. from hint penalties or time bonuses). */
      additionalTimeAddedSecs: number
      /** ElapsedTimeSecs + additionalTimeAddedSecs, precomputed for convenience. */
      combinedTimeSecs: number
      /** Seconds the player has spent solving (clock time, excluding penalties/bonuses). */
      elapsedTimeSecs: number

      /** GamePlay db row ID. */
      id: string
      /** URL-safe identifier for this gameplay. */
      slug: string

      /** The puzzle being played. */
      puzzle: {
        /** Puzzle row ID. */
        id: string
        /** Editor-assigned name; null for untitled puzzles. */
        name?: string | null
        /** Serialized puzzle definition; opaque to the host and parsed by the game bundle. */
        puzzle: string
        /** Metadata for the game bundle that renders this puzzle. */
        game: any
        /** Most recent daily schedule entry that uses this puzzle, if any. */
        mostRecentDaily?: {
          daily?: {
            /** A date key like "2023-04-01" */
            dateKey?: string
            /** Whether this daily is for today. If not true then its an archived game of some sort. */
            isToday?: boolean
          }
        } | null
      }
    }
  }
  /** Color scheme and design tokens the game should render with. */
  theme: Theme
  /** Structured context the host provides to the game. */
  hostContext: HostContext[]
  /** Version string for the host<->game runtime contract; bumped on breaking changes. */
  appRuntimeContract: string
  /**
   * Physical safe-area insets (CSS px) of the host viewport, e.g. the iOS home-indicator gap. Games render
   * full-bleed in the app, so inset your own content by these while your background paints to the screen
   * edge. `env(safe-area-inset-*)` reads 0 inside the game iframe, so the host measures and passes them here.
   */
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number }
}

/** The subset of the Puzzmo user that's exposed to games at bootstrap. */
export type BootstrapCurrentUser = {
  /** Stable user ID; safe to log and correlate across systems. */
  id: string
  /** Display name chosen by the user; null when the user hasn't set one. */
  name: string | null
  /** Handle, e.g. "ortatherox". */
  username: string
  /** Disambiguator appended to username (e.g. "puz" in "orta#puz"). */
  usernameID: string
  /** Subscription tier — games may gate cosmetic/bonus features by this. */
  type: "Paid" | "Unverified" | "User"
  /** Comma-separated internal roles (e.g. "admin,moderator"); empty string for normal users. */
  roles: string
}

/** The "app" variant of hostContext — describes the runtime layout/host that's rendering the game. */
export type AppHostContext = {
  type: "app"
  /** "mobile" when the game is being rendered at a phone-sized layout, otherwise "desktop". */
  layout: "desktop" | "mobile"
  /** Which host is rendering the game; null = puzzmo.com on web. */
  host: null | string
}

/**
 * The "embed" variant — the game is running inside a partner-page embed. Per-game settings live
 * under the game's slug; their shape is owned by the game (hosts pass them through verbatim).
 */
export type EmbedHostContext = {
  type: "embed"
  /** Hide the host-provided chrome around the game. */
  noUI?: boolean
  /** The embed record driving this page, when known. */
  embedID?: string
  /** Puzzle strings for bonus puzzles playable after the main puzzle. */
  bonusPuzzles?: string[]
  /** Game-specific embed settings keyed by game slug (e.g. `crossword: {...}`). */
  [gameSlug: string]: unknown
}

/** The "sandbox" variant — the game is hosted in a puzzle-editing sandbox (e.g. the workshop). */
export type SandboxHostContext = {
  type: "sandbox"
  /** Game-specific sandbox settings keyed by game slug (e.g. `crossword: { fill: true }`). */
  [gameSlug: string]: unknown
}

/** The "server-config" variant — infrastructure endpoints the host wants the game to use. */
export type ServerConfigHostContext = {
  type: "server-config"
  /** The URL of the multiplayer server */
  multiplayerServerURL?: string
  /** The URL of the singleplayer server */
  printServerURL?: string
}

/** Host-provided context the SDK surfaces to games. Extend as more variants are needed. */
export type HostContext = AppHostContext | EmbedHostContext | SandboxHostContext | ServerConfigHostContext

/** An SVG thumbnail plus its intrinsic pixel dimensions, so consumers can size it without parsing the SVG. */
export type ThumbnailResult = {
  svg: string
  width: number
  height: number
}

export type AppBundle = {
  /** Renders a puzzle and optional state string into an SVG and its dimensions */
  renderThumbnail(puzzleString: string, inputString?: string, config?: ThumbnailConfig): ThumbnailResult

  /** Takes an input string, and backtracks to a version somewhere between 0-1 for its completion */
  interpolateInputString?: (
    inputString: string,
    puzzleString: string,
    // 0-1
    value: number,
  ) => {
    // The returned property stays `inputStr` — hosts read it at runtime, renaming it is a protocol change
    inputStr: string
    display: string
    time?: number
  }

  /** Gives you an indication of how many possible steps are available for interpolation */
  getInterpolatedStepCount?: (inputString: string) => { count: number }

  /** Gets a share-able string representation of the puzzle */
  getShareString?: (
    inputString: string,
    title: string,
    extraData?: { puzzleString: string; dateKey: string; gameplaySlug: string; partnerSlug?: string },
  ) => {
    str: string
  }
}

/** Configuration passed to thumbnail renderers */
export type ThumbnailConfig = {
  theme: Theme
  viewerIsOwner: boolean
  optForReadability?: boolean
  strict?: true
  /** @deprecated check for gameplay.completed instead */
  completed?: boolean
  gameplay?: Partial<GamePlay>
  renderHost?: "game" | "app" | "opengraph"
  renderContext?: "preview" | "share" | "completed" | "timeline" | "print"
  viewerMetadata?: any | null
}

/**
 * Configuration for the Puzzmo on-screen keyboard shown on touch devices.
 *
 * Keys in the layout are single characters. Special/action keys should use non-alphabet
 * Unicode characters (e.g. `"⌫"` for backspace, `"↵"` for enter) so they don't conflict
 * with letter input. Map those characters to display labels via `symbols`.
 *
 * @example
 *   // Simple QWERTY keyboard — a good starting point for word games
 *
 *   const config: KeyboardConfig = {
 *     layout: ["qwertyuiop", "asdfghjkl", "↵zxcvbnm⌫", undefined],
 *     symbols: { "↵": "Enter", "⌫": "bsp" },
 *     highlight: ["↵", "⌫"],
 *     disabled: [],
 *     xl: [],
 *     l: ["↵", "⌫"],
 *     supportsDragCursor: false,
 *   }
 *
 * @example
 *   // Crossword keyboard — complex layout with two panels, direction controls, and drag cursor.
 *   // Special characters are used as action key tokens; symbols maps them to display labels.
 *   // The "∂" key flips cursor direction; "≤"/"≥" move between cells; "✱" switches panels.
 *
 *   const crosswordConfig: KeyboardConfig = {
 *     layout: ["qwertyuiop", "∂asdfghjkl⟳", "≤✱zxcvbnm⌫≥"],
 *     symbols: {
 *       "∂": "flip-down", // switches cursor direction (emitted as key press "∂")
 *       "⟳": "flip-across", // alternate direction flip
 *       "≤": "prev", // move cursor to previous cell
 *       "≥": "next", // move cursor to next cell
 *       "✱": "123", // switch to number/rebus panel
 *       "⌫": "bsp", // backspace
 *     },
 *     highlight: ["∂", "⟳", "≤", "≥", "✱", "⌫"],
 *     disabled: [],
 *     xl: [],
 *     l: [],
 *     supportsDragCursor: true, // enables the drag-to-position cursor feature
 *   }
 */
export type KeyboardConfig = {
  /**
   * The key rows to render. Up to 4 rows — pass `undefined` for the 4th row to omit it.
   * Each string is one row; each character is one key. Use non-letter Unicode characters
   * for action keys (backspace, enter, panel-switch, etc.) to avoid input conflicts.
   *
   * Accepts either a 4-tuple `[row1, row2, row3, row4 | undefined]` or a plain array of
   * strings/nulls (null renders an empty row).
   *
   * @example
   *   ;["qwertyuiop", "asdfghjkl", "↵zxcvbnm⌫", undefined]
   */
  layout: [string, string, string, string | undefined] | (string | null)[]

  /**
   * Maps action-key tokens to the label string displayed on the key face.
   * The token character is what the game receives in a `keyboardKeyPress` event;
   * the label is purely visual.
   *
   * @example
   *   { "⌫": "bsp", "↵": "Enter", "✱": "123" }
   */
  symbols: Record<string, string>

  /**
   * Keys that should render with the highlight/accent background color.
   * Typically used for action keys (backspace, enter, direction keys) so they
   * stand out from the letter keys.
   *
   * @example
   *   ;["↵", "⌫"]
   */
  highlight: string[]

  /**
   * Keys that are non-interactive and visually dimmed.
   * Update this array dynamically to disable letters that are no longer valid
   * for the current game state (e.g. letters already placed in a word game).
   *
   * @example
   *   ;["q", "z", "x"] // letters unavailable given current board state
   */
  disabled: string[]

  /**
   * Keys that should render at extra-large width (~17.85% of the keyboard row).
   * Use for high-priority action keys like spacebar or a main confirm key.
   *
   * @example
   *   ;["␣"]
   */
  xl: string[]

  /**
   * Keys that should render at large width (~14.7% of the keyboard row).
   * Use for secondary action keys like Enter and Backspace that need more touch area.
   *
   * @example
   *   ;["↵", "⌫"]
   */
  l: string[]

  /**
   * When `true`, the keyboard renders a drag cursor — the player can press-and-hold then
   * drag across the keys to position a cursor before releasing to confirm a character.
   * Listen for `keyboardCursorChange` and `keyboardCursorEnd` events to handle this.
   *
   * Only enable if your game has a spatial input model that benefits from drag-cursor
   * positioning (e.g. selecting a cell in a grid).
   */
  supportsDragCursor: boolean

  /**
   * Controls horizontal alignment for each row. Index matches the `layout` row index.
   * Defaults to `"center"` for any row not listed.
   *
   * @example
   *   ;["center", "center", "end", "center"]
   */
  rowPositioning?: ("end" | "start" | "center" | undefined)[]

  /**
   * Keys that expand to fill remaining horizontal space in their row (flex-grow).
   * Useful for a spacebar key that should stretch across the bottom row.
   *
   * @example
   *   ;["␣"]
   */
  flexGrowSymbols?: string[]

  /**
   * CSS properties applied to every key face. Use for font overrides or color tweaks
   * that apply uniformly across the keyboard.
   *
   * @example
   *   { textTransform: "lowercase", color: "#888" }
   */
  keyStyles?: Record<string, string>

  /**
   * CSS properties applied to the keyboard container element. Use for positioning or
   * background tweaks that apply to the whole keyboard.
   */
  kbdStyles?: Record<string, string>
}

/**
 * Declarative description of a game's settings UI. The game sends these to the host via
 * `sdk.settings.initialize` and the host renders them in its settings panel. Components with a
 * `name` are value-producing (their `defaultValue` seeds the settings object); the rest are
 * presentational (titles, paragraphs, separators). Any component may set `hidden: true` to keep
 * seeding its `defaultValue` while removing it from the host's settings panel.
 */
export type GameSettingsUIComponents =
  /** A section heading, rendered with a rule underneath. */
  | { id: string; type: "title"; value: string; hidden?: boolean }
  /** A smaller sub-heading. */
  | { id: string; type: "subtitle"; value: string; hidden?: boolean }
  /** A block of explanatory body text. */
  | { id: string; type: "paragraph"; value: string; hidden?: boolean }
  /** A free-text field writing `name`; set `textarea` for a multi-line box. */
  | {
      id: string
      type: "text"
      name: string
      defaultValue: string
      title: string
      subtitle?: string
      textarea?: true
      hidden?: boolean
    }
  /** A numeric picker writing `name`, offering `values` as the choices. */
  | { id: string; type: "number"; name: string; defaultValue: number; values: number[]; title: string; subtitle?: string; hidden?: boolean }
  /** An on/off toggle writing `name`. */
  | { id: string; type: "boolean"; name: string; defaultValue: boolean; title: string; subtitle?: string; hidden?: boolean }
  /** A pick-one dropdown writing `name`. `displays` are the human labels, parallel to `values`. */
  | {
      id: string
      type: "enum"
      name: string
      defaultValue: string
      values: string[]
      displays: string[]
      title: string
      subtitle?: string
      hidden?: boolean
    }
  /** A pick-many toggle row writing `name` as a string array. `displays` are the human labels, parallel to `values`. */
  | {
      id: string
      type: "multiselect"
      name: string
      /** The subset of `values` selected by default. */
      defaultValue: string[]
      values: string[]
      displays: string[]
      title: string
      subtitle?: string
      hidden?: boolean
    }
  /** A horizontal rule between components. */
  | { id: string; type: "separator"; key: string; hidden?: boolean }
  /** Lays out its `content` components side by side in one row. */
  | { id: string; type: "split"; content: GameSettingsUIComponents[]; hidden?: boolean }

/** Messages from the SDK to the host */
export type MessagesSentFromEmbed = {
  /** Tells the host to send back the bootstrap data (puzzle, theme, gameplay state). Send once on startup via `sdk.gameReady()`. */
  READY: object
  /** Signals that the game has finished loading and is ready to start. The host will respond with `START_GAME`. */
  READY_GAME_LOADED: { state: any; gameRuntimeContract: string; embedRuntimeContract: string }
  /** Persist the current in-progress game state to the API. Call this after every meaningful player action. */
  UPLOAD_NEW_GAME_STATE: {
    id: string
    input: {
      elapsedTimeSecs?: number | null
      additionalTimeAddedSecs?: number | null
      pauses?: number | null
      hintsUsed?: number | null
      resetsUsed?: number | null
      cheatsUsed?: number | null
      boardState?: string | null
      collabUserReferences: string[]
    }
  }
  /** Upload the final completed game state. Triggers scoring, deeds, and augmentations on the host. */
  GAME_COMPLETED: {
    /** The gameplay ID returned from `READY_DATA`. */
    id: string
    /** See CompleteGamePlayedInput — elapsed time, board state, score, etc. */
    input: any
    config?: {
      /** Interesting values from the game used for scoring and stats (e.g. points, time). */
      deeds?: Deed[] | readonly Deed[]
      /** StableIDs of leaderboards declared with `hidden: true` that this play should surface. */
      showLeaderboards?: string[] | readonly string[]
    }
  }
  /** Ask the host to show the post-game completion screen. Send after `GAME_COMPLETED`. */
  SHOW_GAME_COMPLETE_SCREEN: {
    /**
     * Components to render in the completion sidebar: `md` items show as rich text under a
     * "Congrats!" section, `streak` expands into the player's streak stats, and `augmentation`
     * items become label/value rows in the stats table.
     */
    results: GameOverMessageUIComponent[]
    /** Reserved for a host play-again button — no host renders one yet. The SDK always sends true. */
    showRetry: boolean
  }
  /** Update the timer display string shown in the host UI. Sent automatically by the SDK every 500ms. */
  TIMER_TICK: { display: [string, string] }
  /**
   * Sync the authoritative elapsed time to the host. Used for idle detection and co-op collab state.
   * Sent automatically by the SDK every 10 seconds.
   */
  TIMER_SYNC: number
  /**
   * Show or update the on-screen keyboard. Pass the full config each time — the host replaces its entire state. To hide, call
   * `sdk.keyboard.hide()`.
   */
  KEYBOARD_UPDATE_CONFIG: KeyboardConfig
  /**
   * Register the game's settings UI with the host. The host renders `components` in its settings
   * panel and replies with `SETTINGS_UPDATE` whenever the player changes a value.
   */
  INITIALIZE_SETTINGS: {
    /** The current resolved settings values (component defaults merged with the player's saved values). */
    settings: any
    /** The declarative description of the settings UI. */
    components: GameSettingsUIComponents[]
    /** Settings forced by the host/puzzle which the player cannot change. */
    forceSettings?: any | null
  }
  /** The game changed settings itself (e.g. an in-game settings screen). The host persists them for the player. */
  UPDATE_SETTINGS_FROM_EMBED: {
    settings: any
  }
  /** Notify the host that a named checkpoint was reached (e.g. completing a sub-puzzle or bonus round). */
  HIT_CHECKPOINT: {
    checkpointName: string
    gameplay: { inputStr: string; play: Partial<GamePlay> }
    checkpointConfig: CheckpointConfig
    augConfig: AugmentationConfig
  }
}

/** Messages from the host to the SDK */
export type MessagesReceived = {
  /** The bootstrap payload containing puzzle data, theme, and existing gameplay state. Received in response to `READY`. */
  READY_DATA: BootstrapGameData
  /** Sent by REPLs and dev tooling to reset the game with a revised puzzle string without a full reload. */
  RESET_DATA: { data: any }
  /** The player requested a fresh attempt at the same puzzle. Reset all game state and restart. */
  RETRY_PUZZLE: object
  /** The host is ready — start the game clock and begin accepting player input. */
  START_GAME: undefined
  /** The host paused the game (e.g. player switched tabs or app moved to background). Freeze input and pause the timer. */
  PAUSE_GAME: object
  /** The host resumed the game after a pause. Restore input and resume the timer. */
  RESUME_GAME: object
  /** The player changed a game setting. The payload is the full updated settings object for this game. */
  SETTINGS_UPDATE: any
  /** A key on the on-screen keyboard was tapped. `key` is the raw character token from the layout. */
  KEYBOARD_KEY_PRESS: { key: string }
  /** The drag cursor moved to a new position while the player holds on the keyboard. Only fires when `supportsDragCursor` is `true`. */
  KEYBOARD_CURSOR_CHANGE: { position: [number, number] }
  /** The player lifted their finger, ending a drag-cursor gesture. Only fires when `supportsDragCursor` is `true`. */
  KEYBOARD_CURSOR_END: object
}
