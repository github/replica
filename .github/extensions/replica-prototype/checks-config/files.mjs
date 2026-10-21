import { constants } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import path from "node:path"

export function validateChecksGuidance(content, file, checkId) {
  if (!content)
    throw new Error(`Check ${checkId} guidance is missing or excluded from the snapshot: ${file}.`)
  if (content.length > 100000 || content.includes(0))
    throw new Error(`Check ${checkId} guidance must be text under 100000 bytes: ${file}.`)
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(content)
  } catch (cause) {
    throw new Error(`Check ${checkId} guidance must be valid UTF-8: ${file}.`, { cause })
  }
}

export async function validateChecksConfigFiles(config, repositoryPath) {
  const root = await realpath(repositoryPath)
  for (const check of config.checks) {
    for (const file of [
      ...(check.context ?? []),
      ...(check.runner.type === "agent" ? [check.runner.instructions] : []),
    ]) {
      const content = await readChecksFile(root, file, 100000)
      validateChecksGuidance(content, file, check.id)
    }
  }
}

export async function readChecksFile(root, file, maximum) {
  const location = path.resolve(root, file)
  if (!location.startsWith(`${root}${path.sep}`))
    throw new Error(`Checks files must stay inside the repository: ${file}.`)
  if ((await realpath(location)) !== location)
    throw new Error(`Checks files cannot be symbolic links: ${file}.`)
  const before = await lstat(location)
  if (!before.isFile()) throw new Error(`Checks files must be regular files: ${file}.`)
  const handle = await open(
    location,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino)
      throw new Error(`The checks file changed while opening it: ${file}.`)
    if (stat.size > maximum) throw new Error(`Checks file exceeds ${maximum} bytes: ${file}.`)
    const buffer = Buffer.alloc(maximum + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset > maximum) throw new Error(`Checks file exceeds ${maximum} bytes: ${file}.`)
    return buffer.subarray(0, offset)
  } finally {
    await handle.close()
  }
}
