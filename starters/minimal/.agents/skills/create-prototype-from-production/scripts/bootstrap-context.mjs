import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
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

function checkParents(root) {
  for (const parent of [".agents", ".github"]) {
    const entry = existingEntry(join(root, parent))
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) {
      throw new Error(`${parent} must be a real directory, not a file or link.`)
    }
  }
}

function existingContext(root) {
  return [".agents/context", ".github/contexts"].find((path) =>
    existingEntry(join(root, path)),
  )
}

function bootstrapContext() {
  if (process.argv.length > 2) throw new Error("Run bootstrap-context.mjs without arguments from the prototype root.")

  const root = process.cwd()
  checkParents(root)
  const existing = existingContext(root)
  if (existing) return `Preserved ${existing}; existing guidance was not changed or checked for completeness.`

  const documents = CONTEXT_FILES.map((name) => [
    name,
    readFileSync(join(BASELINE_DIRECTORY, name)),
  ])
  const destination = join(root, ".agents/context")
  mkdirSync(join(root, ".agents"), { recursive: true })
  const staging = mkdtempSync(join(root, ".agents", ".context-bootstrap-"))
  let preserved
  try {
    for (const [name, content] of documents) {
      writeFileSync(join(staging, name), content, { flag: "wx" })
    }
    checkParents(root)
    preserved = existingContext(root)
    if (!preserved) {
      renameSync(staging, destination)
      return "Created .agents/context from the fixed Minimal baseline; no captured data was read."
    }
  } catch (error) {
    try {
      rmSync(staging, { recursive: true, force: true })
    } catch (cleanupError) {
      throw new Error(`${error.message}; cannot remove bootstrap staging ${staging}: ${cleanupError.message}`, {
        cause: error,
      })
    }
    throw error
  }

  rmSync(staging, { recursive: true })
  return `Preserved ${preserved}; existing guidance was not changed or checked for completeness.`
}

try {
  console.log(bootstrapContext())
} catch (error) {
  console.error(`Cannot bootstrap fixed local context: ${error.message}`)
  process.exitCode = 1
}
