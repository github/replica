import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

import { recoverPrototypeCheck } from "./index.mjs"

const root = fileURLToPath(new URL(".", import.meta.url))

async function fixture(test) {
  const directory = await mkdtemp(path.join(root, ".recovery-test-"))
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
  it("cleans only the owned scratch directory without executing tools or killing a saved PID", async (test) => {
    const { directory, record, owned } = await fixture(test)
    const sibling = path.join(directory, randomUUID())
    await mkdir(sibling)
    await writeFile(path.join(sibling, "keep.txt"), "Another run")
    const kill = process.kill
    const signals = []
    test.mock.method(process, "kill", (pid, signal) => {
      signals.push({ pid, signal })
      assert.equal(signal, 0)
      return kill(pid, signal)
    })
    await recoverPrototypeCheck(record, directory)
    assert.deepEqual(signals, [{ pid: record.ownerPid, signal: 0 }])
    await assert.rejects(access(owned), { code: "ENOENT" })
    assert.equal(await readFile(path.join(sibling, "keep.txt"), "utf8"), "Another run")
    await assert.doesNotReject(recoverPrototypeCheck(record, directory))
  })
  it("refuses cleanup while the provider is alive", async (test) => {
    const { directory, record, owned } = await fixture(test)
    await assert.rejects(recoverPrototypeCheck({ ...record, ownerPid: process.pid }, directory), {
      code: "checks_owner_active",
    })
    await access(owned)
  })
  it("rejects malformed ownership before resolving any scratch path", async (test) => {
    const { directory, record } = await fixture(test)
    await assert.rejects(
      recoverPrototypeCheck({ ...record, runId: "../unowned" }, directory),
      /ownership is invalid/,
    )
  })
})
