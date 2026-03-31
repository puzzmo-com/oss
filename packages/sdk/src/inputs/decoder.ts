import type { Schema, FieldType } from "./types"
import { decodeBitArrayFromHex, decodeIntArray, decodeStringArray, decodeSparseMap, decodeJson } from "./encodings"

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- context is dynamic and return type depends on fieldType
export function decodeField(value: string, fieldType: FieldType, context?: any): any {
  switch (fieldType.type) {
    case "bitArray":
      if (!context?.length) {
        throw new Error("bitArray requires length in context")
      }
      return decodeBitArrayFromHex(value, context.length)

    case "intArray":
      return decodeIntArray(value, context?.length)

    case "int":
      return Number(value)

    case "string":
      return value

    case "stringArray":
      return decodeStringArray(value, fieldType.delimiter)

    case "sparseMap":
      return decodeSparseMap(value, fieldType.valueDecoder, context?.keys)

    case "json":
      return decodeJson(value)

    default:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- used in error message for invalid type
      throw new Error(`Unknown field type: ${(fieldType as any).type}`)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- context values are dynamic
export function decode<TData>(schema: Schema<TData>, inputString: string, context?: Record<string, any>): TData {
  const delimiter = schema.delimiter || ":"
  const parts = inputString.split(delimiter)

  const versionPart = parts[0]
  const versionMatch = versionPart.match(/^v(\d+)$/)
  if (!versionMatch) {
    throw new Error(`Invalid input string format: ${versionPart}`)
  }

  const version = Number(versionMatch[1])
  if (version !== schema.version) {
    throw new Error(`Version mismatch: expected v${schema.version}, got v${version}. ` + `Make sure to run migrations first.`)
  }

  const fieldNames = Object.keys(schema.fields) as (keyof TData)[]
  const data = {} as TData

  for (let i = 0; i < fieldNames.length; i++) {
    const fieldName = fieldNames[i]
    const fieldType = schema.fields[fieldName]
    const fieldValue = parts[i + 1] || ""

    const fieldContext = context?.[fieldName as string]
    data[fieldName] = decodeField(fieldValue, fieldType, fieldContext)
  }

  return data
}
