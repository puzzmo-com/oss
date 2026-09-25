import { describe, expect, it, vi } from "vitest"

import { createPico8Bridge, CartOp, PageOp, Pico8Channel, resolvePico8Palette, nearestPico8Colour } from "./index"
import { cartBase, gpioSize, pageBase } from "./protocol"
import { patchPico8Export } from "./vitePlugin"

const memory = () => new Array<number>(gpioSize).fill(0)

/** Plays the cart's half of the wire from JavaScript: the same algorithm as puzzmo.lua, with the halves swapped. */
const fakeCart = (mem: number[]) => {
  const channel = new Pico8Channel(mem, cartBase, pageBase)
  const received: { op: number; payload: number[] }[] = []
  return {
    channel,
    received,
    tick: () => received.push(...channel.tick()),
    ops: () => received.map((m) => m.op),
  }
}

/** Enough of the SDK for the bridge: records calls, and lets a test fire host events. */
const fakeSDK = () => {
  const listeners = new Map<string, () => void>()
  return {
    gameLoaded: vi.fn(),
    showCompletionScreen: vi.fn(),
    updateGameState: vi.fn(),
    gameCompleted: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener)
      return () => {}
    }),
    emit: (event: string) => listeners.get(event)?.(),
  }
}

/** Ticks both ends until nothing is in flight. */
const settle = (...ends: { tick: () => void }[]) => {
  for (let i = 0; i < 500; i++) ends.forEach((e) => e.tick())
}

describe("Pico8Channel", () => {
  it("delivers messages in order, one per tick", () => {
    const mem = memory()
    const page = new Pico8Channel(mem, pageBase, cartBase)
    const cart = fakeCart(mem)

    page.send(20, [1, 2, 3])
    page.send(21, [])
    page.send(22, [255])
    settle(page, cart)

    expect(cart.received).toEqual([
      { op: 20, payload: [1, 2, 3] },
      { op: 21, payload: [] },
      { op: 22, payload: [255] },
    ])
    expect(page.backlog).toBe(0)
  })

  it("gets everything through exactly once when the sync keeps losing writes", () => {
    const mem = memory()
    const page = new Pico8Channel(mem, pageBase, cartBase, 5)
    const cart = fakeCart(mem)
    for (let i = 0; i < 300; i++) page.send(16 + (i % 200), [i % 256])

    // A deterministic stand-in for the frame sync clobbering bytes: every so often, a mailbox header is wiped.
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    for (let i = 0; i < 20000 && page.backlog > 0; i++) {
      page.tick()
      if (random() < 0.1) mem[pageBase] = 0
      if (random() < 0.1) mem[cartBase + 3] = 0
      cart.tick()
    }

    expect(page.backlog).toBe(0)
    expect(cart.received.map((m) => m.payload[0])).toEqual(Array.from({ length: 300 }, (_, i) => i % 256))
  })

  it("rejects payloads over 60 bytes", () => {
    const page = new Pico8Channel(memory(), pageBase, cartBase)
    expect(() => page.send(16, new Array(61).fill(0))).toThrow(/60 bytes/)
  })
})

