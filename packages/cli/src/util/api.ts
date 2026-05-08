import fs from "node:fs"
import path from "node:path"

/** The schema for a puzzmo.json file - mirrors PuzzmoFile from @puzzmo-com/shared/hostAPI */
export type PuzzmoFile = {
  game: {
    displayName: string
    slug: string
    teamID: string
  }
  // This is what we're calling 'augmentations' publicly
  integrations?: Record<string, unknown>
  output?: {
    dir: string
  }
}

const BATCH_SIZE = 10

/** Thrown when /cliUpload init returns a 404 because the game slug isn't registered yet. */
export class GameNotFoundError extends Error {
  constructor(
    public readonly slug: string,
    message: string,
  ) {
    super(message)
    this.name = "GameNotFoundError"
  }
}

type InitResponse = { sessionID: string; basePath: string; integrationsChanged?: boolean; versionsURL?: string; error?: string }
type FileResponse = { path: string; error?: string }
type CompleteResponse = { assetsBase: string; versionID: string; integrationsChanged: boolean; versionsURL: string | null; error?: string }

/** Callback for reporting batch upload progress */
export type UploadProgress = (batch: number, totalBatches: number, uploaded: number) => void

/** Options for uploadFiles */
export type UploadFilesOptions = {
  verbose?: boolean
  /** Commit message subject for the new GameRuntimeVersion */
  description?: string | null
  /** HTTPS repo URL to set on the GameRuntime */
  repoURL?: string | null
}

/** Wraps fetch to surface the underlying network cause (DNS, ECONNREFUSED, TLS, etc.) */
const fetchWithContext = async (url: string, init: RequestInit, step: string, verbose: boolean): Promise<Response> => {
  if (verbose) console.log(`  → ${init.method ?? "GET"} ${url} [${step}]`)
  try {
    const res = await fetch(url, init)
    if (verbose) console.log(`  ← ${res.status} ${res.statusText} [${step}]`)
    return res
  } catch (e) {
    const cause = (e as { cause?: unknown }).cause
    const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : (e as Error).message
    if (verbose && e instanceof Error && e.stack) console.error(e.stack)
    throw new Error(`Network error during ${step} (${url}): ${causeMsg}`)
  }
}

/** Reads a response body, parsing JSON when possible and including status + body in errors */
const readResponse = async (res: Response, url: string, step: string, verbose: boolean) => {
  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    if (!res.ok) {
      const snippet = verbose ? text : text.slice(0, 200).replace(/\s+/g, " ").trim()
      throw new Error(`Server error during ${step} (${res.status} ${res.statusText} from ${url}): ${snippet || "no body"}`)
    }
    throw new Error(`Invalid JSON response during ${step} (${url}): ${verbose ? text : text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const body = json as { error?: string; validationErrors?: string[] }
    const serverMsg = body.error || res.statusText || "Unknown error"
    const validation = body.validationErrors?.length ? `\n  - ${body.validationErrors.join("\n  - ")}` : ""
    const detail = verbose ? `\n${JSON.stringify(json, null, 2)}` : ""
    throw new Error(`Server error during ${step} (${res.status} from ${url}): ${serverMsg}${validation}${detail}`)
  }
  return json
}

/** Sends a JSON POST request */
const jsonPost = async (url: string, token: string, body: object, step: string, verbose: boolean) => {
  const res = await fetchWithContext(
    url,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    step,
    verbose,
  )
  return readResponse(res, url, step, verbose)
}

/** Uploads a single file as raw binary with filename in query param */
const uploadFile = async (url: string, token: string, filePath: string, baseDir: string, verbose: boolean): Promise<FileResponse> => {
  const relativePath = path.relative(baseDir, filePath)
  const content = fs.readFileSync(filePath)
  const step = `file upload (${relativePath})`

  const fullURL = `${url}?name=${encodeURIComponent(relativePath)}`
  const res = await fetchWithContext(
    fullURL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: content,
    },
    step,
    verbose,
  )
  if (res.status === 413) throw new Error(`File ${relativePath} is too large to upload (${formatBytes(content.length)})`)
  return (await readResponse(res, fullURL, step, verbose)) as FileResponse
}

/** Formats a byte count as a human-readable string (e.g. "1.6 MB") */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Multi-step upload: init -> batched file uploads -> complete */
export const uploadFiles = async (
  apiURL: string,
  token: string,
  gameSlug: string,
  sha: string,
  filePaths: string[],
  baseDir: string,
  puzzmoFile: PuzzmoFile,
  onProgress?: UploadProgress,
  options: UploadFilesOptions = {},
): Promise<CompleteResponse> => {
  const { verbose = false, description, repoURL } = options
  if (verbose) console.log(`  API URL: ${apiURL}`)

  // Step 1: Init session (includes puzzmo.json metadata)
  let init: InitResponse
  try {
    init = (await jsonPost(
      `${apiURL}/cliUpload`,
      token,
      { gameSlug, sha, puzzmoFile, description, repoURL },
      "upload init",
      verbose,
    )) as InitResponse
  } catch (e) {
    if (e instanceof Error && e.message.includes("Game not found:")) throw new GameNotFoundError(gameSlug, e.message)
    throw e
  }
  if (verbose) console.log(`  session: ${init.sessionID}`)

  // Step 2: Upload files in concurrent batches
  const fileURL = `${apiURL}/cliUpload/${init.sessionID}/file`
  const totalBatches = Math.ceil(filePaths.length / BATCH_SIZE)
  let totalUploaded = 0

  for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
    const batch = filePaths.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    await Promise.all(batch.map((fp) => uploadFile(fileURL, token, fp, baseDir, verbose)))
    totalUploaded += batch.length
    onProgress?.(batchNum, totalBatches, totalUploaded)
  }

  // Step 3: Complete
  const complete = (await jsonPost(`${apiURL}/cliUpload/${init.sessionID}/complete`, token, {}, "upload complete", verbose)) as Omit<
    CompleteResponse,
    "integrationsChanged" | "versionsURL"
  >
  return {
    ...complete,
    integrationsChanged: !!init.integrationsChanged,
    versionsURL: init.versionsURL ?? null,
  }
}
