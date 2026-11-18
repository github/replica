import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, realpath, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it, onTestFinished } from "vitest"

import { discoverLocalRepositories } from "."

const execFileAsync = promisify(execFile)

async function git(directory: string, ...arguments_: string[]) {
  return execFileAsync("git", ["-C", directory, ...arguments_], {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-11-15T10:00:00Z",
      GIT_AUTHOR_EMAIL: "author@example.com",
      GIT_AUTHOR_NAME: "Prototype Author",
      GIT_COMMITTER_DATE: "2026-11-15T10:00:00Z",
      GIT_COMMITTER_EMAIL: "author@example.com",
      GIT_COMMITTER_NAME: "Prototype Author",
    },
  })
}

async function createRepository(directory: string) {
  await mkdir(directory, { recursive: true })
  await git(directory, "init", "--initial-branch=main")
  await writeFile(`${directory}/committed.txt`, "main\n")
  await git(directory, "add", "committed.txt")
  await git(directory, "commit", "--message=main")
  const mainSha = (await git(directory, "rev-parse", "main")).stdout.trim()

  await git(directory, "switch", "--create", "prototype/alternate")
  await writeFile(`${directory}/committed.txt`, "alternate\n")
  await git(directory, "commit", "--all", "--message=alternate")
  const alternateSha = (await git(directory, "rev-parse", "prototype/alternate")).stdout.trim()
  await git(directory, "switch", "main")

  return { alternateSha, mainSha }
}

function createRoot() {
  const root = resolve(`server/integrations/git/discover-local-repositories/.test-${randomUUID()}`)
  onTestFinished(() => rm(root, { force: true, recursive: true }))
  return root
}

describe("discoverLocalRepositories()", () => {
  it("returns only immediate child repositories and continues past a broken child", async () => {
    const root = createRoot()
    const valid = `${root}/valid-prototype`
    await mkdir(root, { recursive: true })
    await createRepository(valid)
    await mkdir(`${root}/ordinary-directory`)
    await createRepository(`${root}/container/nested-prototype`)
    await mkdir(`${root}/broken-prototype`)
    await writeFile(`${root}/broken-prototype/.git`, "gitdir: ../missing-git-directory\n")

    const result = await discoverLocalRepositories(root)

    expect(result.repositories).toHaveLength(1)
    expect(result.repositories[0]).toMatchObject({
      path: await realpath(valid),
      name: "valid-prototype",
    })
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({
      path: await realpath(`${root}/broken-prototype`),
    })
  })

  it("reports committed default and non-default branch heads with commit authors", async () => {
    const root = createRoot()
    const repository = `${root}/prototype`
    const { alternateSha, mainSha } = await createRepository(repository)

    const result = await discoverLocalRepositories(root)

    expect(result.failures).toEqual([])
    expect(result.repositories).toHaveLength(1)
    expect(result.repositories[0]!.defaultBranch).toBe("main")
    expect(result.repositories[0]!.branches).toEqual([
      {
        name: "main",
        commitSha: mainSha,
        authorName: "Prototype Author",
        authorEmail: "author@example.com",
        authoredAt: new Date("2026-11-15T10:00:00Z"),
      },
      {
        name: "prototype/alternate",
        commitSha: alternateSha,
        authorName: "Prototype Author",
        authorEmail: "author@example.com",
        authoredAt: new Date("2026-11-15T10:00:00Z"),
      },
    ])
    for (const head of result.repositories[0]!.branches) {
      expect(head.commitSha).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
    }
  })

  it("keeps branch names stable when a tag has the same short name", async () => {
    const root = createRoot()
    const repository = `${root}/prototype`
    await createRepository(repository)
    await git(repository, "tag", "main", "prototype/alternate")

    const result = await discoverLocalRepositories(root)

    expect(result.repositories[0]!.branches.map(({ name }) => name)).toEqual([
      "main",
      "prototype/alternate",
    ])
  })

  it("does not change observed branch heads for uncommitted work", async () => {
    const root = createRoot()
    const repository = `${root}/prototype`
    const expected = await createRepository(repository)
    await writeFile(`${repository}/committed.txt`, "uncommitted replacement\n")
    await writeFile(`${repository}/untracked.txt`, "untracked\n")

    const result = await discoverLocalRepositories(root)

    expect(
      Object.fromEntries(
        result.repositories[0]!.branches.map(({ name, commitSha }) => [name, commitSha]),
      ),
    ).toEqual({
      main: expected.mainSha,
      "prototype/alternate": expected.alternateSha,
    })
  })
})
