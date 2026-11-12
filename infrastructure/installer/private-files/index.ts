import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, rename, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"

export async function privateDirectory(path: string): Promise<void> {
  const directory = resolve(path)
  let metadata
  try {
    metadata = await lstat(directory)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    await privateDirectory(dirname(directory))
    try {
      await mkdir(directory, { mode: 0o700 })
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
    }
    metadata = await lstat(directory)
  }
  if (
    !metadata.isDirectory() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o077) !== 0
  )
    throw new Error(
      `Setup requires a current-user-owned private directory (0700): ${directory}. Existing paths were not changed.`,
    )
  let ancestor = dirname(directory)
  while (ancestor !== dirname(ancestor)) {
    const boundary = await lstat(ancestor)
    if (
      (boundary.isSymbolicLink() && boundary.uid !== 0) ||
      (!boundary.isSymbolicLink() && !boundary.isDirectory()) ||
      (boundary.uid !== 0 && boundary.uid !== process.getuid?.()) ||
      (!boundary.isSymbolicLink() &&
        (boundary.mode & 0o022) !== 0 &&
        (boundary.mode & 0o1000) === 0)
    )
      throw new Error(
        `Setup workspace has an untrusted parent directory: ${ancestor}. Use a private configuration location; existing paths were not changed.`,
      )
    ancestor = dirname(ancestor)
  }
}

export async function privateFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path)
    if (
      !metadata.isFile() ||
      metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.nlink !== 1
    )
      throw new Error(
        `Setup requires a current-user-owned private regular file (0600): ${path}. Existing paths were not changed.`,
      )
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

export async function readPrivateFile(path: string): Promise<string | undefined> {
  await privateDirectory(dirname(path))
  if (!(await privateFile(path))) return undefined
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await file.stat()
    if (
      !metadata.isFile() ||
      metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.nlink !== 1
    )
      throw new Error(`Setup input is no longer a private regular file: ${path}.`)
    return await file.readFile("utf8")
  } finally {
    await file.close()
  }
}

export async function writePrivateFile(path: string, content: string): Promise<void> {
  await privateDirectory(dirname(path))
  await privateFile(path)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, "wx", 0o600)
    try {
      await file.writeFile(content)
      await file.sync()
    } finally {
      await file.close()
    }
    await privateFile(path)
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
