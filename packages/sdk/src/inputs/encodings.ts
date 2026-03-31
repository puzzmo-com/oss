import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string"

export function encodeBitArrayToHex(bits: boolean[]): string {
  if (bits.length === 0) return "0"

  let hex = ""
  for (let i = 0; i < bits.length; i += 4) {
    let nibble = 0
    for (let j = 0; j < 4 && i + j < bits.length; j++) {
      if (bits[i + j]) {
        nibble |= 1 << j
      }
    }
    hex += nibble.toString(16)
  }

  return hex || "0"
}

export function decodeBitArrayFromHex(hex: string, length: number): boolean[] {
  const bits: boolean[] = []

  for (let i = 0; i < length; i++) {
    const hexIndex = Math.floor(i / 4)
    const bitIndex = i % 4
    const nibble = parseInt(hex[hexIndex] || "0", 16)
    bits.push((nibble & (1 << bitIndex)) !== 0)
  }

  return bits
}

export function encodeIntArray(arr: number[]): string {
  if (arr.length === 0) return ""

  const nonZero = arr.map((val, idx) => ({ val, idx })).filter((item) => item.val !== 0)

  if (nonZero.length === 0) return ""
  if (nonZero.length > arr.length / 2) {
    return arr.join(",")
  }

  return nonZero.map((item) => `${item.idx}=${item.val}`).join(",")
}

export function decodeIntArray(str: string, defaultLength?: number): number[] {
  if (!str) return defaultLength ? Array.from({ length: defaultLength }, () => 0) : []

  if (str.includes("=")) {
    const result = defaultLength ? Array.from({ length: defaultLength }, () => 0) : []
    const pairs = str.split(",")
    for (const pair of pairs) {
      const [idxStr, valStr] = pair.split("=")
      const idx = Number(idxStr)
      const val = Number(valStr)
      if (!isNaN(idx) && !isNaN(val)) {
        result[idx] = val
      }
    }
    return result
  }

  return str.split(",").map((x) => Number(x))
}

export function encodeStringArray(arr: string[], delimiter = ","): string {
  return arr.join(delimiter)
}

export function decodeStringArray(str: string, delimiter = ","): string[] {
  if (!str) return []
  return str.split(delimiter)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON can encode any data
export function encodeJson(data: any): string {
  const json = JSON.stringify(data)
  return compressToEncodedURIComponent(json)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON can decode to any data
export function decodeJson(str: string): any {
  if (!str) return undefined
  const json = decompressFromEncodedURIComponent(str)
  return json ? JSON.parse(json) : undefined
}

export function encodeSparseMap<T>(map: Record<string, T>, encodeValue: (val: T) => string, orderedKeys?: string[]): string {
  const entries = Object.entries(map).filter(([_, val]) => val !== null && val !== undefined)

  if (orderedKeys) {
    // Use numeric indices instead of string keys
    const indexedEntries = entries
      .map(([key, val]) => {
        const idx = orderedKeys.indexOf(key)
        if (idx === -1) return null
        return `${idx}=${encodeValue(val)}`
      })
      .filter((entry): entry is string => entry !== null)

    return indexedEntries.join(",")
  } else {
    // Fall back to string keys
    return entries.map(([key, val]) => `${key}=${encodeValue(val)}`).join(";")
  }
}

export function decodeSparseMap<T>(str: string, decodeValue: (val: string) => T, orderedKeys?: string[]): Record<string, T> {
  if (!str) return {}

  const result: Record<string, T> = {}

  if (orderedKeys) {
    // Decode numeric indices
    const entries = str.split(",")
    for (const entry of entries) {
      if (!entry) continue
      const [idxStr, val] = entry.split("=")
      const idx = Number(idxStr)
      if (!isNaN(idx) && val && orderedKeys[idx]) {
        result[orderedKeys[idx]] = decodeValue(val)
      }
    }
  } else {
    // Decode string keys
    const entries = str.split(";")
    for (const entry of entries) {
      if (!entry) continue
      const [key, val] = entry.split("=")
      if (key && val) {
        result[key] = decodeValue(val)
      }
    }
  }

  return result
}
