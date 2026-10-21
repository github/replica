import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { recoverPrototypeCheck } from "./index.mjs"

async function fixture(test) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replica-check-recovery-"))
  test.after(() => rm(directory, { recursive: true, force: true }))
  const record = {
    runId: randomUUID(),
    ownerPid: 2147483647,
    runner: "command",
    status: "running",
  }
  const owned = path.join(directory, record.runId)
  await mkdir(path.join(owned, "snapshot"), { recursive: true })
  await writeFile(path.join(owned, "snapshot/page.txt"), "Owned snapshot")
  return { directory, record, owned }
}

describe("recoverPrototypeCheck()", () => {
  it("removes only a container with the exact saved ownership label and its scratch directory", async (test) => {
    const { directory, record, owned } = await fixture(test)
    const calls = []
    await recoverPrototypeCheck(record, directory, async (command, args, options) => {
      calls.push({ command, args, options })
      return { stdout: record.runId }
    })
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1].args, ["rm", "--force", `replica-check-${record.runId}`])
    assert.equal(calls[1].options.timeout, 10000)
    await assert.rejects(access(owned), { code: "ENOENT" })
  })
  it("refuses cleanup while the provider is alive", async (test) => {
    const { directory, record, owned } = await fixture(test)
    await assert.rejects(
      recoverPrototypeCheck({ ...record, ownerPid: process.pid }, directory, async () =>
        assert.fail("Must not inspect an active provider's container"),
      ),
      { code: "checks_owner_active" },
    )
    await access(owned)
  })
  it("rejects mismatched and absent ownership labels without removing anything", async (test) => {
    const { directory, record, owned } = await fixture(test)
    for (const label of ["another-run", ""]) {
      let calls = 0
      await assert.rejects(
        recoverPrototypeCheck(record, directory, async () => {
          calls++
          return { stdout: label }
        }),
        /ownership does not match/,
      )
      assert.equal(calls, 1)
      await access(owned)
    }
  })
  it("cleans missing containers but surfaces Docker availability errors", async (test) => {
    const { directory, record, owned } = await fixture(test)
    await assert.rejects(
      recoverPrototypeCheck(record, directory, async () => {
        throw new Error("Docker unavailable")
      }),
      /Docker unavailable/,
    )
    await access(owned)
    await recoverPrototypeCheck(record, directory, async () => {
      throw Object.assign(new Error("Missing"), {
        stderr: "No such container",
      })
    })
    await assert.rejects(access(owned), { code: "ENOENT" })
  })
  it("rejects malformed ownership before resolving any scratch path", async (test) => {
    const { directory, record } = await fixture(test)
    await assert.rejects(
      recoverPrototypeCheck({ ...record, runId: "../unowned" }, directory),
      /ownership is invalid/,
    )
  })
})
