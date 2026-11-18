import { lstatSync, readFileSync } from "node:fs"
import { dirname } from "node:path"

const idPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function usage() {
  return "Usage: node scripts/create-prototype-repo.mjs [--starter <id>] <new-repository-directory>\n       node scripts/create-prototype-repo.mjs --list"
}

export function parseArguments(args) {
  const options = { id: "minimal", list: false, help: false, destination: undefined }
  let selected = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--help" || argument === "-h") options.help = true
    else if (argument === "--list") options.list = true
    else if (argument === "--starter") {
      if (selected || !idPattern.test(args[index + 1] ?? "")) {
        throw new Error("Provide one starter ID after --starter. Use --list to see available starters.", { cause: 2 })
      }
      options.id = args[++index]
      selected = true
    } else if (argument === "--") {
      if (options.destination || index !== args.length - 2 || !args[index + 1]) {
        throw new Error(usage(), { cause: 2 })
      }
      options.destination = args[++index]
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`, { cause: 2 })
    } else {
      if (options.destination || !argument) throw new Error(usage(), { cause: 2 })
      options.destination = argument
    }
  }
  if (!options.help && ((options.list && options.destination) || (!options.list && !options.destination && !selected))) {
    throw new Error(usage(), { cause: 2 })
  }
  return options
}

export function readCatalog(path) {
  if (!lstatSync(path).isFile() || lstatSync(dirname(path)).isSymbolicLink()) {
    throw new Error(`Starter catalog is missing or linked: ${path}`)
  }
  const entries = []
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue
    const [id, directory, name, description, ...extra] = line.split("\t")
    if (!idPattern.test(id) || !/^starters\/[a-z0-9]+(-[a-z0-9]+)*$/.test(directory) ||
        directory === "starters/shared" || !name || !description || extra.length || line.includes("\r") ||
        entries.some(entry => entry.id === id || entry.directory === directory)) {
      throw new Error(`Invalid or duplicate starter catalog entry: ${line}`)
    }
    entries.push({ id, directory, name, description })
  }
  if (!entries.length) throw new Error("Starter catalog has no entries.")
  return entries
}

export function selectStarter(entries, id) {
  const entry = entries.find(entry => entry.id === id)
  if (!entry) throw new Error(`Unknown starter: ${id}. Use --list to see available starters.`)
  return entry
}

export function printCatalog(entries) {
  for (const { id, name, description } of entries) console.log(`${id}\t${name}\t${description}`)
}

export function safeRelativePath(path) {
  return path.split("/").every(part =>
    part && part !== "." && part !== ".." && !/[\\:\x00-\x1f<>\"|?*]/.test(part) &&
    !/[. ]$/.test(part) && !/^\.git$/i.test(part) &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
  )
}