describe("createPico8Bridge", () => {
  const setup = (options: Partial<Parameters<typeof createPico8Bridge>[0]> = {}) => {
    const mem = memory()
    const sdk = fakeSDK()
    const bridge = createPico8Bridge({ sdk: sdk as any, memory: mem, autoTick: false, ...options })
    const cart = fakeCart(mem)
    const run = () => settle(bridge, cart)
    return { mem, sdk, bridge, cart, run }
  }

  it("answers a boot with the board, then tells the SDK once the cart has it", () => {
    const { sdk, cart, run } = setup({ onBoot: (send) => send(16, [5]), palette: ["#000000"] })

    cart.channel.send(CartOp.BOOT)
    run()
    expect(cart.ops()).toEqual([PageOp.HELLO, PageOp.PALETTE, 16, PageOp.READY])
    expect(sdk.gameLoaded).not.toHaveBeenCalled()

    cart.channel.send(CartOp.LOADED)
    run()
    expect(sdk.gameLoaded).toHaveBeenCalledTimes(1)
  })

  it("passes the host's lifecycle through, and replays it to a cart which restarts", () => {
    const { sdk, cart, run } = setup()
    sdk.emit("start")
    sdk.emit("pause")
    run()
    expect(cart.ops()).toEqual([PageOp.START, PageOp.PAUSE])

    cart.received.length = 0
    cart.channel.send(CartOp.BOOT)
    run()
    expect(cart.ops()).toEqual([PageOp.HELLO, PageOp.READY, PageOp.START, PageOp.PAUSE])
    expect(cart.received[cart.received.length - 1].payload).toEqual([1])
  })

  it("routes game messages both ways, and keeps ops under 16 for itself", () => {
    const onMessage = vi.fn((op: number, payload: number[], send: (op: number, p?: number[]) => void) => send(op + 1, payload))
    const { bridge, cart, run } = setup({ onMessage })

    cart.channel.send(40, [9])
    run()
    expect(onMessage).toHaveBeenCalledWith(40, [9], expect.any(Function))
    expect(cart.received).toEqual([{ op: 41, payload: [9] }])
    expect(() => bridge.send(PageOp.START)).toThrow(/belong to the bridge/)
  })

  it("shows the completion screen when the cart finishes celebrating, but not for a play reopened after it was won", () => {
    const fresh = setup()
    fresh.cart.channel.send(CartOp.FINISHED)
    fresh.run()
    expect(fresh.sdk.showCompletionScreen).toHaveBeenCalledWith([])

    const reopened = setup({ completed: true })
    reopened.cart.channel.send(CartOp.BOOT)
    reopened.cart.channel.send(CartOp.FINISHED)
    reopened.run()
    expect(reopened.cart.received[0]).toEqual({ op: PageOp.HELLO, payload: [1] })
    expect(reopened.sdk.showCompletionScreen).not.toHaveBeenCalled()

    // A retry makes it a live play again
    const onRetry = vi.fn()
    const retried = setup({ completed: true, onRetry })
    retried.sdk.emit("retry")
    retried.cart.channel.send(CartOp.FINISHED)
    retried.run()
    expect(onRetry).toHaveBeenCalled()
    expect(retried.cart.ops()).toEqual([PageOp.RETRY])
    expect(retried.sdk.showCompletionScreen).toHaveBeenCalled()
  })
})

