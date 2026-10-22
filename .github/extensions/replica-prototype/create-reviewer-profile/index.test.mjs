import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { createReviewerProfile } from "./index.mjs"
import { withContext } from "../test-support/with-context/index.mjs"

async function withProfileCommand(run) {
  await withContext(async (context) => {
    const originalPath = process.env.PATH
    await writeFile(
      path.join(context.repositoryPath, "gh"),
      `#!${process.execPath}
import fs from "node:fs"
fs.appendFileSync("profile-calls.jsonl", JSON.stringify(process.argv.slice(2)) + "\\n")
const response = JSON.parse(fs.readFileSync("profile-response.json", "utf8"))
process.stdout.write(response.stdout)
process.stderr.write(response.stderr || "")
process.exitCode = response.exitCode || 0
`,
      { mode: 0o755 },
    )
    process.env.PATH = `${context.repositoryPath}${path.delimiter}${originalPath || ""}`
    try {
      await run(context)
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  })
}

function scope() {
  return {
    hubOrigin: "https://hub.example.com",
    repository: "github/replica",
    connectionId: "first-connection",
    viewerLogin: "octocat",
  }
}

async function respond(context, response) {
  await writeFile(
    path.join(context.repositoryPath, "profile-response.json"),
    JSON.stringify(response),
  )
}

async function calls(context) {
  return (await readFile(path.join(context.repositoryPath, "profile-calls.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
}

describe("createReviewerProfile()", () => {
  it("shares one verified profile lookup and fetches again for a fresh connection or target", async () => {
    await withProfileCommand(async (context) => {
      const profile = createReviewerProfile(context)
      const target = scope()
      const avatarUrl = "https://avatars.githubusercontent.com/u/1?v=4"
      await respond(context, {
        stdout: JSON.stringify({
          login: "OctoCat",
          name: "Mona",
          avatar_url: avatarUrl,
        }),
      })
      const expected = {
        author: { login: "octocat", name: "Mona", avatarUrl },
        error: null,
      }
      assert.deepEqual(
        await Promise.all([profile.read(target), profile.read(target), profile.read(target)]),
        [expected, expected, expected],
      )
      assert.deepEqual(await profile.read(target), expected)
      assert.deepEqual(await calls(context), [["api", "--hostname", "github.com", "user"]])

      for (const changed of [
        { connectionId: "second-connection" },
        { hubOrigin: "https://another-hub.example.com" },
        { repository: "github/another" },
        { viewerLogin: "mona" },
      ]) {
        const next = { ...target, ...changed }
        await respond(context, {
          stdout: JSON.stringify({
            login: next.viewerLogin,
            name: "New profile",
            avatar_url: avatarUrl,
          }),
        })
        assert.deepEqual(await profile.read(next), {
          author: { login: next.viewerLogin, name: "New profile", avatarUrl },
          error: null,
        })
      }
      assert.equal((await calls(context)).length, 5)
    })
  })

  for (const [reason, response] of [
    ["unavailable gh", { stdout: "", stderr: "Authentication required", exitCode: 1 }],
    ["malformed JSON", { stdout: "not JSON" }],
    ["malformed profile", { stdout: "null" }],
    [
      "another signed-in account",
      {
        stdout: JSON.stringify({
          login: "mona",
          name: "Wrong reviewer",
          avatar_url: "https://avatars.githubusercontent.com/u/2",
        }),
      },
    ],
  ]) {
    it(`returns an explicit cached fallback for ${reason}`, async () => {
      await withProfileCommand(async (context) => {
        await respond(context, response)
        const profile = createReviewerProfile(context)
        const target = scope()
        const result = await profile.read(target)
        assert.deepEqual(result.author, {
          login: "octocat",
          name: null,
          avatarUrl: null,
        })
        assert.equal(typeof result.error, "string")
        assert.ok(result.error.trim())
        assert.deepEqual(await profile.read(target), result)
        assert.equal((await calls(context)).length, 1)
      })
    })
  }

  it("does not return photos outside the exact HTTPS GitHub avatar origin", async () => {
    await withProfileCommand(async (context) => {
      const profile = createReviewerProfile(context)
      for (const [index, avatarUrl] of [
        "http://avatars.githubusercontent.com/u/1",
        "https://avatars.githubusercontent.com.evil.example/u/1",
        "https://example.com/u/1",
      ].entries()) {
        await respond(context, {
          stdout: JSON.stringify({
            login: "octocat",
            name: "Mona",
            avatar_url: avatarUrl,
          }),
        })
        const result = await profile.read({
          ...scope(),
          connectionId: `connection-${index}`,
        })
        assert.equal(result.author.login, "octocat")
        assert.equal(result.author.avatarUrl, null)
        assert.equal(typeof result.error, "string")
        assert.ok(result.error.trim())
      }
    })
  })
})
