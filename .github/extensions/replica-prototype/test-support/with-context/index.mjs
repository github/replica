import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createCanvasContext } from "../../create-canvas-context/index.mjs"
export async function withContext(run) {
  const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
  await mkdir(workspace, { recursive: true })
  try {
    execFileSync("git", ["init", "-q", "-b", "prototype"], { cwd: workspace })
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-qm",
        "Fixture",
      ],
      { cwd: workspace },
    )
    const context = await createCanvasContext({
      prototypeUrl: "http://localhost:3000",
      name: "Demo",
      repository: "github/replica",
      branch: "prototype",
      publishedUrl: "https://hub.example.com/prototype",
      sessionWorkspacePath: workspace,
      repositoryPath: workspace,
    })
    await run(context)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}
