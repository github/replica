import assert from "node:assert/strict"
import { it } from "node:test"
import { execFileSync } from "node:child_process"
import { withContext } from "../test-support/with-context/index.mjs"
import { readCanvasAuthorProfile } from "./index.mjs"

it("looks up only the Hub-verified login on the supported GitHub host", async () => {
  await withContext(async (context) => {
    execFileSync("git", ["remote", "add", "origin", "https://github.com/example/prototype.git"], {
      cwd: context.repositoryPath,
    })
    const result = await readCanvasAuthorProfile(
      context,
      "mona_enterprise",
      async (command, args, cwd) => {
        assert.equal(command, "gh")
        assert.deepEqual(args, ["api", "--hostname", "github.com", "users/mona_enterprise"])
        assert.equal(cwd, context.repositoryPath)
        return {
          ok: true,
          stdout: JSON.stringify({
            login: "Mona_Enterprise",
            avatar_url: "https://avatars.githubusercontent.com/u/42?v=4",
          }),
        }
      },
    )
    assert.deepEqual(result, {
      avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
      error: null,
    })
  })
})

it("keeps a visible profile error and neutral fallback for invalid or unavailable responses", async () => {
  await withContext(async (context) => {
    execFileSync("git", ["remote", "add", "origin", "https://github.com/example/prototype.git"], {
      cwd: context.repositoryPath,
    })
    for (const response of [
      { ok: false, error: "Unavailable" },
      { ok: true, stdout: "invalid" },
      ...[
        {
          login: "other",
          avatar_url: "https://avatars.githubusercontent.com/u/42",
        },
        { login: "mona", avatar_url: "https://example.com/avatar.png" },
        {
          login: "mona",
          avatar_url: "https://name:secret@avatars.githubusercontent.com/u/42",
        },
        {
          login: "mona",
          avatar_url: "http://avatars.githubusercontent.com/u/42",
        },
      ].map((profile) => ({ ok: true, stdout: JSON.stringify(profile) })),
    ]) {
      const result = await readCanvasAuthorProfile(context, "mona", async () => response)
      assert.equal(result.avatarUrl, null)
      assert.ok(result.error)
    }
  })
})
