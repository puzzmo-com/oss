/**
 * Dev-only server error page: a self-contained HTML overlay (deliberately no React — it must render even when
 * rendering itself is what broke) with parsed stack frames. App-code frames are clickable and open the file in
 * your editor via Vite's built-in /__open-in-editor endpoint. Never served in production.
 */

export interface StackFrame {
  fnName: string
  file: string
  line: number
  column: number
  /** App code (linkable) vs node_modules / node: internals / vite virtual modules (de-emphasized). */
  isApp: boolean
}

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Parses a V8-style stack trace into structured frames, normalizing file:// URLs and Vite /@fs/ + query-suffixed paths. */
export const parseStackFrames = (stack: string): StackFrame[] => {
  const frames: StackFrame[] = []

  for (const rawLine of stack.split("\n")) {
    const line = rawLine.trim()
    if (!line.startsWith("at ")) continue

    // "at fnName (file:line:col)" or "at file:line:col"
    const match = line.match(/^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/)
    if (!match) continue

    let file = match[2]
    if (file.startsWith("file://")) file = file.slice("file://".length)
    if (file.startsWith("/@fs/")) file = file.slice("/@fs".length)
    file = file.replace(/\?[^?]*$/, "") // strip vite transform queries (?t=…, ?import)

    const isApp = !file.includes("node_modules") && !file.startsWith("node:") && !file.startsWith("virtual:")

    frames.push({
      fnName: match[1] ?? "",
      file,
      line: Number(match[3]),
      column: Number(match[4]),
      isApp,
    })
  }

  return frames
}

/** Builds the full dev error page HTML for an uncaught SSR error. */
export const buildErrorPageHtml = (error: Error, options: { pathname: string }): string => {
  const frames = parseStackFrames(error.stack ?? "")

  const frameRows = frames
    .map((frame) => {
      const location = `${frame.file}:${frame.line}:${frame.column}`
      const fn = frame.fnName ? `<span class="fn">${escapeHtml(frame.fnName)}</span> ` : ""
      if (!frame.isApp) return `<div class="frame dim">${fn}<span>${escapeHtml(location)}</span></div>`
      return `<div class="frame">${fn}<a href="#" data-file="${escapeHtml(location)}">${escapeHtml(location)}</a></div>`
    })
    .join("\n")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SSR error — ${escapeHtml(options.pathname)}</title>
<style>
  body { margin: 0; padding: 2rem; background: #1b1d1e; color: #e8e6e3; font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
  h1 { font-size: 16px; color: #ff5f56; margin: 0 0 0.25rem; }
  .path { color: #8b949e; margin-bottom: 1.5rem; }
  .message { background: #2d1a1a; border: 1px solid #5c2626; border-radius: 6px; padding: 1rem; white-space: pre-wrap; margin-bottom: 1.5rem; }
  .frame { padding: 2px 0; }
  .frame .fn { color: #d2a8ff; }
  .frame a { color: #58a6ff; text-decoration: none; }
  .frame a:hover { text-decoration: underline; }
  .frame.dim { color: #6e7681; }
  .hint { margin-top: 2rem; color: #6e7681; font-size: 12px; }
</style>
</head>
<body>
<h1>SSR error</h1>
<div class="path">${escapeHtml(options.pathname)}</div>
<div class="message">${escapeHtml(error.message)}</div>
<div class="stack">
${frameRows}
</div>
<div class="hint">App frames open in your editor via Vite's /__open-in-editor. This page is dev-only; production serves a sanitized 500.</div>
<script>
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-file]")
    if (!link) return
    event.preventDefault()
    fetch("/__open-in-editor?file=" + encodeURIComponent(link.dataset.file))
  })
</script>
</body>
</html>`
}
