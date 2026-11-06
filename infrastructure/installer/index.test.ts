import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { expect, it } from "vitest"

it("keeps synthetic command diagnostics out of unattended CLI output and local telemetry", async () => {
  const directory = resolve(`.installer-cli-test-${randomUUID()}`)
  const bin = join(directory, "bin")
  await mkdir(bin, { recursive: true, mode: 0o700 })
  const configPath = join(directory, "installation.json")
  const secret = "synthetic-unattended-stderr-secret"
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      cloud: "azure",
      name: "test-hub",
      owner: "platform-team",
      azure: {
        subscriptionId: "00000000-0000-0000-0000-000000000001",
        tenantId: "00000000-0000-0000-0000-000000000002",
        location: "eastus2",
        resourceGroup: "test-hub-rg",
      },
    }),
    { mode: 0o600 },
  )
  for (const [executable, program] of [
    ["az", `process.stderr.write(${JSON.stringify(secret)}, () => process.exit(37))`],
    ["terraform", 'process.stdout.write(JSON.stringify({ terraform_version: "1.17.1" }))'],
    ["docker", "process.exit(0)"],
  ])
    await writeFile(join(bin, executable!), `#!${process.execPath}\n${program}\n`, {
      mode: 0o700,
    })

  try {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "installer/index.tsx",
        "--config",
        configPath,
        "--non-interactive",
        "--approve-deployment",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${bin}:${dirname(process.execPath)}` },
        encoding: "utf8",
        timeout: 15_000,
      },
    )

    expect(child.error).toBeUndefined()
    expect(child.status).not.toBe(0)
    expect(child.signal).toBeNull()
    const output = `${child.stdout}\n${child.stderr}`
    expect(output).toMatch(/Azure|failed|prerequisite/i)
    expect(output).not.toContain(secret)
    const logs = join(directory, "logs")
    const files = await readdir(logs)
    expect(files.length).toBeGreaterThan(0)
    const telemetry = (
      await Promise.all(files.map((filename) => readFile(join(logs, filename), "utf8")))
    ).join("\n")
    expect(telemetry).not.toContain(secret)
    const records = telemetry.trim().split("\n").map((line) => JSON.parse(line) as {
      event: string
      status?: string
      attributes?: { exit_code?: number }
    })
    expect(records).toContainEqual(expect.objectContaining({
      event: "span.completed",
      status: "error",
      attributes: expect.objectContaining({ exit_code: 37 }),
    }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
