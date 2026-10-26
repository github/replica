import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { commentActions } from "./index.mjs"

class TestCanvasError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

describe("commentActions()", () => {
  it("declares read-only retrieval and explicitly authorized mutation actions", async () => {
    const calls = []
    const actions = commentActions(async (...args) => {
      calls.push(args)
      return { result: true }
    }, TestCanvasError)
    assert.deepEqual(
      actions.map(({ name }) => name),
      [
        "list_comments",
        "get_comment_thread",
        "list_repository_comments",
        "get_repository_comment_thread",
        "list_repository_comment_summaries",
        "get_repository_thread",
        "mark_comment_read",
        "reply_to_comment",
        "resolve_comment",
      ],
    )
    for (const action of actions) {
      assert.equal(action.inputSchema.additionalProperties, false)
      if (action.name.startsWith("list_") || action.name.startsWith("get_"))
        assert.match(action.description, /without changing|without marking/)
      else assert.match(action.description, /user explicitly requests or confirms/)
    }
    assert.deepEqual(
      await actions[0].handler({
        instanceId: "panel",
        input: { read: "unread" },
      }),
      { result: true },
    )
    assert.deepEqual(calls, [["panel", "list_comments", { read: "unread" }]])
  })

  it("exposes summary-first overview guidance", () => {
    const actions = commentActions(async () => {}, TestCanvasError)
    const summaries = actions.find(({ name }) => name === "list_repository_comment_summaries")
    assert.match(summaries.description, /^Default\s+for\b[^.]*comments\s+across\s+prototypes\b/i)
    assert.match(
      summaries.description,
      /(?:fetch|retrieve)\s+selected\s+(?:conversations|threads)\s+with\s+get_repository_thread\b/i,
    )
  })

  it("exposes full-retrieval exceptions", () => {
    const actions = commentActions(async () => {}, TestCanvasError)
    const full = actions.find(({ name }) => name === "list_repository_comments")
    const summaries = actions.find(({ name }) => name === "list_repository_comment_summaries")
    for (const action of [full, summaries]) {
      assert.match(
        action.description,
        /every\s+thread's\s+replies[^.]*read[- ]state\s+filtering[^.]*snapshot[- ]based\s+retrieval/i,
      )
    }
    assert.match(
      full.description,
      /comment\s+overview\b[^.]*prefer\s+list_repository_comment_summaries\b/i,
    )
    assert.match(
      summaries.description,
      /use\s+list_repository_comments\s+when\b[^.]*every\s+thread's\s+replies/i,
    )
  })

  it("keeps summary and snapshot input contracts distinct", () => {
    const actions = commentActions(async () => {}, TestCanvasError)
    const summaries = actions.find(({ name }) => name === "list_repository_comment_summaries")
    const full = actions.find(({ name }) => name === "list_repository_comments")
    assert.equal("read" in summaries.inputSchema.properties, false)
    assert.equal("snapshotId" in summaries.inputSchema.properties, false)
    assert.deepEqual(full.inputSchema.properties.read.enum, ["all", "unread", "read"])
    const snapshotThread = actions.find(({ name }) => name === "get_repository_comment_thread")
    assert.deepEqual(snapshotThread.inputSchema.required, ["target", "threadId", "snapshotId"])
  })

  it("exposes optional improvement filters only on full snapshots and note IDs only on snapshot reads", async () => {
    const calls = []
    const actions = commentActions(async (...args) => calls.push(args), TestCanvasError)
    for (const name of ["list_comments", "list_repository_comments"]) {
      const action = actions.find((item) => item.name === name)
      assert.deepEqual(action.inputSchema.properties.improvementNotes.enum, [
        "exclude",
        "include",
        "only",
      ])
      assert.equal(action.inputSchema.required.includes("improvementNotes"), false)
      await action.handler({ instanceId: "panel", input: { improvementNotes: "only" } })
      assert.deepEqual(calls.at(-1), ["panel", name, { improvementNotes: "only" }])
    }
    for (const name of ["get_comment_thread", "get_repository_comment_thread"]) {
      const action = actions.find((item) => item.name === name)
      const schema = action.inputSchema.properties.threadId
      const variants = schema.anyOf ?? schema.oneOf ?? [schema]
      assert.ok(variants.some((variant) => variant.type === "integer" && variant.minimum === 1))
      assert.ok(
        variants.some(
          (variant) =>
            variant.type === "string" &&
            new RegExp(variant.pattern).test("improvement_note-7") &&
            !new RegExp(variant.pattern).test("improvement_note-0") &&
            !new RegExp(variant.pattern).test("7"),
        ),
      )
    }
    for (const name of [
      "list_repository_comment_summaries",
      "get_repository_thread",
      "mark_comment_read",
      "reply_to_comment",
      "resolve_comment",
    ]) {
      const properties = actions.find((item) => item.name === name).inputSchema.properties
      assert.equal("improvementNotes" in properties, false)
      if ("threadId" in properties)
        assert.deepEqual(properties.threadId, { type: "integer", minimum: 1 })
    }
  })

  it("returns stable errors without exposing arbitrary Hub error text", async () => {
    for (const [error, code] of [
      [{ statusCode: 401 }, "hub_disconnected"],
      [{ statusCode: 403 }, "hub_access_denied"],
      [{ statusCode: 409 }, "comment_conflict"],
      [{ statusCode: 413 }, "comment_response_limit"],
      [{ statusCode: 429 }, "rate_limited"],
      [{ statusCode: 422 }, "invalid_comment_request"],
      [{ code: "stale_comment_target" }, "stale_comment_target"],
      [{ code: "reply_delivery_unknown" }, "reply_delivery_unknown"],
      [{ code: "comment_response_limit", statusCode: 413 }, "comment_response_limit"],
      [{}, "comment_action_failed"],
    ]) {
      const actions = commentActions(async () => {
        throw Object.assign(new Error("sensitive upstream data"), error)
      }, TestCanvasError)
      await assert.rejects(actions[0].handler({ instanceId: "panel" }), (result) => {
        assert.equal(result.code, code)
        assert.equal(result.message.includes("sensitive upstream data"), false)
        return true
      })
    }
  })

  it("explains response size failures without exposing comment content", async () => {
    const actions = commentActions(async () => {
      throw Object.assign(new Error("private comment body"), {
        code: "comment_response_limit",
        statusCode: 413,
      })
    }, TestCanvasError)
    for (const action of actions.filter(({ name }) => /^(list|get)_/.test(name))) {
      await assert.rejects(action.handler({ instanceId: "panel" }), {
        code: "comment_response_limit",
        message:
          "The starting comment, thread root, or next reply exceeds the extension's 64 KiB response budget. Content was not truncated.",
      })
    }
  })

  it("keeps client-owned throttle guidance and never reports an uncertain write", async () => {
    const message = "Too many requests. No changes were made. Wait 60 seconds, then try again."
    const actions = commentActions(async () => {
      throw Object.assign(new Error("unused"), {
        statusCode: 429,
        code: "rate_limited",
        retryAfter: 60,
        rateLimitMessage: message,
      })
    }, TestCanvasError)
    const reply = actions.find(({ name }) => name === "reply_to_comment")
    await assert.rejects(reply.handler({ instanceId: "panel" }), {
      code: "rate_limited",
      message,
    })
  })

  for (const [name, failureMessage, mutationWarning] of [
    ["list_comments", "Could not retrieve comments.", ""],
    ["list_repository_comments", "Could not retrieve repository comments.", ""],
    ["get_comment_thread", "Could not retrieve the comment thread.", ""],
    ["get_repository_comment_thread", "Could not retrieve the repository comment thread.", ""],
    ["list_repository_comment_summaries", "Could not retrieve repository comment summaries.", ""],
    ["get_repository_thread", "Could not retrieve the selected repository thread.", ""],
    [
      "reply_to_comment",
      "Could not complete the reply action.",
      " A reply may have been posted. Preserve its request ID and inspect Hub before deciding what to do.",
    ],
    [
      "mark_comment_read",
      "Could not complete the mark-read action.",
      " The thread may have been marked read. Inspect Hub before deciding what to do.",
    ],
    [
      "resolve_comment",
      "Could not complete the resolution action.",
      " The thread may have been resolved and marked read. Inspect Hub before deciding what to do.",
    ],
  ]) {
    for (const [code, message] of [
      ["comment_action_failed", `${failureMessage}${mutationWarning}`],
      [
        "stale_comment_target",
        `The Hub or checkout target changed. Retrieve comments again.${mutationWarning}`,
      ],
    ]) {
      it(`returns an action-specific ${code} message for ${name}`, async () => {
        const actions = commentActions(async () => {
          throw Object.assign(new Error("sensitive upstream data"), {
            code: code === "stale_comment_target" ? code : "unexpected_upstream_error",
          })
        }, TestCanvasError)
        const action = actions.find((action) => action.name === name)
        await assert.rejects(action.handler({ instanceId: "panel" }), (result) => {
          assert.ok(result instanceof TestCanvasError)
          assert.equal(result.code, code)
          assert.equal(result.message, message)
          assert.equal(result.message.includes("sensitive upstream data"), false)
          return true
        })
      })
    }
  }
})
