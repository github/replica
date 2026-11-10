import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma/index.ts"

const execute = promisify(execFile)
const scriptPath = fileURLToPath(new URL("./index.ts", import.meta.url))
const repositoryId = "00000000-0000-4000-8000-000000000101"
const welcomeId = "00000000-0000-4000-8000-000000000201"

describe("prototype index seed", () => {
  it("is repeatable and rejects a conflicting sample prototype ID", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.")
    const user = await prisma.user.create({
      data: { membership: { create: { lifecycle: "ACTIVE" } } },
    })
    async function runSeed() {
      return execute(process.execPath, [scriptPath, user.id], {
        env: { ...process.env, NODE_ENV: "development" },
      })
    }

    await runSeed()
    await runSeed()
    const prototypes = await prisma.prototype.findMany({
      where: { repositoryId },
      orderBy: { id: "asc" },
      select: { id: true, name: true, authorId: true },
    })
    expect(prototypes).toEqual([
      { id: welcomeId, name: "Welcome", authorId: user.id },
      {
        id: "00000000-0000-4000-8000-000000000202",
        name: "Navigation",
        authorId: user.id,
      },
    ])

    const conflictingUser = await prisma.user.create({
      data: { membership: { create: { lifecycle: "ACTIVE" } } },
    })
    await prisma.prototype.update({
      where: { id: welcomeId },
      data: { authorId: conflictingUser.id },
    })
    const seedError = await runSeed().then(
      () => {
        throw new Error("The seed accepted a conflicting sample prototype ID.")
      },
      (error: unknown) => error,
    )
    if (
      !(seedError instanceof Error) ||
      !("stderr" in seedError) ||
      typeof seedError.stderr !== "string"
    ) {
      throw new Error("The seed failed without reporting its error.")
    }
    expect(seedError.stderr).toContain("A sample prototype ID is already in use.")
  })
})
