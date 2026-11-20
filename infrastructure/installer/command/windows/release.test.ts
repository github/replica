import childProcess from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { inspect } from "node:util"
import { afterEach, describe, expect, it, vi } from "vitest"

import { deployHub } from "../../../azure/deploy-hub/index.ts"

const directories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== "win32")("native Windows synchronous Hub release commands", () => {
  it.each(["bootstrap", "release"])(
    "resolves the official Azure launcher during %s without exposing private command errors",
    async (operation) => {
      const root = resolve(`.installer-release-test-${randomUUID()}`)
      directories.push(root)
      const bin = join(root, "Azure CLI", "wbin")
      await mkdir(bin, { recursive: true })
      await writeFile(join(bin, "az.cmd"), "")
      const python = resolve(bin, "..", "python.exe")
      await writeFile(python, "")
      const pathKeys = Object.keys(process.env).filter((key) => key.toLowerCase() === "path")
      for (const key of pathKeys.length ? pathKeys : ["PATH"]) vi.stubEnv(key, bin)
      vi.stubEnv("TF_DATA_DIR", join(root, "terraform"))
      vi.stubEnv("AZ_INSTALLER", "previous")
      vi.stubEnv("REPLICA_RELEASE_TEST", "retained")
      const subscription = "synthetic-subscription & %PATH% $(injected)"
      const diagnostic = "synthetic-private-command-output"
      const execute = vi
        .spyOn(childProcess, "execFileSync")
        .mockReturnValueOnce("")
        .mockImplementation(() => {
          throw Object.assign(new Error(diagnostic), {
            status: 7,
            stdout: diagnostic,
            stderr: diagnostic,
          })
        })

      const failure = await deployHub([
        operation,
        "--subscription",
        subscription,
        "--backend",
        join(root, "backend.conf"),
        "--variables",
        join(root, "variables.json"),
        "--image",
        `example.azurecr.io/hub@sha256:${"a".repeat(64)}`,
        ...(operation === "release" ? ["--accept-maintenance"] : []),
      ]).catch((error: unknown) => error)

      expect(execute.mock.calls[0]![0]).toBe("terraform")
      expect(execute.mock.calls[1]).toEqual([
        python,
        [
          "-IBm",
          "azure.cli",
          "account",
          "show",
          "--subscription",
          subscription,
          "--only-show-errors",
          "--output",
          "json",
        ],
        expect.objectContaining({
          env: expect.objectContaining({ AZ_INSTALLER: "MSI", REPLICA_RELEASE_TEST: "retained" }),
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
        }),
      ])
      expect(failure).toBeInstanceOf(Error)
      expect(inspect(failure, { showHidden: true, depth: 10 })).not.toContain(diagnostic)
      expect(inspect(failure, { showHidden: true, depth: 10 })).not.toContain(subscription)
      expect(JSON.stringify(failure)).not.toContain(diagnostic)
      expect(process.env.AZ_INSTALLER).toBe("previous")
    },
  )
})
