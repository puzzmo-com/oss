import { afterEach, describe, expect, it } from "vitest"

import { h, render } from "./svgJSX"

type FakeNode = { tag: string; attrs: Record<string, unknown>; children: FakeNode[] }

/**
 * The smallest document svgJSX can build against, recording what it asked for. Enough to assert
 * which props become attributes, which is the part games depend on — the real serialization is
 * covered where it runs: browsers, and the isolate shim in @puzzmo-com/app-bundle-sandbox.
 */
const installFakeDocument = () => {
  const created: FakeNode[] = []
  const element = (tag: string): FakeNode => {
    const node: FakeNode = {
      tag,
      attrs: {},
      children: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a stand-in for the DOM's own loose typing
    } as any
    Object.assign(node as any, {
      setAttribute: (name: string, value: unknown) => (node.attrs[name] = value),
      appendChild: (child: FakeNode) => node.children.push(child),
      addEventListener: () => {},
      style: {},
    })
    created.push(node)
    return node
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- installing a stub global for the test
  ;(globalThis as any).document = {
    createElementNS: (_ns: string, tag: string) => element(tag),
    createElement: (tag: string) => element(tag),
    createTextNode: (data: string) => ({ data }),
  }
  return created
}

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- undoing the stub global
  delete (globalThis as any).document
})

describe("svgJSX", () => {
  it("kebab-cases camelCase props, and leaves SVG's own camelCase alone", () => {
    installFakeDocument()
    const node = render(h("svg", { viewBox: "0 0 10 10", strokeWidth: 2 })) as unknown as FakeNode

    expect(node.attrs).toEqual({ viewBox: "0 0 10 10", "stroke-width": 2 })
  })

  it("keeps a component's children out of the element's attributes", () => {
    installFakeDocument()
    // Components are handed `children` in props, so one that spreads its props onto an element
    // used to write `children=""` into the markup.
    const Pane = (props: Record<string, unknown>) => h("rect", { x: 1, ...props })
    const node = render(h("g", {}, h(Pane as any, { fill: "#000" }))) as unknown as FakeNode

    expect(node.children[0].attrs).toEqual({ x: 1, fill: "#000" })
  })
})
