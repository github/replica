import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

import { validateChecksConfigFiles } from "./files.mjs"

const directory = fileURLToPath(new URL(".", import.meta.url))

async function fixture(test) {
  const root = await mkdtemp(path.join(directory, ".files-test-"))
  test.after(() => rm(root, { recursive: true, force: true }))
  const repository = path.join(root, "repository")
  await mkdir(path.join(repository, "guidance"), { recursive: true })
  await writeFile(path.join(repository, "guidance/context.md"), "Repository guidance.\n")
  await writeFile(
    path.join(repository, "guidance/review.md"),
    "Review source without changing it.\n",
  )
  return {
    root,
    repository,
    config: {
      version: 2,
      checks: [
        {
          id: "first",
          name: "First review",
          inputs: { include: ["src/**"] },
          runner: { type: "agent", instructions: "guidance/review.md" },
          context: ["guidance/context.md"],
        },
        {
          id: "second",
          name: "Second review",
          inputs: { include: ["src/**"] },
          runner: {
            type: "command",
            command: ["never-run-this-command"],
          },
        },
      ],
    },
  }
}

describe("validateChecksConfigFiles()", () => {
  it("accepts bounded UTF-8 guidance without requiring source inputs, Git or runner executables", async (test) => {
    const { repository, config } = await fixture(test)
    config.checks[1].inputs = { include: ["src/not-created.ts"] }
    await writeFile(path.join(repository, "guidance/context.md"), "é".repeat(50000))
    await assert.doesNotReject(() => validateChecksConfigFiles(config, repository))
  })

  it("checks context and agent instructions on every declared check", async (test) => {
    const { repository, config } = await fixture(test)
    config.checks[1].context = ["guidance/missing.md"]
    await assert.rejects(
      () => validateChecksConfigFiles(config, repository),
      /guidance\/missing\.md/,
    )
    delete config.checks[1].context
    config.checks[1].runner = {
      type: "agent",
      instructions: "guidance/missing.md",
    }
    await assert.rejects(
      () => validateChecksConfigFiles(config, repository),
      /guidance\/missing\.md/,
    )
  })

  it("rejects directories in place of guidance text", async (test) => {
    const { repository, config } = await fixture(test)
    config.checks[0].context = ["guidance"]
    await assert.rejects(() => validateChecksConfigFiles(config, repository), /guidance/)
  })

  it("rejects symlinked files even when their target is inside the repository", async (test) => {
    const { repository, config } = await fixture(test)
    await symlink("context.md", path.join(repository, "guidance/linked.md"))
    config.checks[0].context = ["guidance/linked.md"]
    await assert.rejects(() => validateChecksConfigFiles(config, repository), /linked\.md/)
  })

  it("rejects symlinked parent directories and traversal to existing outside files", async (test) => {
    const { root, repository, config } = await fixture(test)
    await writeFile(path.join(root, "outside.md"), "Outside guidance.")
    await symlink(root, path.join(repository, "linked"))
    config.checks[0].runner.instructions = "linked/outside.md"
    await assert.rejects(() => validateChecksConfigFiles(config, repository), /linked|symlink/)
    config.checks[0].runner.instructions = "../outside.md"
    await assert.rejects(
      () => validateChecksConfigFiles(config, repository),
      /file|path|reference/i,
    )
  })

  it("rejects guidance over the byte limit rather than counting decoded characters", async (test) => {
    const { repository, config } = await fixture(test)
    await writeFile(path.join(repository, "guidance/context.md"), "é".repeat(50000) + "a")
    await assert.rejects(() => validateChecksConfigFiles(config, repository), /context\.md/)
  })

  it("rejects invalid UTF-8 and NUL text rather than silently replacing or accepting it", async (test) => {
    const { repository, config } = await fixture(test)
    for (const content of [Buffer.from([0xc3, 0x28]), Buffer.from("guidance\0hidden")]) {
      await writeFile(path.join(repository, "guidance/review.md"), content)
      await assert.rejects(() => validateChecksConfigFiles(config, repository), /review\.md/)
    }
  })
})
