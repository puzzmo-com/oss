import { describe, it, expect } from "vitest"
import { createEncoder } from "./index"
import { defineSchema } from "./types"
import { encodeBitArrayToHex, decodeBitArrayFromHex, encodeIntArray, decodeIntArray, encodeSparseMap, decodeSparseMap } from "./encodings"

describe("inputStringEncoder - encodings", () => {
  describe("bitArray hex encoding", () => {
    it("encodes empty array", () => {
      expect(encodeBitArrayToHex([])).toBe("0")
    })

    it("encodes single bit", () => {
      expect(encodeBitArrayToHex([true])).toBe("1")
      expect(encodeBitArrayToHex([false])).toBe("0")
    })

    it("encodes 4 bits to single hex char", () => {
      expect(encodeBitArrayToHex([true, false, false, false])).toBe("1")
      expect(encodeBitArrayToHex([false, true, false, false])).toBe("2")
      expect(encodeBitArrayToHex([true, true, false, false])).toBe("3")
      expect(encodeBitArrayToHex([true, false, true, false])).toBe("5")
    })

    it("encodes 16 bits", () => {
      const bits = [true, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false]
      expect(encodeBitArrayToHex(bits)).toBe("1200")
    })

    it("round-trips correctly", () => {
      const bits = [true, false, true, true, false, false, true, false, true]
      const encoded = encodeBitArrayToHex(bits)
      const decoded = decodeBitArrayFromHex(encoded, bits.length)
      expect(decoded).toEqual(bits)
    })
  })

  describe("intArray encoding", () => {
    it("encodes empty array", () => {
      expect(encodeIntArray([])).toBe("")
    })

    it("encodes dense array", () => {
      expect(encodeIntArray([1, 2, 3])).toBe("1,2,3")
    })

    it("encodes sparse array with smart encoding when beneficial", () => {
      expect(encodeIntArray([0, 0, 5, 0])).toBe("2=5")
    })

    it("falls back to dense format when smart encoding not beneficial", () => {
      expect(encodeIntArray([1, 2, 3, 4])).toBe("1,2,3,4")
    })

    it("decodes CSV format", () => {
      expect(decodeIntArray("1,2,3")).toEqual([1, 2, 3])
    })

    it("decodes sparse format", () => {
      expect(decodeIntArray("2=5", 4)).toEqual([0, 0, 5, 0])
    })

    it("round-trips correctly", () => {
      const arr = [0, 0, 5, 0, 3, 0]
      const encoded = encodeIntArray(arr)
      const decoded = decodeIntArray(encoded, arr.length)
      expect(decoded).toEqual(arr)
    })
  })

  describe("sparseMap encoding", () => {
    it("encodes empty map", () => {
      expect(encodeSparseMap({}, String)).toBe("")
    })

    it("encodes single entry", () => {
      expect(encodeSparseMap({ a: "foo" }, String)).toBe("a=foo")
    })

    it("encodes multiple entries", () => {
      const result = encodeSparseMap({ a: "foo", b: "bar" }, String)
      expect(result).toContain("a=foo")
      expect(result).toContain("b=bar")
      expect(result).toContain(";")
    })

    it("encodes with custom encoder", () => {
      const map = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } }
      const result = encodeSparseMap(map, (v) => `${v.x}.${v.y}`)
      expect(result).toContain("a=1.2")
      expect(result).toContain("b=3.4")
    })

    it("decodes correctly", () => {
      const encoded = "a=1.2;b=3.4"
      const result = decodeSparseMap(encoded, (v) => {
        const [x, y] = v.split(".").map(Number)
        return { x, y }
      })
      expect(result).toEqual({
        a: { x: 1, y: 2 },
        b: { x: 3, y: 4 },
      })
    })
  })
})

