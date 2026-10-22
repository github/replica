import { execFileSync } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export async function checkAssets({
  assets = new URL("../", import.meta.url),
  build = () => execFileSync("npm", ["run", "extension:build"], { stdio: "inherit" }),
} = {}) {
  const before = await snapshot(assets)
  await build()
  const after = await snapshot(assets)
  const paths = new Set([...before.keys(), ...after.keys()])
  const differences = [...paths].filter(
    (name) => !before.has(name) || !after.has(name) || !before.get(name).equals(after.get(name)),
  )

  if (differences.length) {
    throw new Error(
      `Extension assets differ after build (changed, missing, or unexpected): ${differences.sort().join(", ")}`,
    )
  }
}

async function snapshot(assets) {
  const files = new Map()

  async function visit(directory, prefix = "") {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === "ENOENT") return
      throw error
    }
    for (const entry of entries) {
      const name = `${prefix}${entry.name}`
      const file = new URL(name, assets)
      if (entry.isDirectory()) {
        await visit(file, `${name}/`)
      } else {
        const content = await readFile(file)
        if (content.length > 1_000_000) {
          throw new Error(
            `Extension asset exceeds the installer limit of 1,000,000 bytes per file: ${name} (${content.length} bytes)`,
          )
        }
        files.set(name, content)
      }
    }
  }

  await visit(assets)
  return files
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await checkAssets()
}
