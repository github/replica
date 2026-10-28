import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { describe, it } from "node:test"

import { withContext } from "../test-support/with-context/index.mjs"
import { requestPrototypeCreation } from "./index.mjs"

function catalog() {
  return {
    templates: [
      { id: "default", name: "Default", route: "/" },
      { id: "welcome", name: "Welcome", route: "/settings?q=1#details" },
    ],
    promptInstructions: "Build an interactive prototype in this repository.",
    templatePageInstructions: "Use the template at %{route}.",
    templateLandingPageInstructions: "Set startPage to %{route}.",
    copy: {},
  }
}

function brief() {
  return {
    brief: "Make account settings easier to use.",
    details: {
      change: "Group settings",
      audience: "Administrators",
      outcome: "Find options",
    },
    templateId: "welcome",
  }
}

describe("requestPrototypeCreation()", () => {
  it("sends the selected Hub template and brief to the current conversation", async () => {
    await withContext(async (context) => {
      const messages = []
      const requests = []
      const hub = {
        request: async (route) => {
          requests.push(route)
          return catalog()
        },
      }
      const input = { ...brief(), templateRoute: "/untrusted-renderer-route" }
      const result = await requestPrototypeCreation(
        context,
        { send: async (message) => messages.push(message) },
        hub,
        input,
      )

      assert.deepEqual(result, { requested: true })
      assert.deepEqual(requests, ["/api/canvas/templates"])
      assert.equal(messages.length, 1)
      assert.ok(messages[0].prompt.includes(input.brief))
      for (const value of Object.values(input.details))
        assert.ok(messages[0].prompt.includes(value))
      assert.ok(
        messages[0].prompt.includes("/settings?q=1#details") ||
          messages[0].prompt.includes(encodeURIComponent("/settings?q=1#details")),
      )
      assert.doesNotMatch(messages[0].prompt, /untrusted-renderer-route/)
    })
  })

  it("rejects invalid briefs and details before requesting Hub or sending chat", async () => {
    await withContext(async (context) => {
      let calls = 0
      const session = { send: async () => calls++ }
      const hub = { request: async () => (calls++, catalog()) }
      for (const input of [
        { ...brief(), brief: " \n " },
        { ...brief(), brief: "x".repeat(12_001) },
        {
          ...brief(),
          details: { ...brief().details, change: "x".repeat(4_001) },
        },
        { ...brief(), details: { ...brief().details, audience: {} } },
      ])
        await assert.rejects(requestPrototypeCreation(context, session, hub, input), {
          statusCode: 422,
        })
      assert.equal(calls, 0)
      assert.deepEqual(
        await requestPrototypeCreation(context, session, hub, {
          ...brief(),
          brief: "x".repeat(12_000),
          details: { change: "x".repeat(4_000), audience: "", outcome: "" },
        }),
        { requested: true },
      )
      assert.equal(calls, 2)
    })
  })

  it("requires an available authoritative Hub catalog rather than local or stale templates", async () => {
    await withContext(async (context) => {
      const messages = []
      const session = { send: async (message) => messages.push(message) }
      await assert.rejects(requestPrototypeCreation(context, session, null, brief()), {
        statusCode: 409,
      })
      await assert.rejects(
        requestPrototypeCreation(
          context,
          session,
          {
            request: async () => {
              throw new Error("Hub unavailable")
            },
          },
          brief(),
        ),
        /Hub unavailable/,
      )
      await assert.rejects(
        requestPrototypeCreation(
          context,
          session,
          {
            request: async () => ({
              ...catalog(),
              templates: [catalog().templates[0]],
            }),
          },
          brief(),
        ),
        { statusCode: 409 },
      )
      assert.equal(messages.length, 0)
      await requestPrototypeCreation(context, session, { request: async () => catalog() }, brief())
      assert.equal(messages.length, 1)
    })
  })

  it("suppresses overlapping and repeated submissions but permits retry after failed chat delivery", async () => {
    await withContext(async (context) => {
      let release
      let entered
      const sending = new Promise((resolve) => (entered = resolve))
      const blocked = new Promise((resolve) => (release = resolve))
      let calls = 0
      const session = {
        send: async () => {
          calls += 1
          entered()
          await blocked
          throw new Error("Chat unavailable")
        },
      }
      const hub = { request: async () => catalog() }
      const first = requestPrototypeCreation(context, session, hub, brief())
      const failure = assert.rejects(first, /Chat unavailable/)
      await sending
      const duplicate = requestPrototypeCreation(context, session, hub, brief())
      const duplicateOutcome = Promise.allSettled([duplicate])
      release()
      await failure
      await duplicateOutcome
      assert.equal(calls, 1)
      session.send = async () => calls++
      await requestPrototypeCreation(context, session, hub, brief())
      await requestPrototypeCreation(context, session, hub, brief())
      assert.equal(calls, 2)
      await requestPrototypeCreation(context, session, hub, {
        ...brief(),
        brief: "A different goal",
      })
      assert.equal(calls, 3)
    })
  })

  it("does not send a request when the checkout changes while templates load", async () => {
    await withContext(async (context) => {
      let calls = 0
      const hub = {
        request: async () => {
          execFileSync("git", ["checkout", "-qb", "feature/another-task"], {
            cwd: context.repositoryPath,
          })
          return catalog()
        },
      }
      await assert.rejects(
        requestPrototypeCreation(context, { send: async () => calls++ }, hub, brief()),
        /checkout/,
      )
      assert.equal(calls, 0)
    })
  })
})
