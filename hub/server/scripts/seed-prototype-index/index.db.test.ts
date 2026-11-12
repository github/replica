import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { getDatabaseUrl } from "../../../test/database/get-database-url"

describe("prototype index seed", () => {
  it("creates coherent example Build metadata and restores it on rerun", async () => {
    const user = await prisma.user.create({ data: {} })
    await prisma.membership.create({ data: { userId: user.id } })
    const script = fileURLToPath(new URL("./index.ts", import.meta.url))
    const run = promisify(execFile)
    function runSeed() {
      return run(process.execPath, [script, user.id], {
        env: {
          ...process.env,
          NODE_ENV: "development",
          DATABASE_URL: getDatabaseUrl(),
          DOTENV_CONFIG_OVERRIDE: "false",
        },
        timeout: 20_000,
      })
    }

    await runSeed()
    const select = {
      id: true,
      number: true,
      state: true,
      workflowCreatedAt: true,
      commitSha: true,
      commitAuthorProvider: true,
      commitAuthorIssuer: true,
      commitAuthorProviderUserId: true,
      commitAuthorLogin: true,
      commitAuthorName: true,
      commitAuthorAvatarUrl: true,
      startedAt: true,
      finishedAt: true,
      failureSummary: true,
    } as const
    const samples = await prisma.build.findMany({ select, orderBy: { id: "asc" } })
    expect(samples).toHaveLength(5)
    expect(samples.map((build) => build.state)).toEqual(
      expect.arrayContaining(["queued", "running", "successful", "failed", "superseded"]),
    )
    for (const build of samples) {
      expect(build.commitSha).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
      expect(build.commitAuthorProvider).toMatch(/\S/)
      expect(build.commitAuthorIssuer).toMatch(/\S/)
      expect(build.commitAuthorProviderUserId).toMatch(/\S/)
      expect(build.commitAuthorLogin).toMatch(/\S/)
      expect(build.commitAuthorName).toMatch(/\S/)
      expect(build.commitAuthorProviderUserId).not.toBe(user.id)
      if (build.state === "queued") {
        expect(build.startedAt).toBeNull()
        expect(build.finishedAt).toBeNull()
      }
      if (build.state === "running") {
        expect(build.startedAt).toBeInstanceOf(Date)
        expect(build.finishedAt).toBeNull()
      }
      if (build.state === "successful" || build.state === "failed") {
        expect(build.startedAt).toBeInstanceOf(Date)
        expect(build.finishedAt).toBeInstanceOf(Date)
      }
      if (build.state === "superseded") {
        expect(build.startedAt).toBeNull()
        expect(build.finishedAt).toBeInstanceOf(Date)
      }
      if (build.workflowCreatedAt && build.startedAt) {
        expect(build.startedAt.getTime()).toBeGreaterThanOrEqual(build.workflowCreatedAt.getTime())
      }
      if (build.startedAt && build.finishedAt) {
        expect(build.finishedAt.getTime()).toBeGreaterThanOrEqual(build.startedAt.getTime())
      }
      if (build.state === "failed") {
        expect(build.failureSummary).toEqual(expect.stringMatching(/\S/))
      } else {
        expect(build.failureSummary).toBeNull()
      }
    }

    for (const build of samples) {
      await prisma.build.update({
        where: { id: build.id },
        data: {
          commitSha: null,
          commitAuthorProvider: "changed-provider",
          commitAuthorIssuer: "https://changed.example.test",
          commitAuthorProviderUserId: "changed-external-id",
          commitAuthorLogin: "changed-login",
          commitAuthorName: "Changed Author",
          commitAuthorAvatarUrl: "https://example.test/changed.png",
          startedAt:
            build.state === "running" || build.state === "successful" || build.state === "failed"
              ? new Date("2000-01-01T00:00:00Z")
              : null,
          finishedAt:
            build.state === "superseded" || build.state === "successful" || build.state === "failed"
              ? new Date("2000-01-01T00:01:00Z")
              : null,
          failureSummary: build.state === "failed" ? "Changed failure" : null,
        },
      })
    }
    await runSeed()
    expect(await prisma.build.findMany({ select, orderBy: { id: "asc" } })).toEqual(samples)
  }, 60_000)
})
