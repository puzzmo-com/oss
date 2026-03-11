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
export class WorkshopImportError extends Error {
  constructor(
    public type: ImportErrorType,
    message: string,
    public originalError?: unknown,
  ) {
    super(message)
    this.name = "WorkshopImportError"
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

/** Main interface for a Workshop bundle */
export interface WorkshopBundle {
  validator: {
    validate(data: string): Promise<ValidationReport> | ValidationReport
  }
  importer?: {
    onImport(filename: string, contents: string | ArrayBuffer): Promise<ImportResult> | ImportResult
  }
}
