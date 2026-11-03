import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it, onTestFinished } from "vitest"

import { artifactMaxBytes, createArtifactStorage } from "."

describe("createArtifactStorage()", () => {
  it("publishes complete immutable bytes and explicitly reports missing reads and deletes", async () => {
    const directory = resolve(`server/domains/artifacts/.storage-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const storage = await createArtifactStorage({ provider: "filesystem", directory })
    const first = Uint8Array.from([0, 255, 7])
    const second = Uint8Array.from([9, 8])

    const results = await Promise.all([
      storage.write("opaque-key", first),
      storage.write("opaque-key", second),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["already-exists", "ok"])
    const result = await storage.read("opaque-key")
    expect(result.status).toBe("ok")
    if (result.status !== "ok") throw new Error("Expected saved bytes.")
    expect(Array.from(result.bytes)).toEqual(
      Array.from(results[0]?.status === "ok" ? first : second),
    )
    expect(await storage.delete("opaque-key")).toEqual({ status: "ok" })
    expect(await storage.read("opaque-key")).toEqual({ status: "not-found" })
    expect(await storage.delete("opaque-key")).toEqual({ status: "not-found" })
    expect(await storage.write("empty", new Uint8Array())).toEqual({ status: "ok" })
    expect(await storage.read("empty")).toEqual({ status: "ok", bytes: new Uint8Array() })
  })

  it("rejects traversal and encoded path keys before touching storage", async () => {
    const directory = resolve(`server/domains/artifacts/.storage-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const storage = await createArtifactStorage({ provider: "filesystem", directory })

    for (const key of [
      "",
      "../outside",
      "/absolute",
      "a/b",
      "a\\b",
      "%2e%2e",
      ".",
      "a\0",
      "x".repeat(129),
    ]) {
      expect(await storage.write(key, new Uint8Array())).toEqual({ status: "invalid-key" })
      expect(await storage.read(key)).toEqual({ status: "invalid-key" })
      expect(await storage.delete(key)).toEqual({ status: "invalid-key" })
    }
  })

  it("refuses symlink leaves and directories without reading or changing the target", async () => {
    const directory = resolve(`server/domains/artifacts/.storage-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    await mkdir(`${directory}/root`)
    await writeFile(`${directory}/outside`, "private")
    await symlink(`${directory}/outside`, `${directory}/root/key`)
    const storage = await createArtifactStorage({
      provider: "filesystem",
      directory: `${directory}/root`,
    })

    expect(await storage.read("key")).toEqual({ status: "unavailable" })
    expect(await storage.write("key", Uint8Array.of(1))).toEqual({ status: "already-exists" })
    expect(await storage.delete("key")).toEqual({ status: "unavailable" })
    expect(await readFile(`${directory}/outside`, "utf8")).toBe("private")
    await symlink(`${directory}/root`, `${directory}/alias`)
    await expect(
      createArtifactStorage({ provider: "filesystem", directory: `${directory}/alias` }),
    ).rejects.toThrow("Artifact directory is unavailable.")
    await expect(
      createArtifactStorage({ provider: "filesystem", directory: `${directory}/alias/nested` }),
    ).rejects.toThrow("Artifact directory is unavailable.")
    await rm(`${directory}/root`, { recursive: true })
    await mkdir(`${directory}/other`)
    await writeFile(`${directory}/other/key`, "private")
    await symlink(`${directory}/other`, `${directory}/root`)
    expect(await storage.read("key")).toEqual({ status: "unavailable" })
    expect(await storage.write("key", Uint8Array.of(1))).toEqual({ status: "unavailable" })
    expect(await storage.delete("key")).toEqual({ status: "unavailable" })
    expect(await readFile(`${directory}/other/key`, "utf8")).toBe("private")
  })

  it("bounds write and read bytes while accepting the exact limit", async () => {
    const directory = resolve(`server/domains/artifacts/.storage-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const storage = await createArtifactStorage({ provider: "filesystem", directory })

    expect(await storage.write("limit", new Uint8Array(artifactMaxBytes))).toEqual({ status: "ok" })
    const result = await storage.read("limit")
    expect(result.status).toBe("ok")
    if (result.status === "ok") expect(result.bytes.length).toBe(artifactMaxBytes)
    expect(await storage.write("large", new Uint8Array(artifactMaxBytes + 1))).toEqual({
      status: "too-large",
    })
    await writeFile(`${directory}/large`, new Uint8Array(artifactMaxBytes + 1))
    expect(await storage.read("large")).toEqual({ status: "too-large" })
  })

  it("fails safely when the configured filesystem directory disappears", async () => {
    const directory = resolve(`server/domains/artifacts/.storage-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const storage = await createArtifactStorage({ provider: "filesystem", directory })
    await rm(directory, { recursive: true })

    expect(await storage.read("key")).toEqual({ status: "unavailable" })
    expect(await storage.write("key", Uint8Array.of(1))).toEqual({ status: "unavailable" })
    expect(await storage.delete("key")).toEqual({ status: "unavailable" })
  })
})
