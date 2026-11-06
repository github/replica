import { execFile } from "node:child_process"
import { lstat, mkdir, mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { orderedScenes, verifySources } from "./catalog.ts"
import { renderScene } from "./render.ts"
import { startGallery } from "./server.ts"
import type { RenderedScene } from "./types.ts"

export async function run() {
  const repository = fileURLToPath(new URL("../../../", import.meta.url))
  await verifySources(repository)
  const catalog = orderedScenes()
  const scenes: RenderedScene[] = []
  console.log(`Rendering ${catalog.length} synthetic wizard screens. No deployment operations will run.`)
  for (const scene of catalog) scenes.push({ ...scene, ansi: await renderScene(scene) })
  const root = join(repository, "infrastructure", ".design-gallery")
  await mkdir(root, { recursive: true })
  if (!(await lstat(root)).isDirectory()) throw new Error("Design output must be a real directory, not a symlink.")
  const directory = await mkdtemp(join(root, "run-"))
  const { stdout } = await promisify(execFile)("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repository })
  const server = await startGallery({ directory, scenes, revision: stdout.trim() })
  console.log(`Open ${server.url} in an ordinary browser, then choose Generate all screens and PDF.`)
  console.log(`Output: ${directory}\nKeep this command running until export completes. Ctrl+C stops the local server.`)
  const stop = () => {
    void server.close().catch(error => {
      console.error(error instanceof Error ? error.message : "Could not close the capture server.")
      process.exitCode = 1
    })
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
}
