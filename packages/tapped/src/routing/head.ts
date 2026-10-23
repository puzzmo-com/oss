import type { HeadTag, Placeholder } from "./types.js"

/**
 * Serializes route head tags to HTML for the document head. Text and attribute values are escaped
 * here, so a route's `head()` can return API-supplied strings (titles, taglines) without each
 * consumer re-implementing escaping.
 */
export const renderHeadTags = (tags: HeadTag[]): string => tags.map(renderHeadTag).join("")

/**
 * The inline script seeding `window.__PLACEHOLDER_DATA` for a route's placeholder markup, so the same
 * component can render the same content on the client before its real data arrives.
 */
export const renderPlaceholderData = (placeholder: Placeholder | null | undefined): string => {
  if (!placeholder || placeholder.data === undefined) return ""
  return `<script>window.__PLACEHOLDER_DATA = ${escapeJSONForScript(placeholder.data)}</script>`
}

const renderHeadTag = (tag: HeadTag): string => {
  if (tag.tag === "title") return `<title>${escapeHTMLText(tag.text)}</title>`
  return `<${tag.tag}${renderAttrs(tag.attrs)}>`
}

const renderAttrs = (attrs: Record<string, string>) =>
  Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeAttrValue(value)}"`)
    .join("")

const escapeHTMLText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const escapeAttrValue = (value: string) => escapeHTMLText(value).replace(/"/g, "&quot;")

/** Keeps a JSON payload from closing the script element it is embedded in. */
const escapeJSONForScript = (data: unknown) =>
  JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
