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

/** Main interface for a Workshop bundle */
export interface EditorBundle<TSettingsComponent = unknown> {
  validator: {
    validate(data: string): Promise<ValidationReport> | ValidationReport
  }
  importer?: {
    onImport(filename: string, contents: string | ArrayBuffer): Promise<ImportResult> | ImportResult
  }
  /** Embed-level settings UI, populated from the bundle's declared settings */
  settings?: EditorBundleSettings<TSettingsComponent>
  /** Editor-level settings UI, populated from the bundle's declared editor settings */
  editorSettings?: EditorBundleSettings<TSettingsComponent>
  /** Custom puzzle editor, if provided by the bundle */
  editor?: {
    mount(...args: unknown[]): unknown
  }
}
