// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  animatedAttributes,
  createThumbnailMorpher,
  hoistFontFaces,
  mixStrings,
  parseEasing,
  springLinearEasing,
  svgTransformToCSS,
  thumbnailMotionRuntime,
} from "./thumbnailMotion"

const board = (cards: string) =>
  `<svg data-key="svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g data-key="board">${cards}</g></svg>`
const card = (id: number, x: number, extra = "") =>
  `<g data-key="card:${id}" ${extra} transform="translate(${x}, 0) rotate(0)"><rect width="10" height="10"/></g>`

// The tween loop runs on requestAnimationFrame and performance.now, so faking both makes timing exact
const useFakeFrames = () =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] })

const linearTiming = (duration: number) => () => ({ duration, delay: 0, ease: (t: number) => t })

describe("createThumbnailMorpher", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("inserts the first SVG and installs the host stylesheet", () => {
    const container = document.createElement("div")
    createThumbnailMorpher(container).show(board(card(1, 0)))
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 100 100")
    expect(document.getElementById("puzzmo-thumbnail-motion")!.textContent).toContain("--puzzmo-ease-float: linear(")
  })

  it("keeps the same node for a key across renders and never writes a CSS transform", () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container)
    morpher.show(board(card(1, 0)))
    const before = container.querySelector("[data-key='card:1']") as SVGElement
    morpher.show(board(card(1, 40)))
    const after = container.querySelector("[data-key='card:1']") as SVGElement
    expect(after).toBe(before)
    // jsdom computes no transition, so the attribute lands at once
    expect(after.getAttribute("transform")).toBe("translate(40, 0) rotate(0)")
    expect(after.style.transform).toBe("")
  })

  it("tweens the attribute itself on the timing its CSS declares", async () => {
    useFakeFrames()
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container, { timing: linearTiming(120) })
    morpher.show(board(card(1, 0)))
    morpher.show(board(card(1, 100)))
    const el = container.querySelector("[data-key='card:1']")!
    expect(el.getAttribute("transform")).toBe("translate(0, 0) rotate(0)")
    await vi.advanceTimersByTimeAsync(60)
    const mid = parseFloat(el.getAttribute("transform")!.slice("translate(".length))
    expect(mid).toBeGreaterThan(30)
    expect(mid).toBeLessThan(70)
    await vi.advanceTimersByTimeAsync(100)
    expect(el.getAttribute("transform")).toBe("translate(100, 0) rotate(0)")
  })

  it("retargets a tween mid-flight from where the element is, not where it was going", async () => {
    useFakeFrames()
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container, { timing: linearTiming(100) })
    morpher.show(board(card(1, 0)))
    morpher.show(board(card(1, 100)))
    const el = container.querySelector("[data-key='card:1']") as SVGElement
    await vi.advanceTimersByTimeAsync(50)
    const mid = parseFloat(el.getAttribute("transform")!.slice("translate(".length))

    morpher.show(board(card(1, 0)))
    expect(el.style.getPropertyValue("--puzzmo-from-transform")).toBe(`translate(${mid}px, 0px) rotate(0deg)`)
    await vi.advanceTimersByTimeAsync(20)
    const heading = parseFloat(el.getAttribute("transform")!.slice("translate(".length))
    expect(heading).toBeLessThan(mid)
    await vi.advanceTimersByTimeAsync(200)
    expect(el.getAttribute("transform")).toBe("translate(0, 0) rotate(0)")
  })

  it("snaps an attribute whose shape changed instead of tweening it", () => {
    useFakeFrames()
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container, { timing: linearTiming(100) })
    const svg = (transform: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g data-key="g" transform="${transform}"/></svg>`
    morpher.show(svg("translate(0, 0) rotate(0)"))
    morpher.show(svg("translate(50, 0)"))
    expect(container.querySelector("[data-key='g']")!.getAttribute("transform")).toBe("translate(50, 0)")
  })

  it("stops a tween when the renderer drops its attribute, so the next frame does not write it back", async () => {
    useFakeFrames()
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container, { timing: linearTiming(100) })
    morpher.show(board(card(1, 0, 'opacity="0"')))
    morpher.show(board(card(1, 0, 'opacity="1"')))
    await vi.advanceTimersByTimeAsync(30)

    morpher.show(board(card(1, 0)))
    await vi.advanceTimersByTimeAsync(200)
    expect(container.querySelector("[data-key='card:1']")!.hasAttribute("opacity")).toBe(false)
  })

  it("lets a tween carry on when a render repeats its target, instead of restarting the easing", async () => {
    useFakeFrames()
    const container = document.createElement("div")
    const changed: string[] = []
    const morpher = createThumbnailMorpher(container, {
      timing: linearTiming(100),
      onLifecycle: (el, className) => {
        if (className === "puzzmo-changed") changed.push(el.getAttribute("data-key")!)
      },
    })
    morpher.show(board(card(1, 0) + card(2, 0)))
    morpher.show(board(card(1, 100) + card(2, 0)))
    const one = container.querySelector("[data-key='card:1']")!
    await vi.advanceTimersByTimeAsync(50)
    changed.length = 0

    // Only card 2 changes; card 1 is still on its way to 100
    morpher.show(board(card(1, 100) + card(2, 30)))
    expect(changed).toEqual(["card:2"])
    // Finishes on the original schedule rather than 100ms from the second render (frames are 16ms apart)
    await vi.advanceTimersByTimeAsync(70)
    expect(one.getAttribute("transform")).toBe("translate(100, 0) rotate(0)")
  })

  it("keeps the --puzzmo-from- history when the renderer's inline style changes in the same render", () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container)
    // style after transform, so applying it last would wipe the history written for transform
    const keyed = (x: number, color: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g data-key="g" transform="translate(${x}, 0)" style="color: ${color}"/></svg>`
    morpher.show(keyed(0, "red"))
    morpher.show(keyed(40, "blue"))
    const el = container.querySelector("[data-key='g']") as SVGElement
    expect(el.style.getPropertyValue("--puzzmo-from-transform")).toBe("translate(0px, 0px)")
    expect(el.style.getPropertyValue("color")).toBe("blue")

    // An unchanged style is left alone rather than rewritten over the history
    morpher.show(keyed(80, "blue"))
    expect(el.style.getPropertyValue("--puzzmo-from-transform")).toBe("translate(40px, 0px)")
    expect(el.style.getPropertyValue("color")).toBe("blue")
  })

  it("matches unkeyed children by position and tag", () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container)
    const svg = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="${fill}"/><circle r="1"/></svg>`
    morpher.show(svg("red"))
    const rect = container.querySelector("rect")
    const circle = container.querySelector("circle")
    morpher.show(svg("blue"))
    expect(container.querySelector("rect")).toBe(rect)
    expect(container.querySelector("circle")).toBe(circle)
    expect(rect!.getAttribute("fill")).toBe("blue")
  })

  it("updates the text around a kept child, and the text of a node whose children left", () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container)
    const svg = (text: string) => `<svg data-key="svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${text}</svg>`

    // Mixed content: the text before the tspan updates, the keyed tspan is the same node
    morpher.show(svg(`<text>Score: <tspan data-key="n">5</tspan></text>`))
    const tspan = container.querySelector("[data-key='n']")!
    morpher.show(svg(`<text>Points: <tspan data-key="n">7</tspan></text>`))
    const text = container.querySelector("text")!
    expect(container.querySelector("[data-key='n']")).toBe(tspan)
    expect(tspan.textContent).toBe("7")
    expect(text.textContent).toBe("Points: 7")

    // All children gone, text only: the unkeyed tspan goes at once and the text lands
    const container2 = document.createElement("div")
    const morpher2 = createThumbnailMorpher(container2)
    morpher2.show(svg(`<text><tspan>5</tspan></text>`))
    morpher2.show(svg(`<text>Done</text>`))
    expect(container2.querySelector("text")!.textContent).toBe("Done")
    expect(container2.querySelector("text tspan")).toBeNull()
  })

  it("renders sloppy markup through the HTML parser with a warning: no xmlns, HTML entities, unclosed tags", () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    // No xmlns: the XML parser would put this in the null namespace, which renders blank
    expect(morpher.show(`<svg viewBox="0 0 100 100"><rect data-key="r" width="10" height="10"/></svg>`)).toBe(true)
    const rect = container.querySelector("[data-key='r']")!
    expect(rect.namespaceURI).toBe("http://www.w3.org/2000/svg")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not well-formed XML"))

    // An HTML entity and an unclosed tag, both XML parse errors, still morph the keyed rect
    expect(morpher.show(`<svg viewBox="0 0 100 100"><rect data-key="r" width="20" height="10"/><text>a&nbsp;b<g></svg>`)).toBe(true)
    expect(container.querySelector("[data-key='r']")).toBe(rect)
    expect(rect.getAttribute("width")).toBe("20")
    warn.mockRestore()
  })

  it("strips meta elements, so a foreignObject refresh cannot navigate the display document", () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container)
    const meta = `<foreignObject><meta xmlns="http://www.w3.org/1999/xhtml" http-equiv="refresh" content="0;url=https://evil.example"/></foreignObject>`
    expect(morpher.show(board(meta))).toBe(true)
    expect(container.querySelector("meta")).toBeNull()
    // The morph path strips too, not just the first insert
    expect(morpher.show(board(card(1, 0) + meta))).toBe(true)
    expect(container.querySelector("meta")).toBeNull()
    expect(container.querySelector("[data-key='card:1']")).not.toBeNull()
  })

  it("keeps the previous render, and installs no fonts, when the SVG does not parse", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const runtime = thumbnailMotionRuntime()
    const doc = document.implementation.createHTMLDocument()
    const container = doc.createElement("div")
    doc.body.appendChild(container)
    const morpher = runtime.createThumbnailMorpher(container)
    expect(morpher.show(board(card(1, 0)))).toBe(true)

    // No <svg> element at all, so even the forgiving HTML fallback has nothing to show
    const broken = `<div><style>@font-face{font-family:"Broken";src:url(data:x)}</style></div>`
    expect(morpher.show(broken)).toBe(false)
    expect(container.querySelector("[data-key='card:1']")).not.toBeNull()
    expect(doc.getElementById("puzzmo-thumbnail-fonts")).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("did not parse"))
    warn.mockRestore()
  })

  it("moves a keyed node into a new parent instead of recreating it", () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container)
    morpher.show(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g data-key="hand">${card(7, 0)}</g><g data-key="board"></g></svg>`,
    )
    const node = container.querySelector("[data-key='card:7']")
    morpher.show(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g data-key="hand"></g><g data-key="board">${card(7, 50)}</g></svg>`,
    )
    const moved = container.querySelector("[data-key='board'] > [data-key='card:7']")
    expect(moved).toBe(node)
    expect(container.querySelector("[data-key='hand']")!.children.length).toBe(0)
  })

  it("adds new keys, starts vanished ones exiting and updates a class so CSS animations can fire", () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container)
    morpher.show(board(card(1, 0, 'class="float"') + card(2, 20)))
    morpher.show(board(card(1, 0, 'class="locked"') + card(3, 40)))
    expect(container.querySelector("[data-key='card:1']")!.getAttribute("class")).toBe("locked")
    expect(container.querySelector("[data-key='card:2']")!.classList.contains("puzzmo-exit")).toBe(true)
    expect(container.querySelector("[data-key='card:3']")!.classList.contains("puzzmo-enter")).toBe(true)
  })

  it("tweens the viewBox on the root's transform timing without recording it as a transform", async () => {
    useFakeFrames()
    const container = document.createElement("div")
    const timing = vi.fn((_el: Element, _property: string) => linearTiming(100)())
    const morpher = createThumbnailMorpher(container, { timing })
    morpher.show(board(""))
    morpher.show(`<svg data-key="svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><g data-key="board"></g></svg>`)
    const root = container.querySelector("svg")!
    expect(timing.mock.calls.some(([el, property]) => el === root && property === "transform")).toBe(true)
    expect(root.style.getPropertyValue("--puzzmo-from-transform")).toBe("")

    await vi.advanceTimersByTimeAsync(50)
    const height = Number(root.getAttribute("viewBox")!.split(" ")[3])
    expect(height).toBeGreaterThan(100)
    expect(height).toBeLessThan(200)
    await vi.advanceTimersByTimeAsync(100)
    expect(root.getAttribute("viewBox")).toBe("0 0 100 200")
  })
})

