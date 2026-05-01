import { Validator, type Schema } from "@cfworker/json-schema"

import type { PuzzmoFile } from "./api.js"

const schemaURL = "https://dev-dj9e.onrender.com/schema/puzzmo-file-schema.json" //"https://dev.puzzmo.com/schema/puzzmo-file-schema.json"

let cachedValidator: Validator | undefined

/** Fetches and caches a JSON schema validator for puzzmo.json files */
const getValidator = async () => {
  if (cachedValidator) return cachedValidator
  let res: Response
  try {
    res = await fetch(schemaURL)
  } catch (e) {
    const cause = (e as { cause?: unknown }).cause
    const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : (e as Error).message
    throw new Error(`Network error fetching puzzmo file schema (${schemaURL}): ${causeMsg}`)
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch puzzmo file schema: ${res.status} ${res.statusText} from ${schemaURL}`)
  }
  let puzzmoSchema: unknown
  try {
    puzzmoSchema = await res.json()
  } catch (e) {
    throw new Error(`Invalid JSON in puzzmo file schema (${schemaURL}): ${e instanceof Error ? e.message : e}`)
  }
  cachedValidator = new Validator(puzzmoSchema as Schema, "7")
  return cachedValidator
}

type ValidationResult = { valid: true; data: PuzzmoFile } | { valid: false; errors: string[] }

/** Validates a parsed object against the puzzmo.json JSON schema. Returned `data` has `$schema` stripped. */
export const validatePuzzmoJson = async (data: unknown): Promise<ValidationResult> => {
  const validator = await getValidator()
  const toValidate = stripSchemaProperty(data)
  const result = validator.validate(toValidate)
  if (result.valid) return { valid: true, data: toValidate as PuzzmoFile }
  return {
    valid: false,
    errors: result.errors
      .filter((e) => e.keyword !== "if" && !e.error.startsWith("A subschema had errors"))
      .map((e) => `${e.instanceLocation}: ${e.error}`),
  }
}

/** Removes the `$schema` editor-hint property so it doesn't trip additionalProperties checks */
const stripSchemaProperty = (data: unknown): unknown => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data
  if (!("$schema" in data)) return data
  const { $schema: _, ...rest } = data as Record<string, unknown>
  return rest
}
