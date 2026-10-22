import { constants } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import path from "node:path"

import { ChecksConfigError } from "./index.mjs"

export function validateChecksGuidance(content, file, checkId) {
  if (!content)
    throw new ChecksConfigError(
      `Check ${checkId} guidance is missing or excluded from the snapshot: ${file}.`,
    )
  if (content.length > 100000 || content.includes(0))
    throw new ChecksConfigError(
      `Check ${checkId} guidance must be text under 100000 bytes: ${file}.`,
    )
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(content)
  } catch {
    throw new ChecksConfigError(`Check ${checkId} guidance must be valid UTF-8: ${file}.`)
  }
}

export async function validateChecksConfigFiles(config, repositoryPath) {
  const root = await realpath(repositoryPath)
  for (const [index, check] of config.checks.entries()) {
    const files = (check.context ?? []).map((file, item) => [
      file,
      `/checks/${index}/context/${item}`,
    ])
    if (check.runner.type === "agent")
      files.push([check.runner.instructions, `/checks/${index}/runner/instructions`])
    for (const [file, pointer] of files) {
      try {
        const content = await readChecksFile(root, file, 100000)
        validateChecksGuidance(content, file, check.id)
      } catch (error) {
        if (!(error instanceof ChecksConfigError) && !["ENOENT", "ELOOP"].includes(error.code))
          throw error
        const message =
          error instanceof ChecksConfigError
            ? error.message
            : `Check ${check.id} guidance is missing or is a symbolic link: ${file}.`
        throw new ChecksConfigError(message, [{ path: pointer, message }])
      }
    }
  }
}

export async function readChecksFile(root, file, maximum) {
  const location = path.resolve(root, file)
  if (!location.startsWith(`${root}${path.sep}`))
    throw new ChecksConfigError(`Checks files must stay inside the repository: ${file}.`)
  if ((await realpath(location)) !== location)
    throw new ChecksConfigError(`Checks files cannot be symbolic links: ${file}.`)
  const before = await lstat(location)
  if (!before.isFile()) throw new ChecksConfigError(`Checks files must be regular files: ${file}.`)
  const handle = await open(
    location,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino)
      throw new ChecksConfigError(`The checks file changed while opening it: ${file}.`)
    if (stat.size > maximum)
      throw new ChecksConfigError(`Checks file exceeds ${maximum} bytes: ${file}.`)
    const buffer = Buffer.alloc(maximum + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset > maximum)
      throw new ChecksConfigError(`Checks file exceeds ${maximum} bytes: ${file}.`)
    return buffer.subarray(0, offset)
  } finally {
    await handle.close()
  }
}
