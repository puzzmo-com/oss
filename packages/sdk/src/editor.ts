// For now, we will keep these types in here but not mark them as something which should appear in the public SDK docs

import type { Theme } from "./types"

/**
 * The theme passed to an editor bundle. The host sends its full {@link Theme} so editors derive
 * their colors from it rather than making their own theme decisions. Use `theme.type` for
 * light/dark bucketing.
 *
 * The bare `"light" | "dark"` string form is deprecated and will be removed in a future SDK
 * release — editors should handle the full `Theme` object.
 */
export type EditorTheme = Theme | "light" | "dark"

/** Severity level for validation issues */
export type ValidationLevel = "error" | "warning" | "info"

/** Represents a single validation issue found during puzzle validation */
export interface ValidationIssue {
  level: ValidationLevel
  message: string
  line?: number
  col?: number
  length?: number
}

/** Complete validation report for a puzzle */
export interface ValidationReport {
  success: boolean
  issues: ValidationIssue[]
}

export type ImportErrorType = "invalid_format" | "parsing_error" | "unknown"

/** Custom error class for workshop import failures */
export class EditorImportError extends Error {
  constructor(
    public type: ImportErrorType,
    message: string,
    public originalError?: unknown,
  ) {
    super(message)
    this.name = "EditorImportError"
  }
}

/** Result of a successful puzzle import operation */
export interface ImportResult {
  data: string
  warnings?: ValidationIssue[]
  title?: string
  authors?: string[]
  editors?: string[]
}

/** Settings UI descriptor returned by an editor bundle */
export interface EditorBundleSettings<TComponent = unknown> {
  components: TComponent[]
  defaults: Record<string, unknown>
}

/** A preceding/following phrase for a word, returned by the getRelatedWords editor callback */
export interface RelatedWord {
  word: string
  frequency: number
  position: "preceding" | "following"
}

/** Result of fetching a URL from within the editor */
export interface EditorFetchURLResult {
  status: number
  body: string
}

/** Config passed to an editor bundle's mount() */
export interface EditorMountConfig {
  puzzleString: string
  onChange: (puzzleString: string) => void
  theme: EditorTheme
  width: number
  height: number
  /**
   * Optional function for making chat completions from the editor (e.g. for AI-assisted puzzle
   * editing). This needs to be enabled for a team explicitly.
   */
  chatCompletion?: (prompt: string) => Promise<string>
  /**
   * Optional function for fetching URLs from the editor (e.g. for fetching article content).
   * This needs to be enabled for a team explicitly.
   */
  fetchURL?: (url: string) => Promise<EditorFetchURLResult>
  /** Optional function for looking up a word's preceding/following phrases from wordvault. */
  getRelatedWords?: (word: string, limit?: number) => Promise<RelatedWord[]>
  /** Pre-configured editor settings values from the queue's editorSettings. */
  settings?: Record<string, unknown>
}

/** Handle returned by an editor bundle's mount() */
export interface EditorMountHandle {
  unmount: () => void
  /**
   * Called whenever the puzzle string is updated in the editor from the outside, or when the theme
   * or dimensions update. Workshop will rely on the validator to reject / accept updates.
   */
  update: (config: { puzzleString?: string; theme?: EditorTheme; width?: number; height?: number }) => void
}

/** Main interface for a Workshop editor bundle */
export interface EditorBundle<TSettingsComponent = unknown> {
  /** Required validator for puzzle data validation */
  validator: {
    validate(data: string): Promise<ValidationReport> | ValidationReport
  }
  /** Optional importer for converting external puzzle file formats */
  importer?: {
    onImport(filename: string, contents: string | ArrayBuffer): Promise<ImportResult> | ImportResult
  }
  /** Embed-level settings UI, populated from the bundle's declared settings */
  settings?: EditorBundleSettings<TSettingsComponent>
  /** Editor-level settings UI, populated from the bundle's declared editor settings */
  editorSettings?: EditorBundleSettings<TSettingsComponent>
  /** Custom puzzle editor, if provided by the bundle */
  editor?: {
    /** Called when first visiting a puzzle page. */
    mount(element: HTMLElement, config: EditorMountConfig): Promise<EditorMountHandle>
  }
}