describe("svgTransformToCSS", () => {
  it("adds units and expands a pivot rotate", () => {
    expect(svgTransformToCSS("translate(10, 20) rotate(-3)")).toBe("translate(10px, 20px) rotate(-3deg)")
    expect(svgTransformToCSS("rotate(90 105 175)")).toBe("translate(105px, 175px) rotate(90deg) translate(-105px, -175px)")
    expect(svgTransformToCSS("translate(5) scale(2) matrix(1 0 0 1 3 4)")).toBe("translate(5px, 0px) scale(2, 2) matrix(1, 0, 0, 1, 3, 4)")
  })
})

describe("springLinearEasing", () => {
  it("samples a spring into linear() stops that overshoot", () => {
    const easing = springLinearEasing({ stiffness: 320, damping: 26, mass: 1 })
    const stops = easing.slice("linear(".length, -1).split(", ").map(Number)
    expect(Math.max(...stops)).toBeGreaterThan(1)
    expect(stops[stops.length - 1]).toBeCloseTo(1, 1)
  })

  it.each([
    ["critically damped", 40],
    ["overdamped", 120],
  ])("samples a %s spring that rises to 1 without overshooting", (_, damping) => {
    const easing = springLinearEasing({ stiffness: 400, damping, mass: 1 })
    const stops = easing.slice("linear(".length, -1).split(", ").map(Number)
    expect(stops.every((stop) => Number.isFinite(stop))).toBe(true)
    expect(Math.max(...stops)).toBeLessThanOrEqual(1)
    expect(stops[stops.length - 1]).toBe(1)
  })
})

