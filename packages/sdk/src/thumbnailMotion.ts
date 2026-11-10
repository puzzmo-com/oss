/**
 * Thumbnail motion: animating between two renders of a game's thumbnail.
 *
 * A thumbnail is still `renderThumbnail(puzzle, input, config) -> SVG text`. A host that shows one
 * live keeps the SVG in the DOM and morphs it to match each new render, matching elements by
 * `data-key`. The thumbnail's own `<style>` says how things move, in ordinary CSS; the runtime here
 * supplies what CSS cannot do alone:
 *
 * - Attribute tweens timed by CSS. When an animatable attribute (`transform`, `fill`, `x`, `d`...) changes on a kept element, the runtime
 *   reads the `transition` the element's CSS declares for the matching property and tweens the attribute itself, number by number, over
 *   that duration, delay and easing. `linear()`, `cubic-bezier()` and the keyword easings are understood. The attribute is the only thing
 *   that moves, so every engine places it the same way (CSS transforms on SVG elements do not agree between Safari and Chrome).
 * - Lifecycle classes: `puzzmo-enter`, `puzzmo-changed`, `puzzmo-moved` and `puzzmo-exit` on keyed elements, each kept while the element's
 *   animations run; `puzzmo-live` on the container after the first paint.
 * - History: `--puzzmo-from-<property>` holds the previous value in CSS syntax.
 * - A host stylesheet with named spring easings and a zero-specificity default transition.
 *
 * The whole runtime lives inside one function with no outside references, so a host can embed its
 * source in a sandboxed document (`thumbnailMotionRuntime.toString()`) as well as import it.
 */

/** How long and how a change moves, as read from the element's CSS transition */
export type Timing = {
  /** Milliseconds */
  duration: number
  /** Milliseconds */
  delay: number
  ease: (progress: number) => number
}

/** How one animatable attribute relates to CSS */
export type AnimatedAttributeRule = {
  /** The CSS property whose `transition` times this attribute, and whose `--puzzmo-from-` value is recorded */
  css: string
  /** Spells the attribute's value in CSS syntax for `--puzzmo-from-`; identity when absent */
  convert?: (value: string) => string
  /** False when the value has no CSS spelling, so no `--puzzmo-from-` is recorded (default true) */
  history?: boolean
}

export type ThumbnailMorphOptions = {
  /** Extra attribute rows, merged over `animatedAttributes` */
  attributes?: Record<string, AnimatedAttributeRule>
  /** Longest an exiting element is kept waiting for its animations, in ms (default 1500) */
  exitTimeoutMs?: number
  /** Warn on contract mistakes such as duplicate keys (default true) */
  warn?: boolean
  /** Where timing comes from; defaults to the element's computed CSS transition. Tests inject one. */
  timing?: (el: Element, cssProperty: string) => Timing | undefined
  /** Told each time a lifecycle class goes onto an element */
  onLifecycle?: (el: Element, className: string) => void
}

export type ThumbnailMorpher = {
  /** Morphs the container's SVG to match `svg`; the first call inserts it. False, and nothing changes, when `svg` does not parse. */
  show: (svg: string) => boolean
  /** Stops every running tween */
  dispose: () => void
}

export type ThumbnailMotionRuntime = ReturnType<typeof thumbnailMotionRuntime>

/**
 * Builds the runtime. Everything it needs is inside, so the function's source can be serialised into
 * another document. Keep it that way: no references to module scope, and no syntax that needs a
 * transpiler helper (object spread, for one).
 */
