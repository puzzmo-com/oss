import fs from "node:fs"
import path from "node:path"

type McpConfig = {
  mcpServers: Record<string, { url: string; headers?: Record<string, string> }>
}

/** Reads the .mcp.json config from the game directory */
const readMcpConfig = (gameDir: string): McpConfig | null => {
  const mcpPath = path.join(gameDir, ".mcp.json")
  if (!fs.existsSync(mcpPath)) return null
  try {
    return JSON.parse(fs.readFileSync(mcpPath, "utf-8"))
  } catch {
    return null
  }
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

  const text = await response.text()
  // Parse SSE format: lines starting with "data: " contain the JSON payload
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue
    try {
      const parsed = JSON.parse(line.slice(6))
      if (parsed.result) return parsed.result
    } catch {}
  }
  return null
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

/** Fetches a skill prompt's content from the MCP server configured in .mcp.json */
export const fetchSkillPrompt = async (skillName: string, gameDir: string): Promise<string | null> => {
  const config = readMcpConfig(gameDir)
  if (!config) return null

  const server = Object.values(config.mcpServers)[0]
  if (!server) return null

  try {
    const result = await mcpRequest(server.url, server.headers ?? {}, "prompts/get", { name: skillName })
    if (!result?.messages?.length) return null

    return result.messages
      .map((m: any) => {
        if (typeof m.content === "string") return m.content
        if (m.content?.text) return m.content.text
        return ""
      })
      .join("\n")
  } catch {
    return null
  }
}
