/** Theme info provided by Puzzmo */
export type Theme = {
  name: string
  type: "light" | "dark"
  key: string
  keyFG: string
  keyStrong: string
  keyLight: string
  g_key: string
  subBrand: string
  subBrandFG: string
  player: string
  playerLight: string
  playerFG: string
  alt1: string
  alt2: string
  alt3: string
  fg: string
  error: string
  alwaysDark: string
  alwaysLight: string
  g_bg: string
  g_bgAlt: string
  g_bgDark: string
  g_textDark: string
  g_textLight: string
  g_blank: string
  g_unsolved: string
  g_outline: string
  a_bg: string
  a_bgAlt: string
  a_infoBG: string
  a_puzmo: string
  a_headerText: string
  a_table: string
  a_tableAlt: string
  a_inlineTag: string
  a_anchor: string
}

/** Gameplay metrics sent to the host */
export type GamePlay = {
  elapsedTimeSecs: number
  additionalTimeAddedSecs: number
  hintsUsed: number
  resetsUsed: number
  metric1: number
  metric2: number
  metric3: number
  metric4: number
  metricStrings: string[]
  pointsAwarded: number
  completed?: boolean
  pipelineStats?: any
  cheatsUsed: number
}

/** Things the server uses for meta-game augmentations */
export type AugmentationConfig = {
  augmentations?: any
  deeds?: Deed[] | Readonly<Deed[]>
}

export type CheckpointConfig = {
  interruptible: boolean
  complete: boolean
  process: "leaderboards"[]
}

export type Deed = {
  id: string
  value: any
  textRepresentation?: string | null
  puzzmoPoints?: number | null
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
      metric1: number
      metric2: number
      metric3: number
      metric4: number
      metricStrings: ReadonlyArray<string>
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

/** Callable thumbnail renderer attached to globalThis */
export type ThumbnailFunction = {
  (puzzleStr: string, inputStr?: string, config?: ThumbnailConfig): string
  interpolate?: (inputStr: string, puzzleStr: string, value: number) => { inputStr: string; display: string; time?: number }
  getStepCount?: (inputStr: string) => { count: number }
  getShareString?: (
    inputStr: string,
    title: string,
    extraData?: { puzzleString: string; dateKey: string; gameplaySlug: string; partnerSlug?: string },
  ) => { str: string }
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
      metric1?: number | null
      metric2?: number | null
      metric3?: number | null
      metric4?: number | null
      metricStrings?: string[] | null
      collabUserReferences: string[]
    }
  }
  GAME_COMPLETED: {
    id: string
    input: any
    pipelineStats?: any[]
    config?: {
      deeds?: Deed[] | readonly Deed[]
      augmentations?: any
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
