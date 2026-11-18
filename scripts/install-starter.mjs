import { execFileSync } from "node:child_process"
import { createWriteStream, lstatSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { pathToFileURL } from "node:url"

// Keep this downloader standalone: people download and review just this file.
async function install(args) {
  if (!args.length || (args.length === 1 && ["--help", "-h"].includes(args[0]))) {
    console.log("Usage: node install-starter.mjs [--starter <id>] <new-repository-directory>\n       node install-starter.mjs --list")
    return args.length ? 0 : 2
  }
  if (args.length === 1 && !args[0].startsWith("-")) {
    if (!statSync(dirname(resolve(args[0])), { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error("Destination must have an existing parent directory.")
    }
    try {
      lstatSync(resolve(args[0]))
      throw new Error(`Destination already exists: ${args[0]}`)
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
  const temporary = mkdtempSync(resolve(".replica-download."))
  try {
    const archive = join(temporary, "replica.tar.gz")
    try {
      const response = await fetch("https://github.com/github/replica/archive/refs/heads/main.tar.gz")
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: "wx" }))
    } catch (error) {
      throw new Error("Could not download the Replica source archive. Check your network connection and access to GitHub, then try again.", { cause: error })
    }
    function tar(args) {
      return execFileSync("tar", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    }
    const members = tar(["-tzf", archive]).split(/\r?\n/).slice(0, -1)
    const types = tar(["-tvzf", archive]).split(/\r?\n/).slice(0, -1)
    if (members.length !== types.length) throw new Error("Replica source archive has an invalid listing.")
    const root = "replica-main"
    const scripts = ["scripts/starter-catalog.mjs", "scripts/create-prototype-repo.mjs"]
    const required = new Set([...scripts, "starters/catalog.tsv"])
    const seen = new Set()
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index]
      const path = member.slice(root.length + 1).replace(/\/$/, "")
      const parts = path.split("/")
      if (member !== `${root}/` && (!member.startsWith(`${root}/`) || parts.some(part =>
        !part || part === "." || part === ".." || /[\\:\x00-\x1f<>\"|?*]/.test(part) ||
        /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
      ))) throw new Error(`Replica source archive contains an unsafe path: ${member}`)
      if (path === "starters" || path.startsWith("starters/")) {
        if (parts.some(part => /^\.git$/i.test(part))) throw new Error("Replica source archive contains Git metadata.")
      }
      if (member === `${root}/` || path === "starters" || path.startsWith("starters/") ||
          path === "scripts" || scripts.includes(path)) {
        if ((member.endsWith("/") ? "d" : "-") !== types[index][0]) {
          throw new Error(`Replica source archive contains a linked or unsupported file: ${member}`)
        }
        if (seen.has(path.toLowerCase())) throw new Error(`Replica source archive contains a duplicate path: ${member}`)
        seen.add(path.toLowerCase())
      }
      required.delete(path)
    }
    if (required.size) throw new Error("Replica source archive is missing the starter catalog or setup scripts.")
    tar(["-xzf", archive, "-C", temporary, ...[...scripts, "starters/catalog.tsv"].map(path => `${root}/${path}`)])
    const { parseArguments, readCatalog, selectStarter } = await import(pathToFileURL(join(temporary, root, scripts[0])).href)
    const options = parseArguments(args)
    if (!options.help && !options.list) {
      const starter = selectStarter(readCatalog(join(temporary, root, "starters/catalog.tsv")), options.id)
      tar(["-xzf", archive, "-C", temporary, `${root}/starters/shared`, `${root}/${starter.directory}`])
    }
    const { createRepository } = await import(pathToFileURL(join(temporary, root, scripts[1])).href)
    if (options.help) {
      const { usage } = await import(pathToFileURL(join(temporary, root, scripts[0])).href)
      console.log(usage())
    } else {
      createRepository(options)
    }
    return 0
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

try {
  process.exitCode = await install(process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  process.exitCode = error.cause === 2 ? 2 : 1
}
