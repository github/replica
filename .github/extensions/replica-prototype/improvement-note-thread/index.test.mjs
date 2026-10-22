import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { it } from "node:test"

import { checkThread } from "./index.mjs"

it("accepts complete current conversations without a message or serialized-history cap", () => {
  const localId = randomUUID()
  const thread = {
    originalStatus: "sent",
    messages: Array.from({ length: 101 }, () => ({
      id: randomUUID(),
      role: "author",
      body: "x".repeat(400),
      status: "open",
    })),
  }
  assert.doesNotThrow(() => checkThread(thread, localId))
})

it("rejects unknown duplicate and forward answer references", () => {
  const localId = randomUUID()
  const followup = {
    id: randomUUID(),
    role: "author",
    body: "Follow up",
    status: "open",
  }
  const answer = {
    id: randomUUID(),
    role: "copilot",
    body: "Done",
    status: "ready",
    requestIds: [localId],
  }
  for (const messages of [
    [{ ...answer, requestIds: [randomUUID()] }],
    [{ ...answer, requestIds: [localId, localId] }],
    [{ ...answer, requestIds: [followup.id] }, followup],
  ])
    assert.throws(() => checkThread({ originalStatus: "open", messages }, localId))
})

it("measures human bodies in UTF-8 bytes and Copilot answers in UTF-16 units", () => {
  const localId = randomUUID()
  const human = {
    id: randomUUID(),
    role: "author",
    body: "é".repeat(5000),
    status: "open",
  }
  const answer = {
    id: randomUUID(),
    role: "copilot",
    body: "😀".repeat(1000),
    status: "ready",
    requestIds: [localId],
  }
  const thread = { originalStatus: "open", messages: [human, answer] }
  assert.doesNotThrow(() => checkThread(thread, localId))
  human.body += "é"
  assert.throws(() => checkThread(thread, localId))
  human.body = "Follow up"
  answer.body += "x"
  assert.throws(() => checkThread(thread, localId))
})
