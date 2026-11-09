import { lstatSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const BASELINE_DIRECTORY = fileURLToPath(new URL("../references/local-context/", import.meta.url))
const CONTEXT_FILES = [
  "REPOSITORY.md",
  "DESIGN-SYSTEM.md",
  "PRODUCT-DESIGN.md",
  "BROWSER-VALIDATION.md",
  "SEED-DATA.md",
  "RESPONSIVE-DESIGN.md",
  "ACCESSIBILITY.md",
]

function existingEntry(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error.code === "ENOENT") return undefined
    throw error
  }
}

function bootstrapContext() {
  if (process.argv.length > 2) throw new Error("Run bootstrap-context.mjs without arguments from the prototype root.")

  const root = process.cwd()
  for (const parent of [".agents", ".github"]) {
    const entry = existingEntry(join(root, parent))
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) {
      throw new Error(`${parent} must be a real directory, not a file or link.`)
    }
  }

  const existing = [".agents/context", ".github/contexts"].find((path) =>
    existingEntry(join(root, path)),
  )
  if (existing) return `Preserved ${existing}; existing guidance was not changed or checked for completeness.`

  const documents = CONTEXT_FILES.map((name) => [
    name,
    readFileSync(join(BASELINE_DIRECTORY, name)),
  ])
  const destination = join(root, ".agents/context")
  mkdirSync(join(root, ".agents"), { recursive: true })
  try {
    mkdirSync(destination)
  } catch (error) {
    if (error.code === "EEXIST") return "Preserved .agents/context created by another operation."
    throw error
  }

  if (existingEntry(join(root, ".github/contexts"))) {
    rmdirSync(destination)
    return "Preserved .github/contexts created by another operation."
  }
  for (const [name, content] of documents) {
    writeFileSync(join(destination, name), content, { flag: "wx" })
  }
  return "Created .agents/context from the fixed Minimal baseline; no captured data was read."
}

try {
  console.log(bootstrapContext())
} catch (error) {
  console.error(`Cannot bootstrap fixed local context: ${error.message}`)
  process.exitCode = 1
}