export function thumbnailMotionRuntime() {
  const lifecycle = {
    container: "puzzmo-thumbnail-morph",
    live: "puzzmo-live",
    enter: "puzzmo-enter",
    exit: "puzzmo-exit",
    moved: "puzzmo-moved",
    changed: "puzzmo-changed",
  }
  const lifecycleClasses = [lifecycle.enter, lifecycle.exit, lifecycle.moved, lifecycle.changed]
  const lifecycleTimeoutMs = 2000
  const hostStyleID = "puzzmo-thumbnail-motion"
  const fontStyleID = "puzzmo-thumbnail-fonts"

  /** Unitless attribute lengths are valid CSS only with a unit */
  const px = (value: string) => (/^-?\d*\.?\d+$/.test(value.trim()) ? value.trim() + "px" : value)

  /**
   * Attributes the runtime tweens, each with the CSS property it takes its timing from. Add a row to
   * let thumbnails animate another attribute; the morph consults this table and nothing else.
   */
  const animatedAttributes: Record<string, AnimatedAttributeRule> = {
    transform: { css: "transform", convert: (v) => svgTransformToCSS(v) },
    x: { css: "x", convert: px },
    y: { css: "y", convert: px },
    cx: { css: "cx", convert: px },
    cy: { css: "cy", convert: px },
    r: { css: "r", convert: px },
    rx: { css: "rx", convert: px },
    ry: { css: "ry", convert: px },
    width: { css: "width", convert: px },
    height: { css: "height", convert: px },
    d: { css: "d", convert: (v) => 'path("' + v.replace(/"/g, "'") + '")' },
    fill: { css: "fill" },
    "fill-opacity": { css: "fill-opacity" },
    stroke: { css: "stroke" },
    "stroke-width": { css: "stroke-width" },
    "stroke-opacity": { css: "stroke-opacity" },
    "stroke-dasharray": { css: "stroke-dasharray" },
    "stroke-dashoffset": { css: "stroke-dashoffset" },
    opacity: { css: "opacity" },
    "font-size": { css: "font-size", convert: px },
    "letter-spacing": { css: "letter-spacing", convert: px },
    // Timed by the root's transform transition; a viewBox is not a CSS transform, so it records no history
    viewBox: { css: "transform", history: false },
  }

  // ---- easing -------------------------------------------------------------------------------

  const cubicBezier = (x1: number, y1: number, x2: number, y2: number) => {
    const sx = (t: number) => 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t
    const sy = (t: number) => 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t
    return (x: number) => {
      let lo = 0
      let hi = 1
      let t = x
      for (let i = 0; i < 24; i++) {
        const cx = sx(t)
        if (Math.abs(cx - x) < 1e-5) break
        if (cx < x) lo = t
        else hi = t
        t = (lo + hi) / 2
      }
      return sy(t)
    }
  }

  const keywordEasings: Record<string, [number, number, number, number]> = {
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
  }

  /**
   * Turns a CSS easing into a progress function: keywords, cubic-bezier() and linear() with optional
   * stops. Anything else (`steps()`, or a malformed value) is linear.
   */
  const parseEasing = (value: string): ((t: number) => number) => {
    const v = value.trim()
    if (v === "linear") return (t) => t
    const keyword = keywordEasings[v]
    if (keyword) return cubicBezier(keyword[0], keyword[1], keyword[2], keyword[3])
    const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(v)
    if (bezier) {
      const n = bezier[1].split(",").map(Number)
      if (n.length !== 4 || n.some((x) => Number.isNaN(x))) return (t) => t
      return cubicBezier(n[0], n[1], n[2], n[3])
    }
    const lin = /^linear\(([^)]+)\)$/.exec(v)
    if (lin) {
      const stops = lin[1].split(",").map((s) => {
        const parts = s.trim().split(/\s+/)
        return { value: Number(parts[0]), at: parts[1] ? parseFloat(parts[1]) / 100 : NaN }
      })
      if (stops.some((stop) => Number.isNaN(stop.value))) return (t) => t
      if (Number.isNaN(stops[0].at)) stops[0].at = 0
      if (Number.isNaN(stops[stops.length - 1].at)) stops[stops.length - 1].at = 1
      // Missing positions spread evenly between the known ones on either side
      let last = 0
      for (let i = 0; i < stops.length; i++) {
        if (!Number.isNaN(stops[i].at)) {
          last = i
          continue
        }
        let next = i
        while (Number.isNaN(stops[next].at)) next++
        for (let j = last + 1; j < next; j++)
          stops[j].at = stops[last].at + ((stops[next].at - stops[last].at) * (j - last)) / (next - last)
        last = next
      }
      return (t) => {
        if (t <= stops[0].at) return stops[0].value
        for (let i = 1; i < stops.length; i++) {
          if (t <= stops[i].at) {
            const a = stops[i - 1]
            const b = stops[i]
            return a.value + ((b.value - a.value) * (t - a.at)) / (b.at - a.at || 1)
          }
        }
        return stops[stops.length - 1].value
      }
    }
    return (t) => t
  }

  /** Samples a damped spring into a CSS linear() easing. Stops above 1 are allowed, so overshoot survives. */
  const springLinearEasing = (options: { stiffness: number; damping: number; mass: number }): string => {
    const w0 = Math.sqrt(options.stiffness / options.mass)
    const zeta = options.damping / (2 * Math.sqrt(options.stiffness * options.mass))
    const position = (t: number) => {
      if (zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta)
        return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
      }
      if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
      const s1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1))
      const s2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1))
      return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1)
    }
    const stops: string[] = []
    let settledFor = 0
    for (let ms = 0; ms < 5000; ms += 16) {
      const x = position(ms / 1000)
      stops.push(x.toFixed(4))
      settledFor = Math.abs(x - 1) < 0.001 ? settledFor + 1 : 0
      if (settledFor >= 3) break
    }
    stops[stops.length - 1] = "1"
    return "linear(" + stops.join(", ") + ")"
  }

  /** The host's half of the contract: named easings and durations, and a default transition the renderer can override */
  const hostStylesheet = [
    ":root { --puzzmo-ease-float: " +
      springLinearEasing({ stiffness: 320, damping: 26, mass: 1 }) +
      "; --puzzmo-ease-settle: " +
      springLinearEasing({ stiffness: 500, damping: 34, mass: 1 }) +
      "; --puzzmo-duration-fast: 0.18s; --puzzmo-duration-base: 0.35s; --puzzmo-duration-slow: 0.5s; }",
    // :where() keeps this at zero specificity, so any selector in the thumbnail's own style wins
    ":where(." +
      lifecycle.container +
      " [data-key]) { transition: transform var(--puzzmo-duration-base) ease-in-out, fill var(--puzzmo-duration-base) ease-in-out, opacity var(--puzzmo-duration-base) ease-in-out; }",
    "@media (prefers-reduced-motion: reduce) { :where(." + lifecycle.container + " [data-key]) { transition-duration: 0s; } }",
  ].join("\n")

  const installHostStylesheet = (doc: Document) => {
    if (doc.getElementById(hostStyleID)) return
    const style = doc.createElement("style")
    style.id = hostStyleID
    style.textContent = hostStylesheet
    doc.head.appendChild(style)
  }

  // ---- strings ------------------------------------------------------------------------------

  const numberPattern = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi
  const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, ""))

  /**
   * Interpolates every number in two same-shaped strings, e.g. "rotate(0 35 35)" to "rotate(90 35 35)";
   * undefined if the shapes differ. Hex colours are refused: their digit runs are not numbers, so
   * mixing "#112233" toward "#445566" would pass through colours that do not parse.
   */
  const mixStrings = (from: string, to: string): ((p: number) => string) | undefined => {
    if (from.indexOf("#") !== -1 || to.indexOf("#") !== -1) return undefined
    const a = (from.match(numberPattern) || []).map(Number)
    const b = (to.match(numberPattern) || []).map(Number)
    if (!a.length || a.length !== b.length || from.replace(numberPattern, "#") !== to.replace(numberPattern, "#")) return undefined
    const template = to.split(numberPattern)
    return (p) => {
      let out = template[0]
      for (let i = 0; i < a.length; i++) out += round(a[i] + (b[i] - a[i]) * p) + template[i + 1]
      return out
    }
  }

  /**
   * Rewrites an SVG transform attribute as a CSS transform value, for `--puzzmo-from-transform`. A
   * three-value rotate becomes the translate-rotate-translate it stands for.
   */
  const svgTransformToCSS = (value: string): string => {
    const out: string[] = []
    const fn = /([a-zA-Z]+)\s*\(([^)]*)\)/g
    let m: RegExpExecArray | null
    while ((m = fn.exec(value))) {
      const name = m[1]
      const n = m[2]
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
      if (name === "translate") out.push("translate(" + (n[0] || 0) + "px, " + (n[1] || 0) + "px)")
      else if (name === "rotate") {
        if (n.length >= 3)
          out.push("translate(" + n[1] + "px, " + n[2] + "px) rotate(" + n[0] + "deg) translate(" + -n[1] + "px, " + -n[2] + "px)")
        else out.push("rotate(" + (n[0] || 0) + "deg)")
      } else if (name === "scale")
        out.push("scale(" + (n[0] === undefined ? 1 : n[0]) + ", " + (n[1] === undefined ? (n[0] === undefined ? 1 : n[0]) : n[1]) + ")")
      else if (name === "skewX" || name === "skewY") out.push(name + "(" + (n[0] || 0) + "deg)")
      else if (name === "matrix") out.push("matrix(" + n.join(", ") + ")")
    }
    return out.join(" ")
  }

  /** Splits a CSS list on commas that are not inside parentheses */
  const splitTopLevel = (value: string): string[] => {
    const out: string[] = []
    let depth = 0
    let current = ""
    for (const ch of value || "") {
      if (ch === "(") depth++
      if (ch === ")") depth--
      if (ch === "," && depth === 0) {
        out.push(current.trim())
        current = ""
      } else current += ch
    }
    if (current.trim()) out.push(current.trim())
    return out
  }

  /** A CSS time ("0.3s", "120ms") in milliseconds */
  const parseTimeMs = (value: string): number => {
    const v = value.trim()
    if (v.endsWith("ms")) return parseFloat(v)
    if (v.endsWith("s")) return parseFloat(v) * 1000
    return parseFloat(v) || 0
  }

  /**
   * Reads the transition an element's CSS declares for `property`, honouring `all` and the usual
   * comma lists. Undefined when nothing applies or the duration is zero, in which case the change
   * lands at once (which is also what `prefers-reduced-motion` produces through the host stylesheet).
   */
  const readTransitionTiming = (el: Element, property: string): Timing | undefined => {
    const cs = getComputedStyle(el)
    const properties = splitTopLevel(cs.transitionProperty)
    const durations = splitTopLevel(cs.transitionDuration)
    const delays = splitTopLevel(cs.transitionDelay)
    const easings = splitTopLevel(cs.transitionTimingFunction)
    let found: Timing | undefined
    properties.forEach((name, i) => {
      if (name !== property && name !== "all") return
      // Lists repeat to the length of transition-property, as the cascade does
      const duration = parseTimeMs(durations[i % Math.max(1, durations.length)] || "0s")
      const delay = parseTimeMs(delays[i % Math.max(1, delays.length)] || "0s")
      const ease = parseEasing(easings[i % Math.max(1, easings.length)] || "ease")
      found = { duration, delay, ease }
    })
    return found && found.duration > 0 ? found : undefined
  }

  // ---- DOM helpers --------------------------------------------------------------------------

  const nextFrame = (fn: () => void) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn)
    else setTimeout(fn, 16)
  }

  const getAnimations = (el: Element): Animation[] => {
    try {
      return el.getAnimations({ subtree: true })
    } catch {
      return []
    }
  }

  const settled = (el: Element, capMs: number) =>
    Promise.race([
      Promise.all(getAnimations(el).map((a) => a.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, capMs)),
    ])

  const parseSVG = (svg: string): SVGSVGElement | undefined => {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml")
    if (doc.querySelector("parsererror")) return undefined
    // An xmlns-less root parses into the null namespace, which renders as nothing
    if (doc.documentElement.namespaceURI !== "http://www.w3.org/2000/svg") return undefined
    return doc.documentElement as unknown as SVGSVGElement
  }

  /** The forgiving fallback: the HTML parser fixes a missing xmlns, unclosed tags and HTML entities */
  const parseSVGViaHTML = (svg: string): SVGSVGElement | undefined => {
    const doc = new DOMParser().parseFromString(svg, "text/html")
    return (doc.querySelector("svg") as SVGSVGElement | null) ?? undefined
  }

  const sizeToContainer = (svg: SVGSVGElement) => {
    svg.style.display = "block"
    svg.style.width = "100%"
    svg.style.height = "100%"
  }

  const hoistedFontRules: string[] = []

  /**
   * Moves a thumbnail's `@font-face` rules out of the SVG into one document-level style element.
   * Re-declaring a family the page already uses on every render makes the browser re-resolve all
   * of that family's text, which flashes. Each rule is added once; a family the document already
   * serves is skipped. Returns the SVG with those rules removed.
   */
  const hoistFontFaces = (svg: string, doc: Document): string => {
    const extracted = extractFontFaces(svg)
    installFontFaces(extracted.rules, doc)
    return extracted.svg
  }

  /** Splits a thumbnail's `@font-face` rules from the rest of its markup, touching no document */
  const extractFontFaces = (svg: string): { svg: string; rules: string[] } => {
    const rules: string[] = []
    if (svg.indexOf("@font-face") === -1) return { svg, rules }
    const stripped = svg.replace(/@font-face\s*\{[^}]*\}/g, (rule) => {
      rules.push(rule)
      return ""
    })
    return { svg: stripped, rules }
  }

  /** Adds the rules this document has not seen to its shared font style element */
  const installFontFaces = (rules: string[], doc: Document) => {
    const fresh = rules.filter((rule) => {
      if (hoistedFontRules.indexOf(rule) !== -1) return false
      hoistedFontRules.push(rule)
      const family = /font-family\s*:\s*["']?([^;"'}]+)/.exec(rule)
      return !family || !documentHasFontFamily(doc, family[1].trim())
    })
    if (fresh.length) {
      let style = doc.getElementById(fontStyleID) as HTMLStyleElement | null
      if (!style) {
        style = doc.createElement("style")
        style.id = fontStyleID
        doc.head.appendChild(style)
      }
      style.textContent += fresh.join("\n") + "\n"
    }
  }

  const documentHasFontFamily = (doc: Document, family: string): boolean => {
    try {
      let found = false
      doc.fonts.forEach((face) => {
        if (face.family.replace(/^["']|["']$/g, "") === family) found = true
      })
      return found
    } catch {
      return false
    }
  }

  const warnedKeySets: string[] = []

  /** Duplicate keys make matching ambiguous, so say so once per offending set */
  const warnAboutKeys = (root: Element) => {
    const seen: Record<string, true> = {}
    const dupes: string[] = []
    root.querySelectorAll("[data-key]").forEach((el) => {
      const key = el.getAttribute("data-key") || ""
      if (seen[key] && dupes.indexOf(key) === -1) dupes.push(key)
      seen[key] = true
    })
    if (!dupes.length) return
    const signature = dupes.sort().join(",")
    if (warnedKeySets.indexOf(signature) !== -1) return
    warnedKeySets.push(signature)
    console.warn("Thumbnail SVG repeats data-key values, so they cannot be matched between renders: " + signature)
  }

  // ---- tweens -------------------------------------------------------------------------------

  type Running = { timing: Timing; start: number; to: string; apply: (progress: number) => void }

  /** One running tween per element and attribute, on a shared frame loop */
  const createTweens = () => {
    const running = new Map<Element, Map<string, Running>>()
    let scheduled = false
    const tick = () => {
      scheduled = false
      const now = performance.now()
      running.forEach((byAttr, el) => {
        byAttr.forEach((t, attribute) => {
          const elapsed = now - t.start - t.timing.delay
          if (elapsed < 0) return
          const progress = Math.min(1, elapsed / t.timing.duration)
          t.apply(progress >= 1 ? 1 : t.timing.ease(progress))
          if (progress >= 1) byAttr.delete(attribute)
        })
        if (!byAttr.size) running.delete(el)
      })
      if (running.size) schedule()
    }
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      nextFrame(tick)
    }
    return {
      start(el: Element, attribute: string, timing: Timing, to: string, apply: (progress: number) => void) {
        let byAttr = running.get(el)
        if (!byAttr) {
          byAttr = new Map()
          running.set(el, byAttr)
        }
        byAttr.set(attribute, { timing, start: performance.now(), to, apply })
        schedule()
      },
      /** Where a running tween is headed, if one is */
      target(el: Element, attribute: string): string | undefined {
        const t = running.get(el)?.get(attribute)
        return t ? t.to : undefined
      },
      cancel(el: Element, attribute: string) {
        const byAttr = running.get(el)
        if (byAttr) byAttr.delete(attribute)
      },
      cancelAll(el: Element) {
        running.delete(el)
      },
      clear() {
        running.clear()
      },
    }
  }

  // ---- the morph ----------------------------------------------------------------------------

  const createThumbnailMorpher = (container: HTMLElement, options?: ThumbnailMorphOptions): ThumbnailMorpher => {
    const opts = options || {}
    const doc = container.ownerDocument
    container.classList.add(lifecycle.container)
    installHostStylesheet(doc)
    const attributes = Object.assign({}, animatedAttributes, opts.attributes || {})
    const exitTimeoutMs = opts.exitTimeoutMs === undefined ? 1500 : opts.exitTimeoutMs
    const warn = opts.warn === undefined ? true : opts.warn
    const timingOf = opts.timing || readTransitionTiming
    const onLifecycle = opts.onLifecycle
    const exiting = new Set<Element>()
    const tweens = createTweens()
    let rendered = false

    /**
     * Adds a lifecycle class and keeps it while the element animates: a frame at least (with a style
     * flush, so a transition can start from the class's styles), or until the animations it started
     * finish, so a CSS animation keyed on the class is not cut off when the class goes.
     */
    const hold = (el: Element, className: string) => {
      el.classList.add(className)
      if (onLifecycle) onLifecycle(el, className)
      void (el as HTMLElement).getBoundingClientRect()
      nextFrame(() => {
        if (!getAnimations(el).length) return el.classList.remove(className)
        settled(el, lifecycleTimeoutMs).then(() => el.classList.remove(className))
      })
    }

    const startExit = (el: Element) => {
      exiting.add(el)
      el.classList.add(lifecycle.exit)
      if (onLifecycle) onLifecycle(el, lifecycle.exit)
      nextFrame(() => {
        if (!exiting.has(el)) return
        settled(el, exitTimeoutMs).then(() => {
          if (!exiting.has(el)) return
          exiting.delete(el)
          tweens.cancelAll(el)
          el.remove()
        })
      })
    }

    /** Moves an attribute from where it is to `to` on the CSS-declared timing, or at once without one */
    const tween = (el: Element, attribute: string, rule: AnimatedAttributeRule, from: string, to: string) => {
      const timing = timingOf(el, rule.css)
      const mixer = timing && timing.duration > 0 ? mixStrings(from, to) : undefined
      if (!timing || !mixer) {
        tweens.cancel(el, attribute)
        el.setAttribute(attribute, to)
        return
      }
      tweens.start(el, attribute, timing, to, (p) => el.setAttribute(attribute, p >= 1 ? to : mixer(p)))
    }

    // The style each element last got from the renderer: the live attribute also serialises the
    // runtime's --puzzmo-from-* history, so it never matches the markup
    const renderedStyles = new WeakMap<Element, string | null>()

    /** Applies the renderer's inline style when it changed, keeping the runtime's history properties */
    const syncStyle = (oldEl: Element, newEl: Element, style: CSSStyleDeclaration) => {
      const next = newEl.getAttribute("style")
      const previous = renderedStyles.has(oldEl) ? renderedStyles.get(oldEl) : oldEl.getAttribute("style")
      renderedStyles.set(oldEl, next)
      if (previous === next) return
      const history: [string, string][] = []
      for (let i = 0; i < style.length; i++) {
        const name = style[i]
        if (name.indexOf("--puzzmo-from-") === 0) history.push([name, style.getPropertyValue(name)])
      }
      if (next === null) oldEl.removeAttribute("style")
      else oldEl.setAttribute("style", next)
      history.forEach(([name, value]) => style.setProperty(name, value))
    }

    /**
     * Copies attributes across. An animatable attribute that changed is tweened rather than set, and
     * its previous value is recorded in `--puzzmo-from-<property>`. Returns whether anything animatable changed.
     */
    const syncAttributes = (oldEl: Element, newEl: Element): boolean => {
      const style = (oldEl as SVGElement).style
      let changed = false
      // First, so the history written below lands on top of the renderer's style rather than under it
      if (style) syncStyle(oldEl, newEl, style)
      Array.from(newEl.attributes).forEach((attr) => {
        if (attr.name === "style") return
        // The live attribute: mid-tween it is where the eye currently sees the element
        const was = oldEl.getAttribute(attr.name)
        // A tween already heading to this value carries on, rather than restarting its easing
        const target = tweens.target(oldEl, attr.name)
        if ((target === undefined ? was : target) === attr.value) return
        // Lifecycle classes the host put on the old node survive a class attribute update from the renderer
        if (attr.name === "class") {
          const kept = lifecycleClasses.filter((c) => oldEl.classList.contains(c))
          oldEl.setAttribute("class", [attr.value].concat(kept).join(" ").trim())
          return
        }
        const rule = attributes[attr.name]
        if (was !== null && rule) {
          if (style && rule.history !== false) style.setProperty("--puzzmo-from-" + rule.css, rule.convert ? rule.convert(was) : was)
          tween(oldEl, attr.name, rule, was, attr.value)
          changed = true
        } else {
          oldEl.setAttribute(attr.name, attr.value)
        }
      })
      Array.from(oldEl.attributes).forEach((attr) => {
        if (attr.name === "style" || attr.name === "class" || newEl.hasAttribute(attr.name)) return
        // Cancelled first, or its next frame writes the dropped attribute straight back
        tweens.cancel(oldEl, attr.name)
        oldEl.removeAttribute(attr.name)
        const rule = attributes[attr.name]
        if (rule) {
          if (style && rule.history !== false) style.removeProperty("--puzzmo-from-" + rule.css)
          changed = true
        }
      })
      if (!newEl.hasAttribute("class") && oldEl.hasAttribute("class")) {
        const kept = lifecycleClasses.filter((c) => oldEl.classList.contains(c))
        if (kept.length) oldEl.setAttribute("class", kept.join(" "))
        else oldEl.removeAttribute("class")
      }
      return changed
    }

    /** Makes `oldEl` look like `newEl`, keeping nodes (and so their animation state) wherever it can */
    const morph = (oldEl: Element, newEl: Element, keyed: Map<string, Element>, initial: boolean) => {
      const changed = syncAttributes(oldEl, newEl)
      if (changed && oldEl.hasAttribute("data-key")) hold(oldEl, lifecycle.changed)

      // Text-only nodes such as <style> and <text>: a changed string is just replaced
      if (newEl.children.length === 0 && oldEl.children.length === 0) {
        if (oldEl.textContent !== newEl.textContent) oldEl.textContent = newEl.textContent
        return
      }

      // Exiting children keep their place but take no part in matching; `live` is the order being built
      const live = Array.from(oldEl.children).filter((c) => !exiting.has(c))
      const used = new Set<Element>()

      Array.from(newEl.children).forEach((newChild, cursor) => {
        const key = newChild.getAttribute("data-key")
        let match: Element | undefined
        if (key) {
          const existing = keyed.get(key)
          if (existing && !used.has(existing) && existing.localName === newChild.localName) match = existing
        } else {
          match = live.find((c, i) => i >= cursor && !used.has(c) && !c.hasAttribute("data-key") && c.localName === newChild.localName)
        }

        if (match) {
          used.add(match)
          const movedParent = match.parentElement !== oldEl
          if (exiting.has(match)) {
            exiting.delete(match)
            match.classList.remove(lifecycle.exit)
          }
          if (live[cursor] !== match) {
            oldEl.insertBefore(match, live[cursor] || null)
            const from = live.indexOf(match)
            if (from !== -1) live.splice(from, 1)
            live.splice(cursor, 0, match)
          }
          if (movedParent) hold(match, lifecycle.moved)
          morph(match, newChild, keyed, initial)
        } else {
          const created = doc.importNode(newChild, true)
          oldEl.insertBefore(created, live[cursor] || null)
          live.splice(cursor, 0, created)
          created.querySelectorAll("[data-key]").forEach((el) => keyed.set(el.getAttribute("data-key") || "", el))
          if (created.hasAttribute("data-key")) {
            keyed.set(created.getAttribute("data-key") || "", created)
            if (!initial) hold(created, lifecycle.enter)
          }
        }
      })

      // Anything live beyond the new children is gone from the markup: keyed nodes leave, the rest go now
      live.slice(newEl.children.length).forEach((leftover) => {
        if (used.has(leftover)) return
        if (leftover.hasAttribute("data-key")) startExit(leftover)
        else leftover.remove()
      })

      // Direct text nodes (mixed content like <text>Score: <tspan>5</tspan></text>, or a node whose
      // children all left): rebuilt when the strings differ, each placed before its following element
      if (directText(oldEl) !== directText(newEl)) {
        Array.from(oldEl.childNodes).forEach((n) => n.nodeType === 3 && oldEl.removeChild(n))
        let cursor = 0
        Array.from(newEl.childNodes).forEach((n) => {
          if (n.nodeType === 1) cursor++
          else if (n.nodeType === 3) oldEl.insertBefore(doc.importNode(n, true), (cursor < newEl.children.length && live[cursor]) || null)
        })
      }
    }

    /** An element's own text, ignoring what sits inside child elements */
    const directText = (el: Element) => Array.from(el.childNodes).reduce((s, n) => (n.nodeType === 3 ? s + n.nodeValue : s), "")

    const show = (rawSVG: string): boolean => {
      // Parsed before the fonts go in, so markup that fails leaves the document as it was.
      // Strict XML first; renderers are hand-written, so markup it refuses (a missing xmlns,
      // &nbsp;, an unclosed tag) falls back to the HTML parser rather than rendering nothing
      const extracted = extractFontFaces(rawSVG)
      let parsed = parseSVG(extracted.svg)
      if (!parsed) {
        parsed = parseSVGViaHTML(extracted.svg)
        if (parsed && warn)
          console.warn(
            "Thumbnail SVG is not well-formed XML (missing xmlns, an HTML entity, an unclosed tag), so the HTML parser rendered it: " +
              rawSVG.slice(0, 200),
          )
      }
      if (!parsed) {
        if (warn) console.warn("Thumbnail SVG did not parse, so the previous render stays: " + rawSVG.slice(0, 200))
        return false
      }
      // A <meta http-equiv="refresh"> in a foreignObject could navigate the sandboxed display
      // document away from its CSP; thumbnails have no legitimate use for meta at all
      parsed.querySelectorAll("meta").forEach((m) => m.remove())
      installFontFaces(extracted.rules, doc)
      if (warn) warnAboutKeys(parsed)

      const current = container.querySelector("svg")
      if (!current) {
        const inserted = doc.importNode(parsed, true)
        container.innerHTML = ""
        container.appendChild(inserted)
        sizeToContainer(inserted)
        rendered = true
        nextFrame(() => container.classList.add(lifecycle.live))
        return true
      }

      // Every keyed element in the live tree, so one can be pulled into a new parent instead of recreated
      const keyed = new Map<string, Element>()
      current.querySelectorAll("[data-key]").forEach((el) => keyed.set(el.getAttribute("data-key") || "", el))
      morph(current, parsed, keyed, !rendered)
      sizeToContainer(current)
      return true
    }

    return { show, dispose: () => tweens.clear() }
  }

  return {
    lifecycle,
    animatedAttributes,
    hostStylesheet,
    installHostStylesheet,
    createThumbnailMorpher,
    readTransitionTiming,
    parseEasing,
    mixStrings,
    svgTransformToCSS,
    springLinearEasing,
    hoistFontFaces,
  }
}

const runtime = typeof document === "undefined" ? undefined : thumbnailMotionRuntime()

/** The lifecycle class names the runtime puts on elements and the container */
export const lifecycle = {
  container: "puzzmo-thumbnail-morph",
  live: "puzzmo-live",
  enter: "puzzmo-enter",
  exit: "puzzmo-exit",
  moved: "puzzmo-moved",
  changed: "puzzmo-changed",
}

/** Keeps a container's SVG in the DOM and morphs it to match each render it is shown */
export const createThumbnailMorpher = (container: HTMLElement, options?: ThumbnailMorphOptions): ThumbnailMorpher =>
  (runtime || thumbnailMotionRuntime()).createThumbnailMorpher(container, options)

/** The attributes the runtime tweens, with the CSS property each takes its timing from */
export const animatedAttributes = (runtime || thumbnailMotionRuntime()).animatedAttributes
/** Reads the transition an element's CSS declares for a property */
export const readTransitionTiming = (el: Element, property: string) =>
  (runtime || thumbnailMotionRuntime()).readTransitionTiming(el, property)
/** A CSS easing as a progress function */
export const parseEasing = (value: string) => (runtime || thumbnailMotionRuntime()).parseEasing(value)
/** Interpolates every number in two same-shaped strings */
export const mixStrings = (from: string, to: string) => (runtime || thumbnailMotionRuntime()).mixStrings(from, to)
/** An SVG transform attribute in CSS syntax */
export const svgTransformToCSS = (value: string) => (runtime || thumbnailMotionRuntime()).svgTransformToCSS(value)
/** A damped spring sampled into a CSS linear() easing */
export const springLinearEasing = (options: { stiffness: number; damping: number; mass: number }) =>
  (runtime || thumbnailMotionRuntime()).springLinearEasing(options)
/** Moves a thumbnail's @font-face rules into one document-level style, so re-renders do not flash text */
export const hoistFontFaces = (svg: string, doc: Document = document) => (runtime || thumbnailMotionRuntime()).hoistFontFaces(svg, doc)
/** The host stylesheet: named easings, durations and the default transition for keyed elements */
export const hostStylesheet = (runtime || thumbnailMotionRuntime()).hostStylesheet
/** Adds the host stylesheet to a document once */
export const installHostStylesheet = (doc: Document = document) => (runtime || thumbnailMotionRuntime()).installHostStylesheet(doc)
