/**
 * Dev-only /_tapped devtools page: a self-contained HTML view of the app's resolved route graph — path, render
 * mode, loader/middleware/headers wiring, plus any app-specific route metadata. The same serialized graph is
 * available as JSON at /_tapped.json for tooling. Built from buildAppGraph so the page and the JSON never drift.
 */
import { AppGraphRoute } from "../routing/appGraph.js"

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const flattenRoutes = (routes: AppGraphRoute[], depth = 0): { route: AppGraphRoute; depth: number }[] =>
  routes.flatMap((route) => [{ route, depth }, ...(route.children ? flattenRoutes(route.children, depth + 1) : [])])

/** Builds the /_tapped devtools HTML page from a serialized app graph. */
export const buildDevtoolsHtml = (graph: AppGraphRoute[]): string => {
  const rows = flattenRoutes(graph)
    .map(({ route, depth }) => {
      const meta = Object.entries(route.meta)
        .map(([key, value]) => `${escapeHtml(key)}=${escapeHtml(JSON.stringify(value))}`)
        .join(" ")
      const indent = depth > 0 ? `<span class="indent">${"&nbsp;".repeat(depth * 4)}└ </span>` : ""
      const navigable = !route.path.includes(":") && !route.path.includes("*")
      const pathCell = navigable ? `<a href="${escapeHtml(route.path)}">${escapeHtml(route.path)}</a>` : escapeHtml(route.path)

      return `<tr>
  <td>${indent}${pathCell}</td>
  <td><span class="mode mode-${route.render}">${route.render}</span></td>
  <td>${escapeHtml(route.component)}</td>
  <td>${route.hasLoader ? "✓" : ""}</td>
  <td>${route.middlewareCount > 0 ? route.middlewareCount : ""}</td>
  <td>${route.hasHeaders ? "✓" : ""}</td>
  <td class="meta">${meta}</td>
</tr>`
    })
    .join("\n")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>tapped devtools</title>
<style>
  body { margin: 0; padding: 2rem; background: #1b1d1e; color: #e8e6e3; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  h1 { font-size: 16px; margin: 0 0 0.25rem; }
  .sub { color: #8b949e; margin-bottom: 1.5rem; }
  .sub a { color: #58a6ff; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; color: #8b949e; font-weight: normal; border-bottom: 1px solid #30363d; padding: 4px 12px 4px 0; }
  td { padding: 4px 12px 4px 0; border-bottom: 1px solid #21262d; vertical-align: top; }
  td a { color: #58a6ff; text-decoration: none; }
  td a:hover { text-decoration: underline; }
  .indent { color: #484f58; }
  .mode { padding: 1px 6px; border-radius: 4px; font-size: 11px; }
  .mode-ssr { background: #1f3a2d; color: #56d364; }
  .mode-spa { background: #3a2d1f; color: #d3a556; }
  .meta { color: #6e7681; font-size: 11px; }
</style>
</head>
<body>
<h1>tapped devtools</h1>
<div class="sub">Resolved route graph — also available as <a href="/_tapped.json">JSON</a>. Dev only.</div>
<table>
<thead><tr><th>path</th><th>render</th><th>component</th><th>loader</th><th>mw</th><th>headers</th><th>meta</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`
}

/** HTML page shown when the app's server module does not export getRoutes, explaining how to opt in. */
export const buildDevtoolsMissingHtml = (): string => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>tapped devtools</title></head>
<body style="margin:0;padding:2rem;background:#1b1d1e;color:#e8e6e3;font:14px/1.6 ui-monospace,Menlo,monospace">
<h1 style="font-size:16px">tapped devtools</h1>
<p>The server module does not export <code>getRoutes</code>. To enable this page, add to your tappedServerModule:</p>
<pre style="background:#21262d;padding:1rem;border-radius:6px">export const getRoutes = () =&gt; createWouterRoutes(environment)</pre>
</body>
</html>`
