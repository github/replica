import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { createLocalReviewComments } from "./index.mjs"
import { withContext } from "../test-support/with-context/index.mjs"

function git(context, ...args) {
  return execFileSync("git", args, {
    cwd: context.repositoryPath,
    encoding: "utf8",
  }).trim()
}

function revision(context) {
  const treeSha = git(context, "rev-parse", "HEAD^{tree}")
  return { id: Number.parseInt(treeSha.slice(0, 12), 16), treeSha }
}

function localComments(context) {
  return createLocalReviewComments(context, {
    directory: path.join(context.repositoryPath, ".git", "local-review-comments"),
  })
}

function build(context) {
  return {
    repositoryId: 5,
    prototypeId: 4,
    number: 7,
    commitSha: git(context, "rev-parse", "HEAD"),
    publishedAt: "2099-01-01T00:00:00Z",
  }
}

function fixture(context) {
  return {
    scope: {
      hubOrigin: "https://hub.example.com",
      repository: "github/replica",
      branch: "prototype",
      viewerLogin: "octocat",
    },
    comments: localComments(context),
    captured: revision(context),
  }
}

describe("createLocalReviewComments()", () => {
  it("saves verified profile metadata without replacing the Hub viewer login", async () => {
    await withContext(async (context) => {
      const { comments, captured, scope } = fixture(context)
      const author = {
        login: "OctoCat",
        name: "Mona",
        avatarUrl: "https://avatars.githubusercontent.com/u/1",
      }
      const created = await comments.create({ ...scope, author }, captured, {
        body: "Keep this selection",
        anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
      })
      const expected = { ...author, login: scope.viewerLogin }
      assert.deepEqual(created.author, expected)
      assert.deepEqual((await localComments(context).list(scope))[0].author, expected)
      const updated = await comments.update(
        {
          ...scope,
          author: { login: scope.viewerLogin, name: null, avatarUrl: null },
        },
        created.id,
        "Keep the saved profile",
      )
      assert.deepEqual(updated.author, expected)
      assert.deepEqual((await localComments(context).list(scope))[0].author, expected)
    })
  })

  it("projects a matching profile onto persisted comments without rewriting storage", async () => {
    await withContext(async (context) => {
      const { comments, captured, scope } = fixture(context)
      const created = await comments.create(scope, captured, {
        body: "Written before profile discovery",
        anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
      })
      const directory = path.join(context.repositoryPath, ".git", "local-review-comments")
      const file = path.join(
        directory,
        (await readdir(directory)).find((name) => name.endsWith(".json")),
      )
      const saved = await readFile(file, "utf8")
      const author = {
        login: "OCTOCAT",
        name: "Mona",
        avatarUrl: "https://avatars.githubusercontent.com/u/1",
      }
      const enrichedScope = { ...scope, author }
      const expected = { ...author, login: created.author.login }
      assert.deepEqual((await localComments(context).list(enrichedScope))[0].author, expected)
      assert.equal(await readFile(file, "utf8"), saved)
      const updated = await localComments(context).update(
        enrichedScope,
        created.id,
        "Updated feedback",
      )
      assert.deepEqual(updated.author, expected)
      assert.deepEqual((await localComments(context).list(scope))[0].author, expected)
    })
  })

  it("never applies another account's metadata or reassigns historical authors", async () => {
    await withContext(async (context) => {
      const { comments, captured, scope } = fixture(context)
      const anotherAuthor = {
        login: "mona",
        name: "Another reviewer",
        avatarUrl: "https://avatars.githubusercontent.com/u/2",
      }
      const created = await comments.create({ ...scope, author: anotherAuthor }, captured, {
        body: "Keep the connected identity",
        anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
      })
      assert.deepEqual(created.author, {
        login: scope.viewerLogin,
        name: null,
        avatarUrl: null,
      })
      const directory = path.join(context.repositoryPath, ".git", "local-review-comments")
      const file = path.join(
        directory,
        (await readdir(directory)).find((name) => name.endsWith(".json")),
      )
      const entries = JSON.parse(await readFile(file, "utf8"))
      entries[0].comment.author = anotherAuthor
      await writeFile(file, JSON.stringify(entries))

      const verifiedScope = {
        ...scope,
        author: {
          login: scope.viewerLogin,
          name: "Current reviewer",
          avatarUrl: "https://avatars.githubusercontent.com/u/1",
        },
      }
      assert.deepEqual((await comments.list(verifiedScope))[0].author, anotherAuthor)
      const updated = await comments.update(
        verifiedScope,
        created.id,
        "Preserve historical ownership",
      )
      assert.deepEqual(updated.author, anotherAuthor)
      assert.deepEqual((await localComments(context).list(scope))[0].author, anotherAuthor)
    })
  })

  it("persists local edits and deletion across instances", async () => {
    await withContext(async (context) => {
      const { scope, captured } = fixture(context)
      const anchor = { schemaVersion: 1, kind: "element", selector: "#save" }
      const created = await localComments(context).create(scope, captured, {
        body: "Keep this selection",
        anchor,
      })
      assert.deepEqual(await localComments(context).list(scope), [created])
      const updated = await localComments(context).update(scope, created.id, "Revised feedback")
      assert.equal(updated.body, "Revised feedback")
      assert.deepEqual(await localComments(context).list(scope), [updated])
      await localComments(context).remove(scope, created.id)
      assert.deepEqual(await localComments(context).list(scope), [])
    })
  })

  it("isolates comments by Hub, repository, branch and reviewer", async () => {
    await withContext(async (context) => {
      const { comments, captured, scope } = fixture(context)
      const original = await comments.create(scope, captured, {
        body: "Original reviewer",
        anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
      })
      for (const changed of [
        { hubOrigin: "https://another-hub.example.com" },
        { repository: "github/another" },
        { branch: "another-branch" },
        { viewerLogin: "mona" },
      ]) {
        const isolated = { ...scope, ...changed }
        assert.deepEqual(await comments.list(isolated), [])
      }
      assert.deepEqual(await localComments(context).list(scope), [original])
    })
  })

  it("uploads only matching source to an imported Build even when its commit differs", async () => {
    await withContext(async (context) => {
      const { comments, captured, scope } = fixture(context)
      const originalCommit = git(context, "rev-parse", "HEAD")
      const anchor = {
        schemaVersion: 1,
        kind: "element",
        selector: "#original",
      }
      await comments.create(scope, captured, {
        body: "Matching source",
        anchor,
      })
      await writeFile(path.join(context.repositoryPath, "new.txt"), "Different source")
      git(context, "add", "new.txt")
      const otherTree = git(context, "write-tree")
      const other = {
        id: Number.parseInt(otherTree.slice(0, 12), 16),
        treeSha: otherTree,
      }
      const retained = await comments.create(scope, other, {
        body: "Not in this Build",
        anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
      })
      git(context, "reset", "--quiet")
      git(
        context,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-qm",
        "Same source, different commit",
      )
      const imported = build(context)
      assert.notEqual(imported.commitSha, originalCommit)
      const requests = []
      await comments.sync(scope, imported, {
        async request(route, options) {
          requests.push({ route, options })
          return {
            comments: [{ id: 900, kind: "root", buildNumber: imported.number }],
          }
        },
      })
      assert.equal(requests.length, 1)
      assert.deepEqual(requests[0].options.body.review_comment, {
        body: "Matching source",
        anchor,
        build_number: imported.number,
      })
      assert.deepEqual(await localComments(context).list(scope), [retained])
      await comments.sync(scope, imported, {
        async request() {
          assert.fail("A synchronized comment must not be uploaded twice.")
        },
      })
      await assert.rejects(
        comments.sync(
          scope,
          { ...imported, commitSha: "f".repeat(40) },
          {
            async request() {
              assert.fail("An unknown Build must not receive local feedback.")
            },
          },
        ),
        /Fetch the published Build commit/,
      )
      assert.deepEqual(await localComments(context).list(scope), [retained])
    })
  })

  it("does not attach new feedback to an older Build with the same source tree", async () => {
    await withContext(async (context) => {
      const { comments, captured, scope } = fixture(context)
      const imported = build(context)
      const draft = await comments.create(scope, captured, {
        body: "Feedback captured after the old Build",
        anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
      })
      await comments.sync(
        scope,
        {
          ...imported,
          publishedAt: new Date(Date.parse(draft.createdAt) - 1).toISOString(),
        },
        {
          async request() {
            assert.fail("A Build published before the feedback must not claim it.")
          },
        },
      )
      assert.deepEqual(await localComments(context).list(scope), [draft])
    })
  })

  it("retains rejected uploads for a later retry and propagates the Hub error", async () => {
    await withContext(async (context) => {
      const { comments, captured, scope } = fixture(context)
      const draft = await comments.create(scope, captured, {
        body: "Retry this feedback",
        anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
      })
      const failure = Object.assign(new Error("Hub denied the request"), {
        statusCode: 403,
      })
      await assert.rejects(
        comments.sync(scope, build(context), {
          async request() {
            throw failure
          },
        }),
        (error) => error === failure,
      )
      assert.deepEqual(await localComments(context).list(scope), [draft])
      let retries = 0
      await localComments(context).sync(scope, build(context), {
        async request() {
          retries += 1
          return { comments: [{ id: 901, kind: "root", buildNumber: 7 }] }
        },
      })
      assert.equal(retries, 1)
      assert.deepEqual(await localComments(context).list(scope), [])
    })
  })

  it("keeps previous Prototype feedback separate even when a new history has the same source", async () => {
    await withContext(async (context) => {
      const { comments, captured, scope } = fixture(context)
      const previous = await comments.create(
        scope,
        { ...captured, prototypeId: 4 },
        {
          body: "Feedback for the previous history",
          anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
        },
      )
      await comments.create(
        scope,
        { ...captured, prototypeId: 9 },
        {
          body: "Feedback for the current history",
          anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
        },
      )
      const imported = { ...build(context), prototypeId: 9 }
      let uploads = 0
      await localComments(context).sync(scope, imported, {
        async request(route, options) {
          uploads += 1
          assert.equal(route, "/api/canvas/repositories/5/prototypes/9/review_comments")
          assert.equal(options.body.review_comment.body, "Feedback for the current history")
          return {
            comments: [{ id: 904, kind: "root", buildNumber: imported.number }],
          }
        },
      })
      assert.equal(uploads, 1)
      assert.deepEqual(await localComments(context).list(scope), [previous])
    })
  })

  it("reconciles an ambiguous upload to its original Build after a newer Build arrives", async () => {
    await withContext(async (context) => {
      const { comments, captured, scope } = fixture(context)
      const draft = await comments.create(scope, captured, {
        body: "Response was lost",
        anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
      })
      const imported = build(context)
      const failure = new Error("Connection lost after sending")
      await assert.rejects(
        comments.sync(scope, imported, {
          async request() {
            throw failure
          },
        }),
        (error) => error === failure,
      )
      const pending = [{ ...draft, viewerCanEdit: false }]
      assert.deepEqual(await localComments(context).list(scope), pending)
      const newerBuild = { ...imported, number: imported.number + 1 }
      await assert.rejects(
        localComments(context).sync(scope, newerBuild, {
          async request(route, options) {
            assert.notEqual(options.method, "POST", "An uncertain save must never be replayed.")
            return { comments: [], hasMore: false, nextCursor: null }
          },
        }),
        /could not be confirmed/,
      )
      assert.deepEqual(await localComments(context).list(scope), pending)
      await localComments(context).sync(scope, newerBuild, {
        async request(route, options) {
          assert.notEqual(options.method, "POST", "Reconciliation must not create another root.")
          return {
            comments: [
              {
                ...draft,
                id: 902,
                buildNumber: imported.number,
                createdAt: new Date().toISOString(),
              },
            ],
            hasMore: false,
            nextCursor: null,
          }
        },
      })
      assert.deepEqual(await localComments(context).list(scope), [])
    })
  })
})
