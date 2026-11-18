import { execFileSync } from "node:child_process"
import { chmodSync, copyFileSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseArguments, printCatalog, readCatalog, safeRelativePath, selectStarter, usage } from "./starter-catalog.mjs"

export const sourceRoot = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))))

function stat(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}

export function destinationPath(argument, root = sourceRoot) {
  const parent = realpathSync(dirname(resolve(argument)))
  const name = basename(argument)
  if (!stat(parent)?.isDirectory() || !name || name === "." || name === ".." || name === sep) {
    throw new Error("Destination must have an existing parent directory.")
  }
  const local = relative(root, parent)
  if (!local || (!isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`))) {
    throw new Error("Create the new repository outside the Replica checkout.")
  }
  const destination = join(parent, name)
  if (stat(destination)) throw new Error(`Destination already exists: ${destination}`)
  return destination
}

export function createRepository(options, root = sourceRoot) {
  const entries = readCatalog(join(root, "starters/catalog.tsv"))
  if (options.list) return printCatalog(entries)
  const starter = selectStarter(entries, options.id)
  if (!options.destination) throw new Error(usage(), { cause: 2 })
  const destination = destinationPath(options.destination, root)
  const temporary = mkdtempSync(join(dirname(destination), ".replica-starter."))
  let created = false
  let count = 0
  try {
    const files = join(temporary, "files")
    mkdirSync(files)
    let checkout
    try {
      checkout = realpathSync(execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim())
    } catch (error) {
      if (error.code !== "ENOENT" && error.status === undefined) throw error
    }
    function copy(bundle, path) {
      if (!safeRelativePath(path)) throw new Error(`Unsupported starter entry: ${path}`)
      let directory = root
      for (const part of `${bundle}/${path}`.split("/").slice(0, -1)) {
        directory = join(directory, part)
        if (!stat(directory)?.isDirectory() || stat(directory).isSymbolicLink()) {
          throw new Error(`Linked starter directory or missing directory: ${directory}`)
        }
      }
      const source = join(root, bundle, path)
      const metadata = stat(source)
      if (!metadata?.isFile()) throw new Error(`Starter file is missing or is not a regular file: ${source}`)
      const target = join(files, path)
      if (stat(target)) throw new Error(`Starter file collision: ${path}`)
      for (let parent = dirname(target); parent !== files; parent = dirname(parent)) {
        if (stat(parent) && !stat(parent).isDirectory()) throw new Error(`Starter file collision: ${path}`)
      }
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
      chmodSync(target, metadata.mode)
      utimesSync(target, metadata.atime, metadata.mtime)
      count += 1
    }
    for (const bundle of ["starters/shared", starter.directory]) {
      for (const path of ["starters", bundle]) {
        if (!stat(join(root, path))?.isDirectory() || stat(join(root, path)).isSymbolicLink()) {
          throw new Error(`Starter directory is missing or linked: ${path}`)
        }
      }
      if (checkout === root) {
        const manifest = execFileSync("git", ["-C", root, "ls-files", "--cached", "--stage", "-z", "--", `${bundle}/`], {
          encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
        })
        for (const entry of manifest.split("\0").filter(Boolean)) {
          const match = /^(100644|100755) [a-f0-9]+ 0\t(.+)$/.exec(entry)
          if (!match || !match[2].startsWith(`${bundle}/`)) throw new Error(`Unsupported starter entry: ${entry}`)
          copy(bundle, match[2].slice(bundle.length + 1))
        }
      } else {
        function visit(directory, prefix = "") {
          for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = `${prefix}${entry.name}`
            if (!safeRelativePath(path)) throw new Error(`Unsupported starter entry: ${path}`)
            if (entry.isDirectory()) visit(join(directory, entry.name), `${path}/`)
            else if (entry.isFile()) copy(bundle, path)
            else throw new Error(`Starter archive contains an unsupported file: ${path}`)
          }
        }
        visit(join(root, bundle))
      }
    }
    for (const path of [".agents/skills/setup-skills/SKILL.md", ".agents/context-templates/SKILL.md"]) {
      if (!stat(join(files, path))?.isFile()) throw new Error("Starter skills or context templates are missing or linked.")
    }
    if (!count) throw new Error(`No starter files found in ${root}`)
    execFileSync("git", ["init", "-q", "--initial-branch=main", files])
    mkdirSync(destination)
    created = true
    cpSync(files, destination, { recursive: true, preserveTimestamps: true })
    try {
      execFileSync("git", ["-C", destination, "add", "--force", "--all", "--", "."], { stdio: "inherit" })
      execFileSync("git", ["-C", destination, "commit", "-q", "-m", "chore: initialize prototype", "-m",
        "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"], { stdio: "inherit" })
    } catch (error) {
      throw new Error("Could not create the initial commit. Check the Git error above, configure user.name and user.email or resolve signing or hook failures, then rerun the installer. The incomplete destination will be removed.", { cause: error })
    }
    created = false
    console.log(`Created ${destination} from ${starter.name} (${starter.id}) with ${count} files committed on main in a new Git repository.`)
    console.log("Start a new agent session in that directory. Follow AGENTS.md and README.md to run the included app.")
  } finally {
    rmSync(temporary, { recursive: true, force: true })
    if (created) rmSync(destination, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) console.log(usage())
    else createRepository(options)
  } catch (error) {
    console.error(error.message)
    process.exitCode = error.cause === 2 ? 2 : 1
  }
}
