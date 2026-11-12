import { lstat, realpath } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"

async function canonicalPath(path: string, followSymbolicLinks = false) {
  let existing = path
  while (true) {
    try {
      const status = await lstat(existing)
      if (
        (!followSymbolicLinks && status.isSymbolicLink()) ||
        (!status.isDirectory() && !status.isSymbolicLink())
      ) {
        throw new Error("The path must contain only directories and no symbolic links.")
      }
      return resolve(await realpath(existing), relative(existing, path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      const parent = dirname(existing)
      if (parent === existing) throw error
      existing = parent
    }
  }
}

async function rejectSymbolicLinks(path: string) {
  let current = path
  while (true) {
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error("The path must contain only directories and no symbolic links.")
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

export async function validatePrivateStorageRoot(
  input: string,
  {
    applicationRoot,
    excludedDirectories = [],
    name,
    publicRoot,
  }: {
    applicationRoot: string
    excludedDirectories?: string[]
    name: string
    publicRoot: string
  },
) {
  if (!input.trim() || input.includes("\0")) {
    throw new Error(`${name} must name a private directory.`)
  }
  const path = isAbsolute(input) ? resolve(input) : resolve(applicationRoot, input)
  try {
    await rejectSymbolicLinks(path)
    const canonical = await canonicalPath(path)
    const application = await canonicalPath(resolve(applicationRoot))
    const storage = await canonicalPath(resolve(applicationRoot, "storage"))
    const publicDirectory = await canonicalPath(resolve(publicRoot))
    const excluded = await Promise.all(
      excludedDirectories.map((directory) => canonicalPath(resolve(directory), true)),
    )
    const filesystemRoot = resolve(path, sep)
    if (
      canonical === filesystemRoot ||
      canonical === application ||
      canonical === storage ||
      canonical === publicDirectory ||
      canonical.startsWith(`${publicDirectory}${sep}`) ||
      excluded.some(
        (directory) => canonical === directory || canonical.startsWith(`${directory}${sep}`),
      )
    ) {
      throw new Error("The path is not a dedicated private directory.")
    }
    return path
  } catch (error) {
    throw new Error(`${name} must be a dedicated private directory outside the public web root.`, {
      cause: error,
    })
  }
}
