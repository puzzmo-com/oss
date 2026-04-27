import { Validator } from "@cfworker/json-schema"

import type { PuzzmoFile } from "./api.js"

const schemaURL = "https://dev.puzzmo.com/schema/puzzmo-file-schema.json"

let cachedValidator: Validator | undefined

/** Fetches and caches a JSON schema validator for puzzmo.json files */
const getValidator = async () => {
  if (cachedValidator) return cachedValidator
  const res = await fetch(schemaURL)
  if (!res.ok) throw new Error(`Failed to fetch puzzmo file schema: ${res.status}`)
  const puzzmoSchema = await res.json()
  cachedValidator = new Validator(puzzmoSchema, "7")
  return cachedValidator
}

type ValidationResult = { valid: true; data: PuzzmoFile } | { valid: false; errors: string[] }

/** Validates a parsed object against the puzzmo.json JSON schema */
export const validatePuzzmoJson = async (data: unknown): Promise<ValidationResult> => {
  const validator = await getValidator()
  const result = validator.validate(data)
  if (result.valid) return { valid: true, data: data as PuzzmoFile }
  return {
    valid: false,
    errors: result.errors
      .filter((e) => e.keyword !== "if" && !e.error.startsWith("A subschema had errors"))
      .map((e) => `${e.instanceLocation}: ${e.error}`),
  }
}
