import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { describe, it } from "node:test"

import { withContext } from "../test-support/with-context/index.mjs"
import { writeState } from "../write-state/index.mjs"
import { readState } from "./index.mjs"

describe("readState()", () => {
  it("persists initial state and retains workflow-owned fields without interpreting them", async () => {
    await withContext(async (context) => {
      const initial = await readState(context)
      assert.equal(initial.version, 1)
      assert.equal(initial.publishRequest.state, "idle")
      assert.deepEqual(JSON.parse(await readFile(context.stateFile, "utf8")), initial)
      const state = { version: 1, workflowData: { retained: ["value", null, 2] } }
      await writeState(context, state)
      assert.deepEqual(await readState(context), state)
    })
  })

  it("reports corrupt JSON without replacing the stored file", async () => {
    await withContext(async (context) => {
      await readState(context)
      await writeFile(context.stateFile, "{invalid")
      await assert.rejects(readState(context), (error) => {
        assert.match(error.message, /Stored Replica prototype state is invalid JSON/)
        assert.ok(error.cause instanceof SyntaxError)
        return true
      })
      assert.equal(await readFile(context.stateFile, "utf8"), "{invalid")
    })
  })

  it("rejects unsupported stored formats without overwriting them", async () => {
    await withContext(async (context) => {
      for (const value of [null, [], 1, "state", {}, { version: 2 }, { version: "1" }]) {
        await writeState(context, value)
        await assert.rejects(readState(context), /unsupported format/)
        assert.deepEqual(JSON.parse(await readFile(context.stateFile, "utf8")), value)
      }
    })
  })
})
