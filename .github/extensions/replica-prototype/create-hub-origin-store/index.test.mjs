import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { InvalidHubOrigin } from "../invalid-hub-origin/index.mjs"
import { createHubOriginStore } from "./index.mjs"

describe("createHubOriginStore()", () => {
  it("keeps saved and stored origins strict outside manual selection", async () => {
    const directory = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    const store = createHubOriginStore({ directory })
    const repository = "github/replica"
    const origin = "https://hub.example.com"
    try {
      await store.save(repository, origin)
      const file = path.join(directory, (await readdir(directory))[0])
      const saved = await readFile(file, "utf8")
      for (const value of [
        `${origin}/repositories/123`,
        `${origin}/?tab=builds`,
        `${origin}/#latest`,
      ]) {
        await assert.rejects(store.save(repository, value), InvalidHubOrigin)
        assert.equal(await store.read(repository), origin)
        assert.equal(await readFile(file, "utf8"), saved)
        await writeFile(file, JSON.stringify({ repository, origin: value }))
        await assert.rejects(store.read(repository), InvalidHubOrigin)
        await writeFile(file, saved)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
