import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import { CommandExecutionError } from "../../../installer/command/index.ts"
import type { InstallerUI, RunCommand } from "../../../installer/types.ts"
import type { AzureInstallation, Foundation } from "../types.ts"
import { publishImage } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const foundation: Foundation = {
  vault_id: "/synthetic/vault",
  vault_url: "https://vault.example/",
  registry_id: "/synthetic/registry",
  registry_url: "registry.azurecr.io",
}
const digest = `sha256:${"b".repeat(64)}`
type Select = NonNullable<InstallerUI["select"]>

async function writeDigest(args: string[], value: string) {
  await writeFile(
    args[args.indexOf("--metadata-file") + 1]!,
    JSON.stringify({ "containerimage.digest": value }),
  )
}

async function scenario(build: (args: string[]) => Promise<string>) {
  const directory = resolve(`.replica-image-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory)
  const messages: string[] = []
  const run = vi.fn<RunCommand>(async (executable, args) => {
    if (executable === "git") return args[0] === "rev-parse" ? "a".repeat(40) : ""
    if (executable === "docker") return build(args)
    throw new Error(`Unexpected operation ${executable} ${args.join(" ")}`)
  })
  const azure = vi.fn<AzureInstallation["azure"]>(async () => "{}")
  const context: AzureInstallation = {
    directory,
    config: {
      version: 1,
      cloud: "azure",
      name: "test-hub",
      owner: "test-team",
      azure: {
        subscriptionId: "00000000-0000-0000-0000-000000000001",
        tenantId: "00000000-0000-0000-0000-000000000002",
        location: "eastus2",
        resourceGroup: "test-hub-rg",
      },
    },
    run,
    azure,
    env: {},
    ui: {
      status: (message) => messages.push(message),
      notice: (_level, message) => messages.push(message),
      confirm: vi.fn(async () => true),
      wait: vi.fn(async () => {
        throw new Error("Unexpected wait")
      }),
    },
  }
  return { context, run, azure, messages }
}

it.each([false, true])(
  "fails without a recovery menu or automatic retry with initial deployment approval %s",
  async (preapproved) => {
    const failure = new CommandExecutionError(
      "npm ci failed: ECONNRESET registry.npmjs.org",
      false,
      1,
    )
    const build = vi.fn(async () => {
      throw failure
    })
    const s = await scenario(build)
    if (preapproved)
      s.context.approval = { sourceRevision: "a".repeat(40), sourceStatus: "" }
    s.context.saveNpmRegistry = vi.fn()
    s.context.ui.text = vi.fn()

    await expect(publishImage(s.context, foundation)).rejects.toBe(failure)

    expect(build).toHaveBeenCalledTimes(1)
    expect(s.context.ui.confirm).not.toHaveBeenCalled()
    expect(s.context.ui.text).not.toHaveBeenCalled()
    expect(s.context.saveNpmRegistry).not.toHaveBeenCalled()
    expect(s.context.config.npmRegistry).toBeUndefined()
    expect(await readdir(s.context.directory)).toEqual([])
  },
)

it.each(["persistence", "input"] as const)(
  "offers retry and exit but no proxy edit without %s capability",
  async (missing) => {
    const failure = new CommandExecutionError("npm ci failed: ECONNRESET", false, 1)
    const build = vi.fn(async () => {
      throw failure
    })
    const s = await scenario(build)
    if (missing === "persistence") s.context.ui.text = vi.fn()
    else s.context.saveNpmRegistry = vi.fn()
    s.context.ui.select = vi.fn<Select>(async (message, options) => {
      s.messages.push(message)
      expect(options.map(({ value }) => value)).toEqual(expect.arrayContaining(["retry", "exit"]))
      expect(options.map(({ value }) => value)).not.toContain("registry")
      return "exit"
    })

    await expect(publishImage(s.context, foundation)).rejects.toBe(failure)

    expect(build).toHaveBeenCalledTimes(1)
    expect(s.context.ui.confirm).not.toHaveBeenCalled()
    expect(s.context.config.npmRegistry).toBeUndefined()
    const guidance = s.messages.join("\n")
    expect(guidance).toContain("ECONNRESET")
    expect(guidance).toMatch(/proxy|registry/i)
    expect(guidance).toMatch(/not configured|no.*proxy|default|registry\.npmjs\.org/i)
    expect(guidance).toMatch(/host|local npm/i)
    expect(guidance).toMatch(/inherit/i)
  },
)

it("retries publication with fresh source approval, ACR login, metadata and tag, then returns only the new digest", async () => {
  const attempts: string[][] = []
  const s = await scenario(async (args) => {
    attempts.push(args)
    if (attempts.length === 1) {
      await writeDigest(args, `sha256:${"a".repeat(64)}`)
      throw new CommandExecutionError("Image push failed", false, 1)
    }
    expect(notice.mock.lastCall).toEqual(["info", expect.stringContaining("Retrying image build")])
    await expect(
      readFile(attempts[0]![attempts[0]!.indexOf("--metadata-file") + 1]!, "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" })
    await writeDigest(args, digest)
    return ""
  })
  const notice = vi.fn(s.context.ui.notice)
  s.context.ui.notice = notice
  const run = s.context.run
  s.context.run = async (executable, args, options) => {
    const result = await run(executable, args, options)
    return executable === "git" && args[0] === "status" ? " M Dockerfile" : result
  }
  let recoveries = 0
  s.context.ui.select = vi.fn<Select>(async (_message, options) => {
    expect(options.map(({ value }) => value)).toContain("retry")
    return recoveries++ === 0 ? "retry" : "exit"
  })

  await expect(publishImage(s.context, foundation)).resolves.toBe(
    `${foundation.registry_url}/replica-hub@${digest}`,
  )

  expect(s.run.mock.calls.filter(([executable]) => executable === "git")).toHaveLength(4)
  expect(s.context.ui.confirm).toHaveBeenCalledTimes(2)
  expect(s.azure.mock.calls).toEqual([
    ["acr", "login", "--name", expect.any(String)],
    ["acr", "login", "--name", expect.any(String)],
  ])
  expect(attempts).toHaveLength(2)
  for (const flag of ["--metadata-file", "--tag"]) {
    expect(attempts[0]![attempts[0]!.indexOf(flag) + 1]).not.toBe(
      attempts[1]![attempts[1]!.indexOf(flag) + 1],
    )
  }
  expect(await readdir(s.context.directory)).toEqual([])
})

it.each(["missing", "mutable"] as const)(
  "rejects %s metadata on retry instead of reusing a failed attempt's digest",
  async (metadata) => {
    let attempts = 0
    const s = await scenario(async (args) => {
      attempts++
      if (attempts === 1) {
        await writeDigest(args, digest)
        throw new CommandExecutionError("Image push failed", false, 1)
      }
      if (metadata === "mutable") await writeDigest(args, "latest")
      return ""
    })
    s.context.ui.select = vi.fn(async () => (attempts === 1 ? "retry" : "exit"))

    await expect(publishImage(s.context, foundation)).rejects.toThrow()

    expect(attempts).toBe(2)
    expect(await readdir(s.context.directory)).toEqual([])
  },
)

it.each(["field", "text"] as const)(
  "saves a validated proxy through %s input before using it in a new build",
  async (input) => {
    const registry = "https://packages.example/npm/"
    let saved = false
    let attempts = 0
    const s = await scenario(async (args) => {
      attempts++
      if (attempts === 1) {
        expect(args).not.toContain("--build-arg")
        throw new CommandExecutionError("npm ci failed: ECONNRESET", false, 1)
      }
      expect(saved).toBe(true)
      expect(args).toContain(`NPM_REGISTRY=${registry}`)
      await writeDigest(args, digest)
      return ""
    })
    s.context.saveNpmRegistry = vi.fn(async (value) => {
      expect(value).toBe(registry)
      expect(s.context.config.npmRegistry).toBeUndefined()
      await Promise.resolve()
      saved = true
    })
    if (input === "field") {
      s.context.ui.field = vi.fn<NonNullable<InstallerUI["field"]>>(async (definition) => {
        expect(definition.id).toBe("npmRegistry")
        return "https://packages.example/npm"
      })
    } else {
      const answers = ["http://packages.example/npm", "https://packages.example/npm"]
      s.context.ui.text = vi.fn(async () => answers.shift()!)
    }
    let recoveries = 0
    s.context.ui.select = vi.fn<Select>(async (_message, options) => {
      expect(options.map(({ value }) => value)).toContain("registry")
      return recoveries++ === 0 ? "registry" : "exit"
    })

    await expect(publishImage(s.context, foundation)).resolves.toBe(
      `${foundation.registry_url}/replica-hub@${digest}`,
    )

    expect(s.context.saveNpmRegistry).toHaveBeenCalledExactlyOnceWith(registry)
    expect(s.context.config.npmRegistry).toBe(registry)
    expect(attempts).toBe(2)
    expect(await readdir(s.context.directory)).toEqual([])
  },
)

it("does not rebuild or change runtime configuration when the corrected proxy cannot be saved", async () => {
  const failure = new Error("Synthetic configuration save failure")
  const build = vi.fn(async () => {
    throw new CommandExecutionError("Image push failed", false, 1)
  })
  const s = await scenario(build)
  s.context.config.npmRegistry = "https://old-packages.example/npm/"
  s.context.saveNpmRegistry = vi.fn(async () => {
    throw failure
  })
  s.context.ui.text = vi.fn(async () => "https://new-packages.example/npm/")
  s.context.ui.select = vi.fn<Select>(async (_message, options) => {
    expect(options.map(({ value }) => value)).toContain("registry")
    return "registry"
  })

  await expect(publishImage(s.context, foundation)).rejects.toBe(failure)

  expect(build).toHaveBeenCalledTimes(1)
  expect(s.context.config.npmRegistry).toBe("https://old-packages.example/npm/")
  expect(await readdir(s.context.directory)).toEqual([])
})

it.each([
  { preapproved: false, choice: "retry" },
  { preapproved: true, choice: "retry" },
  { preapproved: true, choice: "registry" },
] as const)(
  "requires fresh dirty-source consent after $choice with initial deployment approval $preapproved",
  async ({ preapproved, choice }) => {
    const build = vi.fn(async () => {
      throw new CommandExecutionError("Image push failed", false, 1)
    })
    const s = await scenario(build)
    let sourceRevision = "a".repeat(40)
    let sourceStatus = " M hub/Dockerfile"
    if (preapproved) s.context.approval = { sourceRevision, sourceStatus }
    if (choice === "registry") {
      s.context.saveNpmRegistry = vi.fn()
      s.context.ui.text = vi.fn(async () => "https://packages.example/npm/")
    }
    const run = s.context.run
    s.context.run = async (executable, args, options) => {
      const result = await run(executable, args, options)
      if (executable !== "git") return result
      return args[0] === "status" ? sourceStatus : sourceRevision
    }
    s.context.ui.confirm = preapproved
      ? vi.fn(async () => false)
      : vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)
    s.context.ui.select = vi.fn<Select>(async (_message, options) => {
      expect(build).toHaveBeenCalledOnce()
      expect(s.context.ui.confirm).toHaveBeenCalledTimes(preapproved ? 0 : 1)
      expect(options.map(({ value }) => value)).toContain(choice)
      sourceRevision = "c".repeat(40)
      sourceStatus = " M hub/server/index.ts"
      return choice
    })

    await expect(publishImage(s.context, foundation)).rejects.toThrow(/cancel|approved source/i)

    expect(build).toHaveBeenCalledTimes(1)
    expect(s.context.ui.confirm).toHaveBeenCalledTimes(preapproved ? 1 : 2)
    expect(s.context.ui.select).toHaveBeenCalledTimes(1)
    expect(s.azure).toHaveBeenCalledTimes(1)
    expect(s.run.mock.calls.filter(([executable]) => executable === "git")).toHaveLength(4)
    expect(await readdir(s.context.directory)).toEqual([])
  },
)

it.each(["revision", "working-tree status"] as const)(
  "stops before registry login or build when the %s changed after initial approval",
  async (changed) => {
    const build = vi.fn(async (args: string[]) => {
      await writeDigest(args, digest)
      return ""
    })
    const s = await scenario(build)
    const sourceRevision = "a".repeat(40)
    const sourceStatus = " M hub/Dockerfile"
    s.context.approval = { sourceRevision, sourceStatus }
    const run = s.context.run
    s.context.run = async (executable, args, options) => {
      const result = await run(executable, args, options)
      if (executable !== "git") return result
      if (args[0] === "rev-parse")
        return changed === "revision" ? "c".repeat(40) : sourceRevision
      return changed === "working-tree status" ? " M hub/server/index.ts" : sourceStatus
    }
    s.context.ui.select = vi.fn(async () => "exit")

    await expect(publishImage(s.context, foundation)).rejects.toMatchObject({ name: "AbortError" })

    expect(s.context.ui.confirm).not.toHaveBeenCalled()
    expect(s.context.ui.select).not.toHaveBeenCalled()
    expect(s.azure).not.toHaveBeenCalled()
    expect(build).not.toHaveBeenCalled()
    expect(await readdir(s.context.directory)).toEqual([])
  },
)

it.each([false, true])(
  "refuses unattended dirty-source publication even with matching deployment approval %s",
  async (preapproved) => {
    const build = vi.fn(async (args: string[]) => {
      await writeDigest(args, digest)
      return ""
    })
    const s = await scenario(build)
    const sourceStatus = " M hub/Dockerfile"
    if (preapproved) s.context.approval = { sourceRevision: "a".repeat(40), sourceStatus }
    const run = s.context.run
    s.context.run = async (executable, args, options) => {
      const result = await run(executable, args, options)
      return executable === "git" && args[0] === "status" ? sourceStatus : result
    }

    await expect(publishImage(s.context, foundation)).rejects.toMatchObject({ name: "AbortError" })

    expect(s.context.ui.confirm).not.toHaveBeenCalled()
    expect(s.azure).not.toHaveBeenCalled()
    expect(build).not.toHaveBeenCalled()
    expect(await readdir(s.context.directory)).toEqual([])
  },
)

it.each(["retry", "cancel"] as const)(
  "shows full error details without another attempt before choosing to %s",
  async (next) => {
    const registry = "https://packages.example/npm/"
    const headline = "Docker build failed (exit code 1)."
    const diagnostic = [
      ...Array.from({ length: 80 }, (_, index) => `Synthetic build output ${index}`),
      "npm ERR! ECONNRESET registry.npmjs.org",
    ].join("\n")
    const failure = new CommandExecutionError(headline, false, 1, diagnostic)
    const details = vi.spyOn(failure, "details")
    const cancelled = new DOMException("Cancelled while inspecting build details", "AbortError")
    let attempts = 0
    const s = await scenario(async (args) => {
      if (++attempts === 1) throw failure
      await writeDigest(args, digest)
      return ""
    })
    s.context.config.npmRegistry = registry
    let detailsRead = false
    s.context.ui.wait = vi.fn(async (message) => {
      expect(message).toContain(diagnostic)
      expect(message).toContain(registry)
      expect(s.run).toHaveBeenCalledTimes(3)
      expect(s.azure).toHaveBeenCalledTimes(1)
      expect(attempts).toBe(1)
      detailsRead = true
      if (next === "cancel") throw cancelled
    })
    let menus = 0
    s.context.ui.select = vi.fn<Select>(async (_message, options) => {
      expect(options.map(({ value }) => value)).toEqual(
        expect.arrayContaining(["details", "retry", "exit"]),
      )
      expect(s.run).toHaveBeenCalledTimes(3)
      expect(s.azure).toHaveBeenCalledTimes(1)
      expect(attempts).toBe(1)
      const notice = s.messages.at(-1)!
      expect(notice).toContain(headline)
      expect(notice).toMatch(/proxy.*configured/i)
      expect(notice).not.toContain("Synthetic build output")
      if (++menus === 1) {
        expect(details).not.toHaveBeenCalled()
        return "details"
      }
      expect(detailsRead).toBe(true)
      return menus === 2 ? "retry" : "exit"
    })

    const publication = publishImage(s.context, foundation)
    if (next === "cancel") {
      await expect(publication).rejects.toBe(cancelled)
      expect(attempts).toBe(1)
      expect(s.context.ui.select).toHaveBeenCalledTimes(1)
    } else {
      await expect(publication).resolves.toBe(`${foundation.registry_url}/replica-hub@${digest}`)
      expect(attempts).toBe(2)
      expect(s.context.ui.select).toHaveBeenCalledTimes(2)
    }
    expect(s.context.ui.wait).toHaveBeenCalledTimes(1)
    expect(details).toHaveBeenCalled()
    expect(await readdir(s.context.directory)).toEqual([])
  },
)

it.each(["build", "ACR login"] as const)(
  "propagates cancellation during %s without offering image recovery",
  async (stage) => {
    const cancelled = new CommandExecutionError("Cancelled", true)
    const build = vi.fn(async () => {
      throw cancelled
    })
    const s = await scenario(build)
    s.context.ui.select = vi.fn()
    if (stage === "ACR login") s.azure.mockRejectedValue(cancelled)

    await expect(publishImage(s.context, foundation)).rejects.toBe(cancelled)

    expect(s.context.ui.select).not.toHaveBeenCalled()
    expect(build).toHaveBeenCalledTimes(stage === "build" ? 1 : 0)
    if (stage === "ACR login") expect(s.context.ui.wait).not.toHaveBeenCalled()
    expect(await readdir(s.context.directory)).toEqual([])
  },
)
