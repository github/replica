import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { designer } from "../conformance/index.mjs"
import { createRecurrenceConsolidator } from "../src/consolidators/recurrence.mjs"
import { labelComments } from "../src/labeling.mjs"
import { createInMemoryProvider } from "../src/providers/in-memory.mjs"
import { createLearningStore } from "../src/store.mjs"

const SCOPE = { repository: "acme/checkout-prototypes" }
const COPILOT = { scope: SCOPE, principal: { kind: "agent", id: "agent:copilot" } }
const WINDOW = { from: "2026-10-01T00:00:00.000000Z", to: "2026-10-09T12:00:00.000000Z" }

describe("agent sessions", () => {
  it("stores a session's messages without tool output or secrets", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review"],
      sources: ["agent_session"],
      basis: "The team agreed to learn from agent sessions.",
    })
    const token = `ghp_${"a".repeat(36)}`

    const result = await store.importAgentSession(
      COPILOT,
      {
        sessionId: "session-one",
        task: "Build the checkout form.",
        user: "github:ana-designer",
        messages: [
          { role: "user", text: `Use my token ${token} to fetch the data.` },
          { role: "tool", text: "cat .env" },
          { role: "agent", text: "x".repeat(12_000) },
        ],
        outcome: { status: "success", summary: "The form is done." },
      },
      { grantIds: [grant.id] },
    )

    assert.deepEqual([result.addedEpisodes, result.addedEvents, result.skippedMessages], [1, 3, 1])
    const { episodes, events } = await store.queryObservations(designer(), { purpose: "review" })
    assert.deepEqual(episodes[0].source, { kind: "agent_session", sessionId: "session-one" })
    assert.equal(episodes[0].task.prompt, "Build the checkout form.")
    assert.deepEqual(
      events.map((event) => event.type),
      ["user_message", "agent_message", "session_outcome"],
    )
    assert.equal(events[0].payload.text, "Use my token [redacted secret] to fetch the data.")
    assert.equal(events[0].actor.id, "github:ana-designer")
    assert.equal(events[1].payload.text.length, 10_000)
    assert.equal(events[1].actor.id, "agent:copilot")
  })

  it("updates a session sent again without rewriting earlier messages", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review"],
      sources: ["agent_session"],
      basis: "The team agreed to learn from agent sessions.",
    })
    const first = {
      sessionId: "session-one",
      messages: [
        { role: "user", text: "Make the buttons bigger." },
        { role: "agent", text: "Done." },
      ],
      outcome: { status: "partial" },
    }
    await store.importAgentSession(COPILOT, first, { grantIds: [grant.id] })
    const before = await store.queryObservations(designer(), { purpose: "review" })

    const again = await store.importAgentSession(COPILOT, first, { grantIds: [grant.id] })
    const updated = await store.importAgentSession(
      COPILOT,
      {
        sessionId: "session-one",
        messages: [
          { role: "user", text: "Make the buttons bigger." },
          { role: "agent", text: "Done. They are 48 pixels tall now." },
          { role: "user", text: "Thanks." },
        ],
        outcome: { status: "success" },
      },
      { grantIds: [grant.id] },
    )

    assert.deepEqual([again.addedEpisodes, again.addedEvents], [0, 0])
    assert.deepEqual([updated.addedEpisodes, updated.addedEvents], [0, 3])
    const { episodes, events } = await store.queryObservations(designer(), { purpose: "review" })
    assert.equal(episodes.length, 1)
    for (const original of before.events)
      assert.deepEqual(
        events.find((event) => event.id === original.id),
        original,
      )
    const [agentEdit, outcome] = [
      events.find((event) => event.payload.text === "Done. They are 48 pixels tall now."),
      events.find((event) => event.payload.status === "success"),
    ]
    assert.equal(agentEdit.supersedes, before.events[1].id)
    assert.equal(outcome.supersedes, before.events[2].id)
  })

  it("refuses a session sent again with a different task and stores nothing", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review"],
      sources: ["agent_session"],
      basis: "The team agreed to learn from agent sessions.",
    })
    const messages = [{ role: "user", text: "Make the buttons bigger." }]
    await store.importAgentSession(
      COPILOT,
      { sessionId: "session-one", task: "Build the checkout form.", messages },
      { grantIds: [grant.id] },
    )
    const before = await store.queryObservations(designer(), { purpose: "review" })

    await assert.rejects(
      store.importAgentSession(
        COPILOT,
        {
          sessionId: "session-one",
          task: "Build the settings page.",
          messages: [...messages, { role: "user", text: "Add a dark theme." }],
        },
        { grantIds: [grant.id] },
      ),
      { code: "conflict" },
    )
    assert.deepEqual(await store.queryObservations(designer(), { purpose: "review" }), before)
  })

  it("removes every version of a session message when a person asks", async () => {
    const provider = createInMemoryProvider()
    const store = await createLearningStore({
      provider,
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review"],
      sources: ["agent_session"],
      basis: "The team agreed to learn from agent sessions.",
    })
    await store.importAgentSession(
      COPILOT,
      {
        sessionId: "session-one",
        messages: [
          { role: "user", text: "My password is hunter2." },
          { role: "agent", text: "I will not store it." },
        ],
      },
      { grantIds: [grant.id] },
    )
    await store.importAgentSession(
      COPILOT,
      {
        sessionId: "session-one",
        messages: [
          { role: "user", text: "My password is hunter2, please use it." },
          { role: "agent", text: "I will not store it." },
        ],
      },
      { grantIds: [grant.id] },
    )
    const { events } = await store.queryObservations(designer(), { purpose: "review" })
    const latest = events.find((event) => event.payload.text.endsWith("please use it."))

    await store.redactComment(designer(), latest.id, { reason: "The user shared a password." })

    const after = await store.queryObservations(designer(), { purpose: "review" })
    assert.deepEqual(
      after.events.map((event) => event.payload.text),
      ["I will not store it."],
    )
    const stored = await provider.readRecords("events", { scope: SCOPE })
    assert.equal(JSON.stringify(stored).includes("hunter2"), false)
    assert.equal((await store.verify(designer())).ok, true)
  })

  it("refuses a session without a grant that names agent sessions", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review"],
      sources: ["hub_review_comments"],
      basis: "The team agreed to learn from review comments only.",
    })

    await assert.rejects(
      store.importAgentSession(
        COPILOT,
        { sessionId: "session-one", messages: [{ role: "user", text: "Hi." }] },
        { grantIds: [grant.id] },
      ),
      { code: "purpose_not_granted", message: /does not name agent_session/ },
    )
  })

  it("proposes a theme one person raised in two agent sessions", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["agent_session"],
      basis: "The team agreed to learn from agent sessions.",
    })
    for (const sessionId of ["session-one", "session-two"])
      await store.importAgentSession(
        COPILOT,
        {
          sessionId,
          user: "github:ana-designer",
          messages: [
            {
              role: "user",
              text: "The field labels disappear when I type.",
              at: "2026-10-05T12:00:00Z",
            },
            { role: "agent", text: "I moved each label above its field." },
          ],
        },
        { grantIds: [grant.id] },
      )
    const asked = []
    const labeler = {
      manifest: { id: "fixture", name: "Fixture", version: "test" },
      async label(request) {
        const comments = request.threads.flatMap((thread) => thread.comments)
        asked.push(...comments.map((comment) => comment.text))
        return {
          labels: comments.map((comment) => ({
            comment: comment.id,
            theme: {
              key: "visible-form-labels",
              statement: "Show a visible label above every field.",
            },
            signal: "accessibility",
            observation: "observed",
            stance: "supports",
          })),
        }
      },
    }

    await labelComments(store, COPILOT, { labeler })
    const run = await store.consolidate(COPILOT, {
      consolidator: createRecurrenceConsolidator(),
      window: WINDOW,
    })

    assert.deepEqual(asked, [
      "The field labels disappear when I type.",
      "The field labels disappear when I type.",
    ])
    assert.equal(run.proposals.length, 1)
    assert.equal(run.proposals[0].themeKey, "visible-form-labels")
    assert.deepEqual(run.proposals[0].support, {
      distinctEpisodes: 2,
      distinctPrototypes: 2,
      distinctReviewers: 1,
      distinctBuilds: 2,
    })
  })
})
