import { execFileSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
} from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const sourceRoot = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))))
const usage = "Usage: node scripts/create-prototype-repo.mjs <new-repository-directory>"

function stat(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error
  }
}

function within(root, path) {
  const local = relative(root, path)
  return !local || (!isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`))
}

function safePath(path) {
  return path
    .split("/")
    .every(
      (part) =>
        part &&
        part !== "." &&
        part !== ".." &&
        !/[\\:\x00-\x1f<>\"|?*]/.test(part) &&
        !/[. ]$/.test(part) &&
        !/^\.git$/i.test(part) &&
        !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
    )
}

export function createRepository(argument) {
  const name = basename(argument)
  const parentPath = dirname(resolve(argument))
  if (!stat(parentPath)?.isDirectory() && !stat(parentPath)?.isSymbolicLink()) {
    throw new Error("Destination must have an existing parent directory.")
  }
  const parent = realpathSync(parentPath)
  if (!name || name === "." || name === ".." || name === sep) {
    throw new Error("Destination must have an existing parent directory.")
  }
  const internalPath = process.env.REPLICA_INTERNAL_STARTER_ROOT
  let internalRoot
  if (internalPath) {
    internalRoot = realpathSync(internalPath)
    if (!stat(internalRoot)?.isDirectory())
      throw new Error("Internal starter root must be an existing directory.")
  }
  if (within(sourceRoot, parent) && (!internalRoot || !within(internalRoot, parent))) {
    throw new Error("Create the new repository outside the Replica checkout.")
  }
  const destination = join(parent, name)
  if (stat(destination)) throw new Error(`Destination already exists: ${destination}`)
  const starter = join(sourceRoot, "starter")
  if (!stat(starter)?.isDirectory())
    throw new Error("Starter skills or context templates are missing or linked.")
  const temporary = mkdtempSync(join(parent, ".replica-starter."))
  let created = false
  let count = 0
  try {
    const files = join(temporary, "files")
    mkdirSync(files)
    let checkout
    try {
      checkout = realpathSync(
        execFileSync("git", ["-C", sourceRoot, "rev-parse", "--show-toplevel"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim(),
      )
    } catch (error) {
      if (error.code !== "ENOENT" && error.status === undefined) throw error
    }
    function copy(path) {
      if (!safePath(path)) throw new Error(`Unsupported starter entry: ${path}`)
      let directory = starter
      for (const part of path.split("/").slice(0, -1)) {
        directory = join(directory, part)
        if (!stat(directory)?.isDirectory())
          throw new Error(`Linked starter directory or missing directory: ${directory}`)
      }
      const source = join(starter, path)
      const metadata = stat(source)
      if (!metadata?.isFile())
        throw new Error(`Starter file is missing or is not a regular file: ${source}`)
      const target = join(files, path)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
      chmodSync(target, metadata.mode)
      utimesSync(target, metadata.atime, metadata.mtime)
      count += 1
    }
    if (checkout === sourceRoot) {
      const manifest = execFileSync(
        "git",
        ["-C", sourceRoot, "ls-files", "--cached", "--stage", "-z", "--", "starter/"],
        {
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
        },
      )
      for (const entry of manifest.split("\0").filter(Boolean)) {
        const match = /^(100644|100755) [a-f0-9]+ 0\tstarter\/(.+)$/.exec(entry)
        if (!match) throw new Error(`Unsupported starter entry: ${entry}`)
        copy(match[2])
      }
    } else {
      function visit(directory, prefix = "") {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = `${prefix}${entry.name}`
          if (!safePath(path))
            throw new Error(`Starter archive contains Git metadata or an unsafe path: ${path}`)
          if (entry.isDirectory()) visit(join(directory, entry.name), `${path}/`)
          else if (entry.isFile()) copy(path)
          else throw new Error(`Starter archive contains an unsupported file: ${path}`)
        }
      }
      visit(starter)
    }
    for (const path of [
      ".agents/skills/setup-skills/SKILL.md",
      ".agents/context-templates/SKILL.md",
    ]) {
      if (!stat(join(files, path))?.isFile())
        throw new Error("Starter skills or context templates are missing or linked.")
    }
    if (!count) throw new Error(`No starter files found in ${sourceRoot}`)
    execFileSync("git", ["init", "-q", "--initial-branch=main", files])
    mkdirSync(destination)
    created = true
    cpSync(files, destination, { recursive: true, preserveTimestamps: true })
    created = false
    console.log(
      `Created ${destination} with ${count} starter files and a new, uncommitted Git repository.`,
    )
    console.log("Start a new agent session in that directory and run /setup-skills.")
  } finally {
    rmSync(temporary, { recursive: true, force: true })
    if (created) rmSync(destination, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error(usage)
    process.exitCode = 2
  } else {
    try {
      createRepository(process.argv[2])
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}
