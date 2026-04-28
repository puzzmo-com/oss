import fs from "node:fs"
import path from "node:path"

import { getAPIURL } from "./config.js"

/** The schema for a puzzmo.json file - mirrors PuzzmoFile from @puzzmo-com/shared/hostAPI */
export type PuzzmoFile = {
  game: {
    displayName: string
    slug: string
    teamID: string
  }
  integrations?: Record<string, unknown>
}

const BATCH_SIZE = 10

type InitResponse = { sessionID: string; basePath: string; error?: string }
type FileResponse = { path: string; error?: string }
type CompleteResponse = { assetsBase: string; versionID: string; error?: string }

/** Callback for reporting batch upload progress */
export type UploadProgress = (batch: number, totalBatches: number, uploaded: number) => void

/** Wraps fetch to surface the underlying network cause (DNS, ECONNREFUSED, TLS, etc.) */
const fetchWithContext = async (url: string, init: RequestInit, step: string): Promise<Response> => {
  try {
    return await fetch(url, init)
  } catch (e) {
    const cause = (e as { cause?: unknown }).cause
    const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : (e as Error).message
    throw new Error(`Network error during ${step} (${url}): ${causeMsg}`)
  }
}

/** Reads a response body, parsing JSON when possible and including status + body in errors */
const readResponse = async (res: Response, url: string, step: string) => {
  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    if (!res.ok) {
      const snippet = text.slice(0, 200).replace(/\s+/g, " ").trim()
      throw new Error(`Server error during ${step} (${res.status} ${res.statusText} from ${url}): ${snippet || "no body"}`)
    }
    throw new Error(`Invalid JSON response during ${step} (${url}): ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const serverMsg = (json as { error?: string }).error || res.statusText || "Unknown error"
    throw new Error(`Server error during ${step} (${res.status} from ${url}): ${serverMsg}`)
  }
  return json
}

/** Sends a JSON POST request */
const jsonPost = async (url: string, token: string, body: object, step: string) => {
  const res = await fetchWithContext(
    url,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    step,
  )
  return readResponse(res, url, step)
}

/** Uploads a single file as raw binary with filename in query param */
const uploadFile = async (url: string, token: string, filePath: string, baseDir: string): Promise<FileResponse> => {
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
  )
  return (await readResponse(res, fullURL, step)) as FileResponse
}

/** Multi-step upload: init -> batched file uploads -> complete */
export const uploadFiles = async (
  token: string,
  gameSlug: string,
  sha: string,
  filePaths: string[],
  baseDir: string,
  puzzmoFile: PuzzmoFile,
  onProgress?: UploadProgress,
): Promise<CompleteResponse> => {
  const apiURL = getAPIURL()

  // Step 1: Init session (includes puzzmo.json metadata)
  const init = (await jsonPost(`${apiURL}/cliUpload`, token, { gameSlug, sha, puzzmoFile }, "upload init")) as InitResponse

  // Step 2: Upload files in concurrent batches
  const fileURL = `${apiURL}/cliUpload/${init.sessionID}/file`
  const totalBatches = Math.ceil(filePaths.length / BATCH_SIZE)
  let totalUploaded = 0

  for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
    const batch = filePaths.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    await Promise.all(batch.map((fp) => uploadFile(fileURL, token, fp, baseDir)))
    totalUploaded += batch.length
    onProgress?.(batchNum, totalBatches, totalUploaded)
  }

  // Step 3: Complete
  return (await jsonPost(`${apiURL}/cliUpload/${init.sessionID}/complete`, token, {}, "upload complete")) as CompleteResponse
}
