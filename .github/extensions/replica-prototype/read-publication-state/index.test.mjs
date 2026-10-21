import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { getPrototypeState } from "../get-prototype-state/index.mjs"
import { readState } from "../read-state/index.mjs"
import { withContext } from "../test-support/with-context/index.mjs"
import { writeState } from "../write-state/index.mjs"
import { readPublicationState } from "./index.mjs"

describe("readPublicationState()", () => {
  it("preserves legacy requests and unrelated saved fields without inventing target data", async () => {
    await withContext(async (context) => {
      const state = await readState(context)
      state.publishRequest = {
        state: "requested",
        requestedAt: new Date().toISOString(),
        commitSha: context.target.commitSha,
        remoteState: "unknown",
        futureRequestField: { retained: true },
      }
      state.futureStateField = ["retained"]
      state.stats.workflow.futureWorkflowField = 42
      await writeState(context, state)

      assert.deepEqual(await readPublicationState(context), state)
      const presented = await getPrototypeState(context)
      assert.equal(presented.publishRequest.state, "requested")
      assert.equal(presented.publishRequest.target, undefined)
      assert.equal(presented.publishRequest.mode, undefined)
      assert.deepEqual(await readState(context), state)
    })
  })

  for (const [label, corrupt] of [
    ["request state", (state) => (state.publishRequest.state = "published")],
    ["request timestamp", (state) => (state.publishRequest.requestedAt = {})],
    ["request target", (state) => (state.publishRequest.target = { branch: "prototype" })],
    ["workflow evidence", (state) => (state.stats.workflow.run = "successful")],
    ["remote evidence", (state) => (state.stats.remoteBranch = { state: false })],
  ]) {
    it(`rejects invalid stored ${label} without overwriting the original state`, async () => {
      await withContext(async (context) => {
        const state = await readState(context)
        corrupt(state)
        await writeState(context, state)

        await assert.rejects(getPrototypeState(context, { refresh: true }), /publication state/)
        assert.deepEqual(await readState(context), state)
      })
    })
  }
})
