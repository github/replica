import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import path from "node:path"
import { it } from "node:test"

import { createPrivateStore } from "../private-store/index.mjs"
import { createHubClient } from "./index.mjs"

it("rejects malformed stored credentials before using a repository connection", async () => {
  const directory = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
  const origin = "https://hub.example.com"
  const repository = "github/replica"
  const file = `${createHash("sha256").update(`${origin}\n${repository}`).digest("hex")}.json`
  const store = createPrivateStore(directory)
  const client = createHubClient({ repositoryPath: directory }, { origin, directory })
  const credential = {
    repository,
    origin,
    token: "fixture-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
  try {
    for (const value of [
      true,
      "fixture-token",
      [],
      {},
      { ...credential, repository: "github/other" },
      { ...credential, origin: "https://other.example.com" },
      { ...credential, token: 42 },
      { ...credential, expiresAt: "not a date" },
      { ...credential, refreshToken: {} },
      { ...credential, connectionId: {} },
      { ...credential, retryAfter: "tomorrow" },
      { ...credential, retryStatus: {} },
    ]) {
      await store.write(file, value)
      await assert.rejects(client.connectionKey(repository), /Invalid stored canvas credentials/)
    }
    await store.write(file, credential)
    assert.equal(
      await client.connectionKey(repository),
      createHash("sha256").update(credential.token).digest("hex"),
    )
    await store.write(file, { ...credential, connectionId: 42 })
    assert.equal(
      await client.connectionKey(repository),
      createHash("sha256").update("42").digest("hex"),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
