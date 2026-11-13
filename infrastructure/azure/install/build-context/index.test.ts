import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { afterEach, expect, it } from "vitest"

import { createBuildSnapshot } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(import.meta.dirname, ".build-context-test-"))
  directories.push(root)
  const source = join(root, "source")
  const parent = join(root, "snapshots")
  await mkdir(parent)
  const ignore = await readFile(
    resolve(import.meta.dirname, "../../../../hub/Dockerfile.dockerignore"),
    "utf8",
  )
  const included = {
    "hub/Dockerfile": "FROM scratch\nCOPY hub/ /app/\nCOPY packages/learning/ /learning/\n",
    "hub/Dockerfile.dockerignore": ignore,
    "hub/.env.example": "DOCUMENTED=value\n",
    "hub/package.json": '{"name":"synthetic-hub"}\n',
    "hub/server/feature.ts": "export const feature = true\n",
    "hub/bin/start": "#!/bin/sh\nexit 0\n",
    "packages/learning/package.json": '{"name":"synthetic-learning"}\n',
    "packages/learning/package-lock.json": '{"lockfileVersion":3}\n',
    "packages/learning/.npmrc": "engine-strict=true\n",
    "packages/learning/index.mjs": 'export * from "./src/feature.mjs"\n',
    "packages/learning/index.d.mts": "export declare const feature: boolean\n",
    "packages/learning/bin/replica-learning.mjs": "#!/usr/bin/env node\n",
    "packages/learning/src/feature.mjs": "export const feature = true\n",
    "packages/learning/contracts/v1/input.json": '{"type":"object"}\n',
  }
  const excluded = [
    ".env",
    "node_modules/dependency.js",
    "infrastructure/.local/installation.json",
    "starter/unrelated.ts",
    "packages/other/index.mjs",
    "packages/learning/.env",
    "packages/learning/node_modules/dependency.js",
    "packages/learning/private-store/memory.json",
    "packages/learning/README.md",
    "hub/.env",
    "hub/.env.production",
    "hub/.local/state.json",
    "hub/.react-router/types/routes.ts",
    "hub/storage/private.json",
    "hub/node_modules/dependency.js",
    "hub/server/feature.test.ts",
    "hub/app/stories.tsx",
  ]
  const files = {
    ...included,
    ...Object.fromEntries(excluded.map((path) => [path, "synthetic excluded contents\n"])),
    ".dockerignore": "hub\npackages\n",
  }
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(source, path)), { recursive: true })
    await writeFile(join(source, path), content)
  }
  await chmod(join(source, "hub/bin/start"), 0o755)
  await chmod(join(source, "hub/server"), 0o750)
  return { source, parent, included, excluded }
}

it("copies private root-context inputs using Dockerfile-specific exclusions and preserves an independent source copy", async () => {
  const { source, parent, included, excluded } = await fixture()
  const snapshot = await createBuildSnapshot(source, parent)
  try {
    for (const [path, content] of Object.entries(included))
      await expect(readFile(join(snapshot.directory, path), "utf8")).resolves.toBe(content)
    for (const path of excluded)
      await expect(readFile(join(snapshot.directory, path))).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readdir(snapshot.directory)).toEqual(["hub", "packages"])
    expect((await stat(snapshot.directory)).mode & 0o077).toBe(0)
    expect((await stat(join(snapshot.directory, "hub/bin/start"))).mode & 0o777).toBe(0o755)
    expect((await stat(join(snapshot.directory, "hub/server"))).mode & 0o777).toBe(0o750)

    await writeFile(join(source, "hub/server/feature.ts"), "changed original Hub source\n")
    await writeFile(join(source, "packages/learning/src/feature.mjs"), "changed original learning\n")
    await chmod(join(source, "hub/bin/start"), 0o644)
    for (const path of ["hub/server/feature.ts", "packages/learning/src/feature.mjs"] as const)
      await expect(readFile(join(snapshot.directory, path), "utf8")).resolves.toBe(included[path])
    expect((await stat(join(snapshot.directory, "hub/bin/start"))).mode & 0o777).toBe(0o755)
  } finally {
    await snapshot.cleanup()
  }
  expect(await readdir(parent)).toEqual([])
})

it("fingerprints Hub and selected learning contents but ignores excluded changes", async () => {
  const { source, parent, excluded } = await fixture()
  const first = await createBuildSnapshot(source, parent)
  await first.cleanup()
  for (const path of excluded)
    await writeFile(join(source, path), "changed synthetic excluded contents\n")
  const unchanged = await createBuildSnapshot(source, parent)
  try {
    expect(unchanged.fingerprint).toBe(first.fingerprint)
  } finally {
    await unchanged.cleanup()
  }

  let fingerprint = first.fingerprint
  for (const path of ["hub/server/feature.ts", "packages/learning/src/feature.mjs"]) {
    await writeFile(join(source, path), "changed included source\n")
    const changed = await createBuildSnapshot(source, parent)
    try {
      expect(changed.fingerprint).not.toBe(fingerprint)
      fingerprint = changed.fingerprint
    } finally {
      await changed.cleanup()
    }
  }
  expect(await readdir(parent)).toEqual([])
})

it.each(["cancellation", "error"] as const)("removes incomplete snapshots after %s", async (failure) => {
  const { source, parent } = await fixture()
  const controller = new AbortController()
  const cancelled = new DOMException("Synthetic cancellation", "AbortError")
  if (failure === "cancellation") controller.abort(cancelled)
  else await rm(join(source, "hub/Dockerfile.dockerignore"))

  const snapshot = createBuildSnapshot(source, parent, controller.signal)
  if (failure === "cancellation") await expect(snapshot).rejects.toBe(cancelled)
  else await expect(snapshot).rejects.toThrow()
  expect(await readdir(parent)).toEqual([])
})