describe("hoistFontFaces", () => {
  it("moves @font-face rules into one page style and strips them from the SVG", () => {
    const svg = `<svg><defs><style>@font-face{font-family:"Dongle";src:url(data:x)}</style></defs></svg>`
    const once = hoistFontFaces(svg)
    expect(once).not.toContain("@font-face")
    const style = document.getElementById("puzzmo-thumbnail-fonts")!
    expect(style.textContent).toContain("Dongle")
    hoistFontFaces(svg)
    expect(style.textContent!.match(/Dongle/g)!.length).toBe(1)
  })
})

describe("lifecycle classes", () => {
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)))

  it("marks the container live after the first render and does not flag initial elements as entering", async () => {
    const container = document.createElement("div")
    createThumbnailMorpher(container).show(board(card(1, 0)))
    expect(container.querySelector("[data-key='card:1']")!.classList.contains("puzzmo-enter")).toBe(false)
    expect(container.classList.contains("puzzmo-live")).toBe(false)
    await nextFrame()
    expect(container.classList.contains("puzzmo-live")).toBe(true)
  })

  it("gives a new key puzzmo-enter for one frame, keeping the renderer's own classes", async () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container)
    morpher.show(board(""))
    morpher.show(board(card(1, 0, 'class="pup-card"')))
    const el = container.querySelector("[data-key='card:1']")!
    expect(el.getAttribute("class")).toBe("pup-card puzzmo-enter")
    await nextFrame()
    expect(el.getAttribute("class")).toBe("pup-card")
  })

  it("keeps a vanished key in place with puzzmo-exit, then removes it, and revives it if it returns", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const morpher = createThumbnailMorpher(container, { exitTimeoutMs: 60 })
    morpher.show(board(card(1, 0) + card(2, 20)))
    const two = container.querySelector("[data-key='card:2']")!
    morpher.show(board(card(1, 0)))
    expect(two.isConnected).toBe(true)
    expect(two.classList.contains("puzzmo-exit")).toBe(true)

    // Back before the exit finishes: same node, class gone
    morpher.show(board(card(1, 0) + card(2, 30)))
    expect(container.querySelector("[data-key='card:2']")).toBe(two)
    expect(two.classList.contains("puzzmo-exit")).toBe(false)

    morpher.show(board(card(1, 0)))
    await new Promise((r) => setTimeout(r, 150))
    expect(two.isConnected).toBe(false)
  })

  it("does not let an exiting node take part in positional matching", async () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container, { exitTimeoutMs: 60 })
    morpher.show(board(card(1, 0) + card(2, 20) + card(3, 40)))
    morpher.show(board(card(1, 0) + card(3, 40)))
    morpher.show(board(card(3, 40) + card(1, 0)))
    const order = Array.from(container.querySelectorAll("[data-key^='card']:not(.puzzmo-exit)")).map((e) => e.getAttribute("data-key"))
    expect(order).toEqual(["card:3", "card:1"])
  })

  it("flags a key that changed parent with puzzmo-moved for a frame", async () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container)
    morpher.show(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g data-key="hand">${card(7, 0)}</g><g data-key="board"></g></svg>`,
    )
    morpher.show(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g data-key="hand"></g><g data-key="board">${card(7, 50)}</g></svg>`,
    )
    const el = container.querySelector("[data-key='card:7']")!
    expect(el.classList.contains("puzzmo-moved")).toBe(true)
    await nextFrame()
    expect(el.classList.contains("puzzmo-moved")).toBe(false)
  })
})