describe("inputStringEncoder - schema-driven encoding", () => {
  it("encodes and decodes simple schema", () => {
    const schema = defineSchema({
      version: 1,
      fields: {
        name: { type: "string" },
        age: { type: "int" },
      },
    })

    const { encode, decode } = createEncoder(schema)

    const data = { name: "Alice", age: 30 }
    const encoded = encode(data)
    expect(encoded).toBe("v1:Alice:30")

    const decoded = decode(encoded)
    expect(decoded).toEqual(data)
  })

  it("encodes with bit array", () => {
    const schema = defineSchema({
      version: 1,
      fields: {
        flags: { type: "bitArray" },
        count: { type: "int" },
      },
    })

    const { encode, decode } = createEncoder(schema, {
      flags: { length: 8 },
    })

    const data = {
      flags: [true, false, false, false, false, false, false, false],
      count: 5,
    }
    const encoded = encode(data)
    expect(encoded).toBe("v1:10:5")

    const decoded = decode(encoded)
    expect(decoded).toEqual(data)
  })

  it("encodes with sparse int array", () => {
    const schema = defineSchema({
      version: 1,
      fields: {
        values: { type: "intArray" },
      },
    })

    const { encode, decode } = createEncoder(schema, {
      values: { length: 5 },
    })

    const data = { values: [0, 0, 5, 0, 3] }
    const encoded = encode(data)
    expect(encoded).toBe("v1:2=5,4=3")

    const decoded = decode(encoded)
    expect(decoded).toEqual(data)
  })

  it("encodes with sparse map", () => {
    const schema = defineSchema({
      version: 1,
      fields: {
        annotations: {
          type: "sparseMap",
          valueEncoder: (v: { level: number; color: number }) => `${v.level}.${v.color}`,
          valueDecoder: (s: string) => {
            const [level, color] = s.split(".").map(Number)
            return { level, color }
          },
        },
      },
    })

    const { encode, decode } = createEncoder(schema)

    const data = {
      annotations: {
        "0,0": { level: 2, color: 1 },
        "1,1": { level: 3, color: 0 },
      },
    }
    const encoded = encode(data)
    expect(encoded).toContain("v1:")
    expect(encoded).toContain("0,0=2.1")
    expect(encoded).toContain("1,1=3.0")

    const decoded = decode(encoded)
    expect(decoded).toEqual(data)
  })

  it("handles custom delimiters", () => {
    const schema = defineSchema({
      version: 1,
      delimiter: "|",
      fields: {
        name: { type: "string" },
        age: { type: "int" },
      },
    })

    const { encode, decode } = createEncoder(schema)

    const data = { name: "Bob", age: 25 }
    const encoded = encode(data)
    expect(encoded).toBe("v1|Bob|25")

    const decoded = decode(encoded)
    expect(decoded).toEqual(data)
  })
})

describe("inputStringEncoder - migrations", () => {
  it("migrates from v0 to v1", () => {
    const schema = defineSchema({
      version: 1,
      fields: {
        name: { type: "string" },
        age: { type: "int" },
        newField: { type: "string" },
      },
      migrations: {
        0: (oldData: { name: string; age: number }) => ({
          name: oldData.name,
          age: oldData.age,
          newField: "default",
        }),
      },
    })

    const { migrate, decode } = createEncoder(schema)

    const v0String = "v0:Alice:30"
    const migrated = migrate(v0String)
    expect(migrated).toBe("v1:Alice:30:default")

    const decoded = decode(migrated)
    expect(decoded).toEqual({
      name: "Alice",
      age: 30,
      newField: "default",
    })
  })

  it("handles multiple migration steps", () => {
    const schema = defineSchema({
      version: 2,
      fields: {
        name: { type: "string" },
        value: { type: "int" },
      },
      migrations: {
        0: (oldData: { name: string }) => ({
          name: oldData.name,
          value: 0,
        }),
        1: (oldData: { name: string; value: number }) => ({
          name: oldData.name.toUpperCase(),
          value: oldData.value + 1,
        }),
      },
    })

    const { migrate, decode } = createEncoder(schema)

    const v0String = "v0:alice"
    const migrated = migrate(v0String)
    const decoded = decode(migrated)

    expect(decoded).toEqual({
      name: "ALICE",
      value: 1,
    })
  })

  it("does not migrate if already at current version", () => {
    const schema = defineSchema({
      version: 1,
      fields: {
        name: { type: "string" },
      },
    })

    const { migrate } = createEncoder(schema)

    const v1String = "v1:Alice"
    const migrated = migrate(v1String)
    expect(migrated).toBe(v1String)
  })
})
