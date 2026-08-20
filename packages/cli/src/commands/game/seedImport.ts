import fs from "node:fs"
import path from "node:path"

/** Where the downloaded page is parked while the agent ports it */
export const importedSourceDir = "original"

/** Where an untouched copy of the starter lives, for the agent to read but not edit */
export const referenceDir = path.join(".puzzmo", "reference")

/**
 * Turns a freshly downloaded page into a working Puzzmo project.
 *
 * The download moves to `original/`, the starter is unpacked over the top as the shell to port
 * into, and a pristine copy is left in `.puzzmo/reference/`. This means the migration begins
 * from a project that already builds and is already wired to the SDK, instead of asking an
 * agent to reconstruct the whole layout a step at a time.
 */
export const seedImportedGame = (
  gameDir: string,
  templateDir: string,
  copyTemplate: (sourceDir: string, targetDir: string) => void,
): void => {
  const downloaded = path.join(gameDir, "src")
  const target = path.join(gameDir, importedSourceDir)
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true })
  if (fs.existsSync(downloaded)) fs.renameSync(downloaded, target)

  copyTemplate(templateDir, gameDir)
  copyTemplate(templateDir, path.join(gameDir, referenceDir))
}