describe("the mirror table", () => {
  // jsdom's style object drops SVG geometry properties, so the spellings are checked on the table itself
  it("spells geometry with units and paths as path()", () => {
    expect(animatedAttributes.x.convert!("12.5")).toBe("12.5px")
    expect(animatedAttributes.x.convert!("50%")).toBe("50%")
    expect(animatedAttributes.d.convert!("M0 0L2 2")).toBe('path("M0 0L2 2")')
    expect(animatedAttributes.fill.convert).toBeUndefined()
    expect(animatedAttributes["stroke-dashoffset"].css).toBe("stroke-dashoffset")
  })

  it("accepts extra rows from the caller", () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container, { attributes: { "data-tint": { css: "--tint" } } })
    const svg = (tint: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g data-key="g" data-tint="${tint}"/></svg>`
    morpher.show(svg("red"))
    morpher.show(svg("blue"))
    expect((container.querySelector("[data-key='g']") as SVGElement).style.getPropertyValue("--puzzmo-from---tint")).toBe("red")
  })

  it("warns once about duplicate keys", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container)
    morpher.show(board(card(1, 0) + card(1, 10)))
    morpher.show(board(card(1, 0) + card(1, 20)))
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("card:1")).length).toBe(1)
    warn.mockRestore()
  })
})

describe("change history", () => {
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)))

  it("flags a kept element whose mirrored attributes changed and records where it came from", async () => {
    const container = document.createElement("div")
    const morpher = createThumbnailMorpher(container)
    morpher.show(board(card(1, 0) + card(2, 20)))
    morpher.show(board(card(1, 40) + card(2, 20)))
    const one = container.querySelector("[data-key='card:1']") as SVGElement
    const two = container.querySelector("[data-key='card:2']") as SVGElement
    expect(one.classList.contains("puzzmo-changed")).toBe(true)
    expect(two.classList.contains("puzzmo-changed")).toBe(false)
    expect(one.style.getPropertyValue("--puzzmo-from-transform")).toBe("translate(0px, 0px) rotate(0deg)")
    expect(one.getAttribute("transform")).toBe("translate(40, 0) rotate(0)")
    await nextFrame()
    expect(one.classList.contains("puzzmo-changed")).toBe(false)

    // The next change starts from the last mirrored value
    morpher.show(board(card(1, 80) + card(2, 20)))
    expect(one.style.getPropertyValue("--puzzmo-from-transform")).toBe("translate(40px, 0px) rotate(0deg)")
  })
})

describe("CSS easing and string mixing", () => {
  it("parses keywords, cubic-bezier and linear() with and without stops", () => {
    expect(parseEasing("linear")(0.25)).toBe(0.25)
    expect(parseEasing("ease-out")(0.5)).toBeGreaterThan(0.5)
    expect(parseEasing("cubic-bezier(0.42, 0, 1, 1)")(0.5)).toBeLessThan(0.5)
    const overshoot = parseEasing("linear(0, 1.2, 1)")
    expect(overshoot(0.5)).toBeCloseTo(1.2, 5)
    expect(overshoot(1)).toBe(1)
    const positioned = parseEasing("linear(0, 0.5 25%, 1)")
    expect(positioned(0.25)).toBeCloseTo(0.5, 5)
    expect(positioned(0.625)).toBeCloseTo(0.75, 5)
  })

  it("falls back to linear for easings it does not understand, never NaN", () => {
    for (const easing of ["steps(4, end)", "cubic-bezier(0.1, oops, 1, 1)", "cubic-bezier(0.1, 0.2)", "linear(0, nope, 1)", ""])
      expect(parseEasing(easing)(0.25)).toBe(0.25)
  })

  it("mixes every number in same-shaped strings and refuses different shapes", () => {
    expect(mixStrings("rotate(0 35 35)", "rotate(90 35 35)")!(0.5)).toBe("rotate(45 35 35)")
    expect(mixStrings("0 0 100 100", "0 0 100 200")!(0.25)).toBe("0 0 100 125")
    expect(mixStrings("#ff0000", "#00ff00")).toBeUndefined()
    // Same digit-run shape, which would otherwise mix into colours that do not parse
    expect(mixStrings("#112233", "#445566")).toBeUndefined()
    expect(mixStrings("translate(1 2)", "rotate(1 2)")).toBeUndefined()
  })
})

describe("the runtime as embeddable source", () => {
  it("builds from its own source text with no outside references", () => {
    const source = thumbnailMotionRuntime.toString()
    expect(source).not.toMatch(/__spread|__assign|__rest/)
    const built = new Function("return (" + source + ")()")() as ReturnType<typeof thumbnailMotionRuntime>
    expect(built.parseEasing("linear(0, 2, 1)")(0.5)).toBe(2)
    expect(built.svgTransformToCSS("rotate(90 10 10)")).toBe("translate(10px, 10px) rotate(90deg) translate(-10px, -10px)")
  })
})

describe("readTransitionTiming", () => {
  it("reads the matching entry of a transition list, honouring all and repeating short lists", () => {
    const runtime = thumbnailMotionRuntime()
    const el = document.createElement("div")
    document.body.appendChild(el)
    el.style.transitionProperty = "opacity, transform"
    el.style.transitionDuration = "100ms, 0.4s"
    el.style.transitionDelay = "50ms"
    el.style.transitionTimingFunction = "linear"
    const timing = runtime.readTransitionTiming(el, "transform")!
    expect(timing.duration).toBe(400)
    expect(timing.delay).toBe(50)
    expect(timing.ease(0.3)).toBe(0.3)
    expect(runtime.readTransitionTiming(el, "fill")).toBeUndefined()

    el.style.transitionProperty = "all"
    expect(runtime.readTransitionTiming(el, "fill")!.duration).toBe(100)

    el.style.transitionDuration = "0s"
    expect(runtime.readTransitionTiming(el, "fill")).toBeUndefined()
    el.remove()
  })
})
