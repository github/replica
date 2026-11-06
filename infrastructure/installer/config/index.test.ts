import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { DeploymentConfig } from "../types.ts"
import { loadConfig, parseConfig, saveConfig } from "./index.ts"

function configuration(): DeploymentConfig {
  return {
    version: 1,
    cloud: "azure",
    name: "replica-hub",
    owner: "platform-team",
    azure: {
      subscriptionId: "11111111-2222-4333-8444-555555555555",
      tenantId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      location: "eastus",
      resourceGroup: "replica-hub",
    },
  }
}

const directories: string[] = []

async function configDirectory() {
  const directory = path.resolve(`.installer-config-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe("deployment configuration", () => {
  it("accepts reusable Azure configuration with or without an HTTPS npm proxy", () => {
    const config = configuration()
    expect(parseConfig(config)).toEqual(config)

    config.npmRegistry = "https://packages.example.com/npm/"
    expect(parseConfig(config)).toEqual(config)
  })

  it.each(["version", "cloud", "name", "owner", "azure"] as const)(
    "rejects a configuration without %s",
    (field) => {
      const config: Record<string, unknown> = { ...configuration() }
      delete config[field]
      expect(() => parseConfig(config)).toThrow()
    },
  )

  it.each(["subscriptionId", "tenantId", "location", "resourceGroup"] as const)(
    "requires an explicit Azure %s",
    (field) => {
      const config = configuration()
      const azure: Record<string, unknown> = { ...config.azure }
      delete azure[field]
      expect(() => parseConfig({ ...config, azure })).toThrow()
    },
  )

  it.each([
    null,
    [],
    "configuration",
    { ...configuration(), version: 2 },
    { ...configuration(), cloud: "aws" },
  ])("rejects unsupported configuration shape, version, or cloud: %j", (config) => {
    expect(() => parseConfig(config)).toThrow()
  })

  it.each(["subscriptionId", "tenantId"] as const)("rejects an invalid %s", (field) => {
    const config = configuration()
    config.azure[field] = "not-a-uuid"
    expect(() => parseConfig(config)).toThrow()
  })

  it("normalizes Azure UUIDs to lowercase before saving or reloading configuration", async () => {
    const directory = await configDirectory()
    const filename = path.join(directory, "config.json")
    const expected = configuration()
    expected.azure.subscriptionId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
    const mixed = {
      ...expected,
      azure: {
        ...expected.azure,
        subscriptionId: expected.azure.subscriptionId.toUpperCase(),
        tenantId: expected.azure.tenantId.toUpperCase(),
      },
    }

    expect(parseConfig(mixed)).toEqual(expected)
    await saveConfig(filename, mixed)

    expect(JSON.parse(await readFile(filename, "utf8"))).toEqual(expected)
    expect(await loadConfig(filename)).toEqual(expected)
  })

  it.each(["subscriptionId", "tenantId"] as const)(
    "rejects trailing UUID whitespace in %s rather than accepting a different target representation",
    (field) => {
      const config = configuration()
      config.azure[field] += "\n"
      expect(() => parseConfig(config)).toThrow()
    },
  )

  it("normalizes legacy version 1 state access configuration without retaining the retired field", () => {
    const config = configuration()
    const legacy = { ...config, azure: { ...config.azure, stateAllowedIp: "192.0.2.0/24" } }

    expect(parseConfig(legacy)).toEqual(config)
  })

  it.each(["name", "owner"] as const)("rejects an empty %s", (field) => {
    const config = configuration()
    config[field] = ""
    expect(() => parseConfig(config)).toThrow()
  })

  it.each([
    "../other",
    "hub/other",
    "--help",
    "-hub",
    "hub name",
    "hub;echo",
    "hub",
    "a".repeat(21),
    "Hub-name",
    "1hub",
    "hub-",
    "hub--name",
  ])("rejects unsafe installation name %j", (name) => {
    expect(() => parseConfig({ ...configuration(), name })).toThrow()
  })

  it.each(["h123", "a".repeat(20), "hub-name1"])(
    "accepts installation name boundary %j",
    (name) => {
      expect(parseConfig({ ...configuration(), name }).name).toBe(name)
    },
  )

  it.each(["password", "token", "extra"])(
    "rejects unknown top-level field %s instead of persisting it",
    (field) => {
      expect(() =>
        parseConfig({ ...configuration(), [field]: "synthetic-private-value" }),
      ).toThrow()
    },
  )

  it.each(["clientSecret", "extra"])("rejects unknown Azure field %s", (field) => {
    const config = configuration()
    expect(() =>
      parseConfig({ ...config, azure: { ...config.azure, [field]: "synthetic-private-value" } }),
    ).toThrow()
  })

  it.each([
    "http://packages.example.com/npm/",
    "https://user:password@packages.example.com/npm/",
    "https://user@packages.example.com/npm/",
    "https://packages.example.com/npm/?token=synthetic-private-value",
    "https://packages.example.com/npm/#synthetic-private-value",
    "not-a-url",
  ])("rejects an unsafe npm proxy URL %j", (npmRegistry) => {
    expect(() => parseConfig({ ...configuration(), npmRegistry })).toThrow()
  })

  it("saves and reloads only the non-secret configuration with private file permissions", async () => {
    const directory = await configDirectory()
    const filename = path.join(directory, "config.json")
    const config = configuration()
    config.npmRegistry = "https://packages.example.com/npm/"

    await saveConfig(filename, config)

    expect(JSON.parse(await readFile(filename, "utf8"))).toEqual(config)
    expect(await loadConfig(filename)).toEqual(config)
    expect((await stat(filename)).mode & 0o777).toBe(0o600)
    expect(await readdir(directory)).toEqual(["config.json"])
  })

  it("loads and privately rewrites a legacy config without restoring the retired state IP", async () => {
    const directory = await configDirectory()
    const filename = path.join(directory, "config.json")
    const config = configuration()
    await writeFile(
      filename,
      JSON.stringify({ ...config, azure: { ...config.azure, stateAllowedIp: "192.0.2.1" } }),
      { mode: 0o600 },
    )

    const loaded = await loadConfig(filename)
    await saveConfig(filename, loaded)

    expect(loaded).toEqual(config)
    expect(JSON.parse(await readFile(filename, "utf8"))).toEqual(config)
    expect((await stat(filename)).mode & 0o777).toBe(0o600)
  })

  it("atomically replaces a configuration while existing readers retain the prior contents", async () => {
    const directory = await configDirectory()
    const filename = path.join(directory, "config.json")
    const previous = JSON.stringify(configuration())
    await writeFile(filename, previous, { mode: 0o644 })
    const existingReader = await open(filename, "r")
    const replacement = { ...configuration(), owner: "new-team" }

    try {
      await saveConfig(filename, replacement)

      expect(await existingReader.readFile("utf8")).toBe(previous)
      expect(await loadConfig(filename)).toEqual(replacement)
      expect((await stat(filename)).mode & 0o777).toBe(0o600)
      expect(await readdir(directory)).toEqual(["config.json"])
    } finally {
      await existingReader.close()
    }
  })

  it("preserves the prior file byte for byte when replacement validation fails", async () => {
    const directory = await configDirectory()
    const filename = path.join(directory, "config.json")
    const previous = `${JSON.stringify(configuration(), null, 2)}\n`
    await writeFile(filename, previous, { mode: 0o600 })
    const invalid = { ...configuration(), token: "synthetic-private-value" }

    await expect(saveConfig(filename, invalid)).rejects.toThrow()

    expect(await readFile(filename, "utf8")).toBe(previous)
    expect((await stat(filename)).mode & 0o777).toBe(0o600)
    expect(await readdir(directory)).toEqual(["config.json"])
  })

  it("fails explicitly rather than returning defaults for invalid JSON", async () => {
    const directory = await configDirectory()
    const filename = path.join(directory, "config.json")
    await writeFile(filename, '{"version":')

    await expect(loadConfig(filename)).rejects.toThrow()
  })

  it("validates loaded JSON instead of trusting a hand-edited config file", async () => {
    const directory = await configDirectory()
    const filename = path.join(directory, "config.json")
    await writeFile(
      filename,
      JSON.stringify({ ...configuration(), password: "synthetic-private-value" }),
    )

    await expect(loadConfig(filename)).rejects.toThrow()
  })
})
