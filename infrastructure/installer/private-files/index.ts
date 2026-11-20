import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { link, lstat, mkdir, open, rename, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { assertWindowsAccess, createWindowsDirectory } from "./windows/index.ts"

async function trustedParents(directory: string): Promise<void> {
  let ancestor = dirname(directory)
  while (ancestor !== dirname(ancestor)) {
    let boundary
    try {
      boundary = await lstat(ancestor)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      ancestor = dirname(ancestor)
      continue
    }
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

export async function privateDirectory(
  path: string,
  { create = true }: { create?: boolean } = {},
): Promise<boolean> {
  const directory = resolve(path)
  let metadata
  try {
    metadata = await lstat(directory)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    if (!create) return false
    if (process.platform === "win32") await createWindowsDirectory(directory)
    else {
      await trustedParents(directory)
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 })
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
      }
    }
    metadata = await lstat(directory)
  }
  if (
    !metadata.isDirectory() ||
    (process.platform !== "win32" &&
      (metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0))
  )
    throw new Error(
      `Setup requires a current-user-owned private directory (0700): ${directory}. Existing paths were not changed.`,
    )
  if (process.platform === "win32") await assertWindowsAccess(directory, true)
  else await trustedParents(directory)
  return true
}

export async function privateFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path)
    if (
      !metadata.isFile() ||
      (process.platform !== "win32" &&
        (metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0)) ||
      metadata.nlink !== 1
    )
      throw new Error(
        `Setup requires a current-user-owned private regular file (0600): ${path}. Existing paths were not changed.`,
      )
    if (process.platform === "win32") await assertWindowsAccess(resolve(path), true)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

export async function readPrivateFile(
  path: string,
  { createDirectory = true }: { createDirectory?: boolean } = {},
): Promise<string | undefined> {
  if (!(await privateDirectory(dirname(path), { create: createDirectory }))) return undefined
  if (!(await privateFile(path))) return undefined
  const expected = process.platform === "win32" ? await lstat(path) : undefined
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const metadata = await file.stat()
    if (
      !metadata.isFile() ||
      (process.platform !== "win32" &&
        (metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0)) ||
      metadata.nlink !== 1
    )
      throw new Error(`Setup input is no longer a private regular file: ${path}.`)
    if (process.platform === "win32") await assertWindowsAccess(resolve(path), true)
    if (expected) {
      const current = await lstat(path)
      if (
        expected.dev !== metadata.dev ||
        expected.ino !== metadata.ino ||
        current.dev !== metadata.dev ||
        current.ino !== metadata.ino ||
        !current.isFile()
      )
        throw new Error(`Setup input changed while opening it: ${path}. The file was not read.`)
    }
    return await file.readFile("utf8")
  } finally {
    await file.close()
  }
}

export async function writePrivateFile(
  path: string,
  content: string,
  { exclusive = false }: { exclusive?: boolean } = {},
): Promise<void> {
  await privateDirectory(dirname(path))
  await privateFile(path)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, "wx", 0o600)
    try {
      await privateFile(temporary)
      await file.writeFile(content)
      await file.sync()
    } finally {
      await file.close()
    }
    await privateFile(path)
    if (exclusive) await link(temporary, path)
    else await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
