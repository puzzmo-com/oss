import type { Schema, FieldType } from "./types"
import { encodeBitArrayToHex, encodeIntArray, encodeStringArray, encodeSparseMap, encodeJson } from "./encodings"

export function encodeField(value: any, fieldType: FieldType, context?: any): string {
  switch (fieldType.type) {
    case "bitArray":
      return encodeBitArrayToHex(value)

    case "intArray":
      return encodeIntArray(value)

    case "int":
      return String(value)

    case "string":
      return String(value)

    case "stringArray":
      return encodeStringArray(value, fieldType.delimiter)

    case "sparseMap":
      return encodeSparseMap(value, fieldType.valueEncoder, context?.keys)

    case "json":
      return encodeJson(value)

    default:
      throw new Error(`Unknown field type: ${(fieldType as any).type}`)
  }
}

export function encode<TData>(schema: Schema<TData>, data: TData, context?: Record<string, any>): string {
  const delimiter = schema.delimiter || ":"
  const fieldNames = Object.keys(schema.fields) as (keyof TData)[]

  const encodedFields = fieldNames.map((fieldName) => {
    const fieldType = schema.fields[fieldName]
    const value = data[fieldName]
    const fieldContext = context?.[fieldName as string]
    return encodeField(value, fieldType, fieldContext)
  })

  return `v${schema.version}${delimiter}${encodedFields.join(delimiter)}`
}
