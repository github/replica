import { randomBytes } from "node:crypto"
import { open, rename, rm } from "node:fs/promises"

/**
 * Replaces a file with owner-only content. The temporary file is created
 * exclusively so an existing file or symbolic link is never followed.
 */
export async function writePrivateFile(
  path: string,
  content: string,
  { suffix = randomBytes(16).toString("hex") }: { suffix?: string } = {},
) {
  const temporaryPath = `${path}.${suffix}.tmp`
  const handle = await open(temporaryPath, "wx", 0o600)
  try {
    try {
      await handle.writeFile(content)
      await handle.chmod(0o600)
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}