describe("createPico8Bridge, for a game written in Lua", () => {
  const setup = (options: Partial<Parameters<typeof createPico8Bridge>[0]> = {}) => {
    const mem = memory()
    const sdk = fakeSDK()
    const bridge = createPico8Bridge({ sdk: sdk as any, memory: mem, autoTick: false, ...options })
    const cart = fakeCart(mem)
    const run = () => settle(bridge, cart)
    return { sdk, cart, run }
  }
  const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0))
  const received = (cart: ReturnType<typeof fakeCart>, op: number) =>
    String.fromCharCode(...cart.received.filter((m) => m.op === op).flatMap((m) => m.payload))

  it("sends the puzzle and saved progress in 60 character pieces", () => {
    const puzzle = "x".repeat(130)
    const { cart, run } = setup({ puzzleString: puzzle, inputString: "3,4" })
    cart.channel.send(CartOp.BOOT)
    run()
    expect(cart.ops()).toEqual([
      PageOp.HELLO,
      PageOp.PUZZLE_PART,
      PageOp.PUZZLE_PART,
      PageOp.PUZZLE_PART,
      PageOp.PROGRESS_PART,
      PageOp.READY,
    ])
    expect(received(cart, PageOp.PUZZLE_PART)).toBe(puzzle)
    expect(received(cart, PageOp.PROGRESS_PART)).toBe("3,4")
  })

  it("puts saves back together, and hands the latest one to a cart which restarts", () => {
    const { sdk, cart, run } = setup({ puzzleString: "p" })
    const save = "abc".repeat(30) // 90 characters: two pieces
    cart.channel.send(CartOp.SAVE_PART, text(save.slice(0, 60)))
    cart.channel.send(CartOp.SAVE, text(save.slice(60)))
    run()
    expect(sdk.updateGameState).toHaveBeenCalledTimes(1)
    expect(sdk.updateGameState).toHaveBeenCalledWith(save)

    // Saving the same thing again (as pz_complete does) isn't another upload
    cart.channel.send(CartOp.SAVE, text("abc"))
    run()
    expect(sdk.updateGameState).toHaveBeenCalledTimes(2)
    cart.channel.send(CartOp.SAVE, text("abc"))
    run()
    expect(sdk.updateGameState).toHaveBeenCalledTimes(2)

    cart.channel.send(CartOp.BOOT)
    run()
    expect(received(cart, PageOp.PROGRESS_PART)).toBe("abc")
  })

  it("completes with the cart's points and deeds", () => {
    const { sdk, cart, run } = setup()
    cart.channel.send(CartOp.DEED, [0, 12, 1, ...text("moves")])
    cart.channel.send(CartOp.SAVE, text("done"))
    cart.channel.send(CartOp.COMPLETE, [1, 44]) // 300 points
    cart.channel.send(CartOp.COMPLETE, [1, 44]) // a second one is ignored
    run()
    expect(sdk.gameCompleted).toHaveBeenCalledTimes(1)
    expect(sdk.gameCompleted).toHaveBeenCalledWith(
      { inputString: "done", pointsAwarded: 300, completed: true },
      { deeds: [{ id: "moves", value: 12, persist: true }] },
    )
  })

  it("forgets progress on a retry", () => {
    const { sdk, cart, run } = setup({ puzzleString: "p", inputString: "old", completed: true })
    sdk.emit("retry")
    cart.channel.send(CartOp.BOOT)
    run()
    expect(cart.ops()).toEqual([PageOp.RETRY, PageOp.HELLO, PageOp.PUZZLE_PART, PageOp.READY])
    expect(cart.received[1].payload).toEqual([0])
  })
})

describe("palette", () => {
  it("maps hex colours to PICO-8's hardware colours, keeping them apart", () => {
    expect(nearestPico8Colour("#ff004d")).toBe(8)
    expect(nearestPico8Colour("not a colour")).toBeNull()
    // Two near-identical whites don't land on the same colour
    const [a, b] = resolvePico8Palette(["#fff1e8", "#fff0e8"])
    expect(a).toBe(7)
    expect(b).not.toBe(7)
    // Numbers pass through, gaps keep the default
    expect(resolvePico8Palette([undefined, 129]).slice(0, 3)).toEqual([0, 129, 2])
  })
})

describe("patchPico8Export", () => {
  const shell = `<html><head><style type="text/css"><!--
.p8_start_button { background:url() no-repeat center;
  -repeat center;
}
--></style><script>var p8_autoplay = false; var pico8_gpio = new Array(128);</script></head>
<body><div>&nbsp</div><script>var e = document.createElement("script"); e.src = "game.js";</script></body></html>`

  it("makes PICO-8's page work as a Puzzmo game's page", () => {
    const html = patchPico8Export(shell, "game", [`<script type="module" src="./src/main.ts"></script>`])
    expect(html).toContain(`e.src = "./game.js"`)
    expect(html).toContain("var p8_autoplay = true")
    expect(html).not.toMatch(/<!--|-->|^\s*-repeat|&nbsp(?!;)/m)
    expect(html).toContain("&nbsp;")
    expect(html).toMatch(/<script type="module" src="\.\/src\/main\.ts"><\/script>\n<\/body>/)
  })

  it("adds the GPIO array to shells which don't declare one", () => {
    const html = patchPico8Export(shell.replace("var pico8_gpio = new Array(128);", ""), "game", [])
    expect(html).toContain("var pico8_gpio = new Array(128)")
  })

  it("explains itself when the page isn't a PICO-8 export", () => {
    expect(() => patchPico8Export("<html><body></body></html>", "game", [])).toThrow(/game\.js/)
  })
})
