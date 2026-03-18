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
  /** A variant of the key which is always above a certain level of brightness so that you
   * can show dark text on it for games */
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

  /** The foreground body text color  */
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
  elapsedTimeSecs: number
  additionalTimeAddedSecs: number
  pointsAwarded: number
  completed?: boolean
}

/** Things the server uses for meta-game augmentations */
export type AugmentationConfig = {
  deeds?: Deed[] | Readonly<Deed[]>
}

export type CheckpointConfig = {
  interruptible: boolean
  complete: boolean
}

export type Deed = {
  id: string
  value: any
  textRepresentation?: string | null
}

export type GameOverMessageUIComponent =
  | { type: "md"; text: string }
  | { type: "streak" }
  | { type: "augmentation"; value: string | number; display: string }

export type BootstrapGameData = {
  userState: {
    gameSettings: any
    id: string
    nakamaLogin: string
    ownerID: string
  }
  currentUser: any
  startOrFindGameplay: {
    failed?: boolean | null
    gamePlayed?: {
      additionalTimeAddedSecs: number
      boardState: string
      cheatsUsed: number
      combinedTimeSecs: number
      completed: boolean
      createdAt: any
      elapsedTimeSecs: number
      hintsUsed: number
      id: string
      ownerID: string
      pointsAwarded: number
      resetsUsed: number
      slug: string
      viewerOwnsPuzzle: boolean
      puzzle: {
        id: string
        name?: string | null
        puzzle: string
        seriesNumber: number
        game: {
          assetsPath: string
          assetsSha: string
          displayName: string
          exposedGlobalFunction: string
          jsPath: string
          slug: string
        }
      }
    }
  }
  theme: Theme
  hostFlags: ("sandbox" | "embed" | "desktop" | "native-ios")[]
  hostContext: any[]
  appRuntimeContract: string
}

export type AppBundle = {
  /** Renders a puzzle and optional state string into an SVG  */
  renderThumbnail(puzzleStr: string, inputStr?: string, config?: ThumbnailConfig): string

  /** Takes an input string, and backtracks to a version somewhere between 0-1 for its completion */
  interpolateInputString?: (
    inputStr: string,
    puzzleStr: string,
    // 0-1
    value: number,
  ) => {
    inputStr: string
    display: string
    time?: number
  }

  /** Gives you an indication of how many possible steps are available for interpolation */
  getInterpolatedStepCount?: (inputStr: string) => { count: number }

  /** Gets a share-able string representation of the puzzle */
  getShareString?: (
    inputStr: string,
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
  renderContext?: "preview" | "share" | "completed" | "timeline"
  viewerMetadata?: any | null
}

/** Messages from the SDK to the host */
export type MessagesSentFromEmbed = {
  READY: object
  READY_GAME_LOADED: { state: any; gameRuntimeContract: string; embedRuntimeContract: string }
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
  GAME_COMPLETED: {
    id: string
    input: any
    pipelineStats?: any[]
    config?: {
      deeds?: Deed[] | readonly Deed[]
    }
  }
  SHOW_GAME_COMPLETE_SCREEN: {
    results: GameOverMessageUIComponent[]
    showRetry: boolean
    gameplay: GamePlay
  }
  TIMER_TICK: { display: [string, string] }
  TIMER_SYNC: number
  HIT_CHECKPOINT: {
    checkpointName: string
    gameplay: { inputStr: string; play: Partial<GamePlay> }
    checkpointConfig: CheckpointConfig
    augConfig: AugmentationConfig
  }
}

/** Messages from the host to the SDK */
export type MessagesReceived = {
  READY_DATA: BootstrapGameData
  RESET_DATA: { data: any }
  RETRY_PUZZLE: object
  START_GAME: undefined
  PAUSE_GAME: object
  RESUME_GAME: object
  SETTINGS_UPDATE: any
}
