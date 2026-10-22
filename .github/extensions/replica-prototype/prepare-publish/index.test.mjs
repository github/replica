import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { it } from "node:test"

import { createPublishPreferences } from "../publish-preferences/index.mjs"
import { withContext } from "../test-support/with-context/index.mjs"
import { preparePublish } from "./index.mjs"

it("retains a verified target and saved preference after a failed check, then checks again on retry", async () => {
  await withContext(async (context) => {
    const preferences = createPublishPreferences(path.join(context.sessionWorkspacePath, "prefs"))
    await writeFile(
      path.join(context.repositoryPath, ".git/info/exclude"),
      "replica-prototype/\nprefs/\n",
    )
    const initial = await preparePublish(context, preferences)
    await preferences.write(initial.target, true)
    const index = path.join(context.repositoryPath, ".git/index")
    await writeFile(index, "invalid Git index")
    const unavailable = await preparePublish(context, preferences)
    assert.deepEqual(unavailable.target, initial.target)
    assert.equal(unavailable.workingTree, "unavailable")
    assert.equal(unavailable.remember, true)
    assert.equal(typeof unavailable.workingTreeError, "string")
    assert.ok(unavailable.workingTreeError.length > 0)
    assert.equal("changes" in unavailable, false)
    await rm(index)
    await writeFile(path.join(context.repositoryPath, "prototype.txt"), "Local changes")
    const retried = await preparePublish(context, preferences)
    assert.equal(retried.workingTree, "changed")
    assert.deepEqual(retried.changes.files, {
      paths: ["prototype.txt"],
      total: 1,
    })
    assert.equal("workingTreeError" in retried, false)
  })
})

it("checks fresh staged, unstaged and untracked changes without touching Git or dispatching", async () => {
  await withContext(async (context) => {
    const preferences = createPublishPreferences(path.join(context.sessionWorkspacePath, "prefs"))
    await writeFile(
      path.join(context.repositoryPath, ".git/info/exclude"),
      "replica-prototype/\nprefs/\n",
    )
    function git(...args) {
      return execFileSync("git", args, {
        cwd: context.repositoryPath,
        encoding: "utf8",
      })
    }
    git("config", "user.name", "Test")
    git("config", "user.email", "test@example.com")
    git("config", "commit.gpgsign", "false")
    const file = path.join(context.repositoryPath, "tracked.txt")
    await writeFile(file, "initial")
    git("add", "tracked.txt")
    git("commit", "-qm", "Fixture")
    git("config", "status.showUntrackedFiles", "no")
    assert.equal((await preparePublish(context, preferences)).workingTree, "clean")
    await mkdir(path.join(context.repositoryPath, ".github/skills/local"), { recursive: true })
    await writeFile(path.join(context.repositoryPath, ".github/skills/local/SKILL.md"), "skill")
    const localOnly = await preparePublish(context, preferences)
    assert.equal(localOnly.workingTree, "clean")
    assert.deepEqual(localOnly.changes, {
      files: { paths: [], total: 0 },
      localSkills: { paths: [".github/skills/local/SKILL.md"], total: 1 },
    })
    await writeFile(file, "unstaged")
    const unstaged = await preparePublish(context, preferences)
    assert.equal(unstaged.workingTree, "changed")
    assert.deepEqual(unstaged.changes.files, { paths: ["tracked.txt"], total: 1 })
    git("add", "tracked.txt")
    const staged = git("diff", "--cached")
    const head = git("rev-parse", "HEAD").trim()
    await preferences.write({ repository: "github/replica", branch: "prototype" }, true)
    const preparation = await preparePublish(context, preferences)
    assert.equal(preparation.target.commitSha, head)
    assert.equal(preparation.workingTree, "changed")
    assert.equal(preparation.remember, true)
    assert.equal(git("diff", "--cached"), staged)
    git("commit", "-qm", "Staged fixture")
    await writeFile(path.join(context.repositoryPath, "untracked.txt"), "new")
    assert.equal((await preparePublish(context, preferences)).workingTree, "changed")
    git("switch", "-qc", "another-prototype")
    assert.equal(
      (
        await preparePublish(
          {
            ...context,
            target: { ...context.target, branch: "another-prototype" },
          },
          preferences,
        )
      ).remember,
      false,
    )
  })
})
