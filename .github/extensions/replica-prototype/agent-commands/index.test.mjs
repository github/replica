import assert from "node:assert/strict"
import { it } from "node:test"

import { agentCommands } from "./index.mjs"

it("delivers queued actions in order and matches each response ID", async () => {
  const commands = agentCommands()
  const result = commands.invoke("inspect")
  const command = commands.next()
  assert.equal(command.type, "inspect")
  assert.equal(commands.next(), null)
  const following = commands.invoke("click")
  assert.equal(commands.next(), null)
  assert.throws(() => commands.complete({ id: "wrong", ok: true }), /No matching/)
  commands.complete({
    id: command.id,
    ok: true,
    value: { addressDraft: "/draft" },
  })
  assert.deepEqual(await result, { addressDraft: "/draft" })
  const click = commands.next()
  assert.equal(click.type, "click")
  commands.complete({ id: click.id, ok: true, value: { clicked: true } })
  assert.deepEqual(await following, { clicked: true })
})

it("rejects failed actions and cancels pending and queued work when the panel closes", async () => {
  const commands = agentCommands()
  const failed = commands.invoke("click")
  const command = commands.next()
  commands.complete({ id: command.id, ok: false, error: "Target hidden." })
  await assert.rejects(failed, /Target hidden/)
  const pending = commands.invoke("inspect")
  const queued = commands.invoke("controls-status")
  const cancelQueued = assert.rejects(queued, /closed or changed/)
  commands.close()
  await assert.rejects(pending, /closed or changed/)
  await cancelQueued
  assert.equal(commands.next(), null)
})

it("allows a bounded readiness wait beyond the ordinary transport timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const commands = agentCommands()
  const result = commands.invoke("controls-status", { timeoutMs: 10000 }, 15000)
  const command = commands.next()
  t.mock.timers.tick(6000)
  commands.complete({ id: command.id, ok: true, value: { status: "ready" } })
  assert.deepEqual(await result, { status: "ready" })
  const timeout = assert.rejects(
    commands.invoke("controls-status", { timeoutMs: 10000 }, 15000),
    /did not respond/,
  )
  t.mock.timers.tick(15000)
  await timeout
})

it("traces the owning renderer, rejects competing replies and reports the last stage on timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] })
  const commands = agentCommands()
  const failure = assert.rejects(
    commands.invoke("controls-status", {}, 5000),
    /last stage: handler started/,
  )
  const command = commands.next("native-renderer")
  assert.equal(commands.next("browser-renderer"), null)
  assert.throws(
    () => commands.progress({ id: command.id, stage: "status collected" }, "browser-renderer"),
    /No matching/,
  )
  commands.progress({ id: command.id, stage: "handler started" }, "native-renderer")
  assert.throws(
    () => commands.complete({ id: command.id, ok: true }, "browser-renderer"),
    /another renderer/,
  )
  t.mock.timers.tick(5000)
  await failure
  assert.deepEqual(commands.diagnostics().requests[0], {
    id: command.id,
    type: "controls-status",
    rendererId: "native-renderer",
    outcome: "timeout",
    stages: [
      { stage: "queued", elapsedMs: 0 },
      { stage: "delivered", elapsedMs: 0 },
      { stage: "handler started", elapsedMs: 0 },
    ],
  })
})

it("bounds diagnostic history and excludes request inputs and reply values", async () => {
  const commands = agentCommands()
  for (let index = 0; index < 25; index++) {
    const result = commands.invoke("inspect", { value: "PRIVATE_INPUT" })
    const command = commands.next("renderer")
    commands.complete({ id: command.id, ok: true, value: "PRIVATE_REPLY" }, "renderer")
    await result
  }
  const diagnostics = commands.diagnostics()
  assert.equal(diagnostics.requests.length, 20)
  assert.ok(!JSON.stringify(diagnostics).includes("PRIVATE"))
  commands.close()
  const result = commands.invoke("controls-status")
  const command = commands.next("reloaded-renderer")
  commands.complete({ id: command.id, ok: true, value: { status: "pending" } }, "reloaded-renderer")
  assert.deepEqual(await result, { status: "pending" })
})
