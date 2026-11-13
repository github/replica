import { createHash } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { join, relative, sep } from "node:path"

interface IgnoreRule {
  exclude: boolean
  matches: (path: string) => boolean
}

function glob(pattern: string): RegExp {
  let source = "^"
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!
    if (character === "*" && pattern[index + 1] === "*") {
      index++
      if (pattern[index + 1] === "/") {
        source += "(?:.*/)?"
        index++
      } else source += ".*"
    } else if (character === "*") source += "[^/]*"
    else if (character === "?") source += "[^/]"
    else source += character.replace(/[|\\{}()[\]^$+?.-]/g, "\\$&")
  }
  return new RegExp(`${source}$`)
}

function dockerIgnore(content: string): IgnoreRule[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && line !== ".")
    .map((line) => {
      const exclude = !line.startsWith("!")
      const pattern = (exclude ? line : line.slice(1)).replace(/^\/+|\/+$/g, "")
      if (!pattern || pattern.includes("\\"))
        throw new Error("The Hub Docker ignore file uses an unsupported pattern.")
      const expression = glob(pattern)
      return {
        exclude,
        matches(path: string) {
          const segments = path.split("/")
          for (let index = 1; index <= segments.length; index++) {
            const candidate = segments.slice(0, index).join("/")
            if (
              (pattern.includes("/") && expression.test(candidate)) ||
              (!pattern.includes("/") && candidate.split("/").length === 1 && expression.test(candidate))
            )
              return true
          }
          return false
        },
      }
    })
}

export async function createBuildSnapshot(
  source: string,
  parent: string,
  signal?: AbortSignal,
): Promise<{ directory: string; fingerprint: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(parent, "image-context-"))
  const directory = join(root, "hub")
  const fingerprint = createHash("sha256")
  try {
    const rules = dockerIgnore(await readFile(join(source, ".dockerignore"), "utf8"))
    await mkdir(directory, { mode: 0o700 })
    async function copy(sourceDirectory: string, targetDirectory: string) {
      signal?.throwIfAborted()
      const entries = await readdir(sourceDirectory, { withFileTypes: true })
      entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
      for (const entry of entries) {
        signal?.throwIfAborted()
        const from = join(sourceDirectory, entry.name)
        const to = join(targetDirectory, entry.name)
        const path = relative(source, from).split(sep).join("/")
        let excluded = false
        for (const rule of rules) {
          if (rule.matches(path)) excluded = rule.exclude
        }
        if (excluded) continue
        const metadata = await lstat(from)
        const mode = metadata.mode & 0o777
        if (metadata.isDirectory()) {
          fingerprint.update(JSON.stringify([path, "directory", mode]))
          await mkdir(to, { mode })
          await copy(from, to)
        } else if (metadata.isFile()) {
          const content = await readFile(from)
          fingerprint.update(JSON.stringify([path, "file", mode, content.length]))
          fingerprint.update(content)
          await writeFile(to, content, { mode })
          await chmod(to, mode)
        } else if (metadata.isSymbolicLink()) {
          const target = await readlink(from)
          fingerprint.update(JSON.stringify([path, "symlink", target]))
          await symlink(target, to)
        } else {
          throw new Error("The Hub Docker build context contains an unsupported file type.")
        }
      }
    }
    await copy(source, directory)
    return {
      directory,
      fingerprint: fingerprint.digest("hex"),
      async cleanup() {
        await rm(root, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
