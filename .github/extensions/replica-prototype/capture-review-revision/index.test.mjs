import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { captureReviewRevision } from "./index.mjs"

async function withRepository(run) {
  const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
  const repositoryPath = path.join(workspace, "repository")
  await mkdir(repositoryPath, { recursive: true })
  function git(...args) {
    return execFileSync("git", args, {
      cwd: repositoryPath,
      encoding: "utf8",
      stdio: "pipe",
    }).trim()
  }
  try {
    git("init", "-q", "-b", "prototype")
    git("config", "user.name", "Replica")
    git("config", "user.email", "replica@example.com")
    git("config", "commit.gpgsign", "false")
    await writeFile(path.join(repositoryPath, "tracked.txt"), "original\n")
    await writeFile(path.join(repositoryPath, ".gitignore"), "ignored.txt\n")
    git("add", ".")
    git("commit", "-qm", "Fixture")
    await run({ repositoryPath }, git, workspace)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

describe("captureReviewRevision()", () => {
  it("returns the actual HEAD tree and commit for a clean checkout and excludes ignored files", async () => {
    await withRepository(async (context, git) => {
      await writeFile(path.join(context.repositoryPath, "ignored.txt"), "local secret\n")

      const revision = await captureReviewRevision(context)

      assert.deepEqual(revision, {
        treeSha: git("rev-parse", "HEAD^{tree}"),
        commitSha: git("rev-parse", "HEAD"),
        clean: true,
      })
      await writeFile(path.join(context.repositoryPath, "ignored.txt"), "changed secret\n")
      assert.deepEqual(await captureReviewRevision(context), revision)
    })
  })

  it("captures working-tree contents rather than staged contents without changing the real index", async () => {
    await withRepository(async (context, git) => {
      const tracked = path.join(context.repositoryPath, "tracked.txt")
      await writeFile(tracked, "staged\n")
      git("add", "tracked.txt")
      const indexPath = path.join(context.repositoryPath, ".git/index")
      const stagedTree = git("write-tree")
      const index = await readFile(indexPath)
      const stagedRevision = await captureReviewRevision(context)
      assert.equal(stagedRevision.treeSha, stagedTree)
      assert.equal(stagedRevision.clean, false)
      assert.deepEqual(await readFile(indexPath), index)
      await writeFile(tracked, "unstaged after staging\n")

      const revision = await captureReviewRevision(context)

      assert.equal(revision.clean, false)
      assert.equal(revision.commitSha, git("rev-parse", "HEAD"))
      assert.notEqual(revision.treeSha, stagedTree)
      assert.notEqual(revision.treeSha, git("rev-parse", "HEAD^{tree}"))
      assert.equal(git("show", `${revision.treeSha}:tracked.txt`), "unstaged after staging")
      assert.deepEqual(await readFile(indexPath), index)
      assert.equal(git("write-tree"), stagedTree)
      assert.deepEqual(await captureReviewRevision(context), revision)
    })
  })

  it("includes nonignored untracked files even when Git status hides them", async () => {
    await withRepository(async (context, git) => {
      git("config", "status.showUntrackedFiles", "no")
      const originalTree = git("rev-parse", "HEAD^{tree}")
      await writeFile(path.join(context.repositoryPath, "new file.txt"), "new contents\n")

      const revision = await captureReviewRevision(context)

      assert.equal(revision.clean, false)
      assert.notEqual(revision.treeSha, originalTree)
      assert.equal(git("show", `${revision.treeSha}:new file.txt`), "new contents")
      assert.equal(git("diff", "--cached"), "")
      await rm(path.join(context.repositoryPath, "new file.txt"))
      assert.equal((await captureReviewRevision(context)).treeSha, originalTree)
    })
  })

  it("records tracked deletions without staging them", async () => {
    await withRepository(async (context, git) => {
      await rm(path.join(context.repositoryPath, "tracked.txt"))

      const revision = await captureReviewRevision(context)

      assert.equal(revision.clean, false)
      assert.notEqual(revision.treeSha, git("rev-parse", "HEAD^{tree}"))
      assert.equal(git("ls-tree", "--name-only", revision.treeSha, "tracked.txt"), "")
      assert.equal(git("diff", "--cached"), "")
    })
  })

  it("rejects dirty submodules instead of claiming their unchanged gitlink identifies the preview", async () => {
    await withRepository(async (context, git, workspace) => {
      const source = path.join(workspace, "submodule-source")
      await mkdir(source)
      execFileSync("git", ["init", "-q", source], { stdio: "pipe" })
      await writeFile(path.join(source, "component.txt"), "original\n")
      execFileSync("git", ["-C", source, "add", "."], { stdio: "pipe" })
      execFileSync(
        "git",
        [
          "-C",
          source,
          "-c",
          "user.name=Replica",
          "-c",
          "user.email=replica@example.com",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-qm",
          "Submodule fixture",
        ],
        { stdio: "pipe" },
      )
      git("-c", "protocol.file.allow=always", "submodule", "add", source, "component")
      git("commit", "-qm", "Add submodule")
      assert.equal((await captureReviewRevision(context)).clean, true)
      await writeFile(path.join(context.repositoryPath, "component/component.txt"), "dirty\n")

      await assert.rejects(() => captureReviewRevision(context), /submodule/i)
    })
  })
})
