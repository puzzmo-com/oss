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

/** Sends a JSON POST request */
const jsonPost = async (url: string, token: string, body: object) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Server error (${res.status}): ${(json as any).error || "Unknown error"}`)
  return json
}

/** Uploads a single file as raw binary with filename in query param */
const uploadFile = async (url: string, token: string, filePath: string, baseDir: string): Promise<FileResponse> => {
  const relativePath = path.relative(baseDir, filePath)
  const content = fs.readFileSync(filePath)

  const res = await fetch(`${url}?name=${encodeURIComponent(relativePath)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: content,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Server error (${res.status}): ${(json as any).error || "Unknown error"}`)
  return json as FileResponse
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
  const init = (await jsonPost(`${apiURL}/cliUpload`, token, { gameSlug, sha, puzzmoFile })) as InitResponse

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
  return (await jsonPost(`${apiURL}/cliUpload/${init.sessionID}/complete`, token, {})) as CompleteResponse
}
