/** A colour for one of the cart's 16 draw colours: a hex string, a PICO-8 hardware colour id, or null to leave it alone. */
export type Pico8Colour = string | number | null | undefined

/** PICO-8's 32 hardware colours as `[r, g, b, id]`: the 16 standard ones, then the 16 extras at 128..143. */
export const pico8HardwareColours: readonly (readonly [number, number, number, number])[] = [
  [0x00, 0x00, 0x00, 0],
  [0x1d, 0x2b, 0x53, 1],
  [0x7e, 0x25, 0x53, 2],
  [0x00, 0x87, 0x51, 3],
  [0xab, 0x52, 0x36, 4],
  [0x5f, 0x57, 0x4f, 5],
  [0xc2, 0xc3, 0xc7, 6],
  [0xff, 0xf1, 0xe8, 7],
  [0xff, 0x00, 0x4d, 8],
  [0xff, 0xa3, 0x00, 9],
  [0xff, 0xec, 0x27, 10],
  [0x00, 0xe4, 0x36, 11],
  [0x29, 0xad, 0xff, 12],
  [0x83, 0x76, 0x9c, 13],
  [0xff, 0x77, 0xa8, 14],
  [0xff, 0xcc, 0xaa, 15],
  [0x29, 0x18, 0x14, 128],
  [0x11, 0x1d, 0x35, 129],
  [0x42, 0x21, 0x36, 130],
  [0x12, 0x53, 0x59, 131],
  [0x74, 0x2f, 0x29, 132],
  [0x49, 0x33, 0x3b, 133],
  [0xa2, 0x88, 0x79, 134],
  [0xf3, 0xef, 0x7d, 135],
  [0xbe, 0x12, 0x50, 136],
  [0xff, 0x6c, 0x24, 137],
  [0xa8, 0xe7, 0x2e, 138],
  [0x00, 0xb5, 0x43, 139],
  [0x06, 0x5a, 0xb5, 140],
  [0x75, 0x46, 0x65, 141],
  [0xff, 0x6e, 0x59, 142],
  [0xff, 0x9d, 0x81, 143],
]

const parseHex = (hex: string): [number, number, number] | null => {
  const s = hex.replace("#", "")
  if (!/^[0-9a-f]{6}/i.test(s)) return null
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

/**
 * The hardware colour closest to `hex`, weighted towards green the way eyes are. `exclude` skips colours which are
 * already taken. Returns null for anything which isn't a hex colour.
 */
export function nearestPico8Colour(hex: string, exclude?: ReadonlySet<number>): number | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  let best: number | null = null
  let bestDistance = Infinity
  for (const [r, g, b, id] of pico8HardwareColours) {
    if (exclude?.has(id)) continue
    const distance = 2 * (r - rgb[0]) ** 2 + 4 * (g - rgb[1]) ** 2 + 3 * (b - rgb[2]) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = id
    }
  }
  return best
}

/**
 * Resolves up to 16 colours into the 16 hardware ids the cart feeds to `pal()`. Hex colours are matched to the
 * nearest hardware colour which an earlier hex colour hasn't already claimed, because two theme colours landing on
 * the same PICO-8 colour usually means something drawn on top of the other one disappears. Numbers are used as-is,
 * and a missing entry keeps PICO-8's default for that slot.
 */
export function resolvePico8Palette(colours: readonly Pico8Colour[]): number[] {
  const taken = new Set<number>()
  const out: number[] = []
  for (let i = 0; i < 16; i++) {
    const c = colours[i]
    if (typeof c === "number") out.push(c)
    else if (typeof c === "string") {
      const id = nearestPico8Colour(c, taken) ?? i
      taken.add(id)
      out.push(id)
    } else out.push(i)
  }
  return out
}
