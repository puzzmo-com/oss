import fs from "node:fs"
import path from "node:path"

type McpConfig = {
  mcpServers: Record<string, { url: string; headers?: Record<string, string> }>
}

/** Reads the .mcp.json config, searching the game directory and ancestor directories */
const readMcpConfig = (gameDir: string): McpConfig | null => {
  let dir = path.resolve(gameDir)
  const root = path.parse(dir).root
  while (dir !== root) {
    const mcpPath = path.join(dir, ".mcp.json")
    if (fs.existsSync(mcpPath)) {
      try {
        return JSON.parse(fs.readFileSync(mcpPath, "utf-8"))
      } catch {
        return null
      }
    }
    dir = path.dirname(dir)
  }
  return null
}

/** Sends a JSON-RPC request to the MCP server and parses the SSE response */
const mcpRequest = async (url: string, headers: Record<string, string>, method: string, params: any = {}): Promise<any> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })

  if (!response.ok) throw new Error(`MCP server returned ${response.status} ${response.statusText}`)

  const text = await response.text()
  // Parse SSE format: lines starting with "data: " contain the JSON payload
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue
    try {
      const parsed = JSON.parse(line.slice(6))
      if (parsed.error) throw new Error(`MCP error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`)
      if (parsed.result) return parsed.result
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("MCP error:")) throw e
    }
  }
  throw new Error(`MCP server returned no result. Response body: ${text.slice(0, 200)}`)
}

/** Returns the MCP server URL from .mcp.json, or null if not configured */
export const getMcpUrl = (gameDir: string): string | null => {
  const config = readMcpConfig(gameDir)
  if (!config) return null
  const server = Object.values(config.mcpServers)[0]
  return server?.url ?? null
}

/** Lists all available prompts from the MCP server configured in .mcp.json */
export const listMcpPrompts = async (gameDir: string): Promise<{ name: string; description?: string }[] | null> => {
  const config = readMcpConfig(gameDir)
  if (!config) return null

  const server = Object.values(config.mcpServers)[0]
  if (!server) return null

  try {
    const result = await mcpRequest(server.url, server.headers ?? {}, "prompts/list", {})
    if (!result?.prompts) return null
    return result.prompts.map((p: any) => ({ name: p.name, description: p.description }))
  } catch {
    return null
  }
}

/** Skill docs are immutable for the length of a run, so a retry never refetches one */
const promptCache = new Map<string, Promise<string>>()

/**
 * Warms the cache for every skill a pipeline will need, in parallel, so steps don't
 * each pay a round trip mid-run. Failures are left for the step itself to report.
 */
export const prefetchSkillPrompts = async (stepNames: string[], gameDir: string): Promise<void> => {
  await Promise.all([...new Set(stepNames)].map((name) => fetchSkillPrompt(name, gameDir).catch(() => undefined)))
}

/** Fetches a step's instructions from the MCP server configured in .mcp.json */
export const fetchSkillPrompt = async (stepName: string, gameDir: string): Promise<string> => {
  const config = readMcpConfig(gameDir)
  if (!config) throw new Error(`No .mcp.json found in ${gameDir}`)

  const server = Object.values(config.mcpServers)[0]
  if (!server) throw new Error("No MCP server configured in .mcp.json")

  const cacheKey = `${server.url}|${stepName}`
  const cached = promptCache.get(cacheKey)
  if (cached) return cached

  const pending = requestSkillPrompt(server, stepName)
  promptCache.set(cacheKey, pending)
  // A failed fetch shouldn't be remembered — the next attempt should try the network again.
  pending.catch(() => promptCache.delete(cacheKey))
  return pending
}

/** Performs the uncached prompts/get round trip and flattens the response to text */
const requestSkillPrompt = async (server: { url: string; headers?: Record<string, string> }, stepName: string): Promise<string> => {
  const result = await mcpRequest(server.url, server.headers ?? {}, "prompts/get", { name: stepName })
  if (!result?.messages?.length) throw new Error(`MCP server returned no instructions for "${stepName}"`)

  const text = result.messages
    .map((m: any) => {
      if (typeof m.content === "string") return m.content
      if (m.content?.text) return m.content.text
      return ""
    })
    .join("\n")

  if (!text.trim()) throw new Error(`MCP server returned empty instructions for "${stepName}"`)
  return text
}
