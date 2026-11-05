import { randomUUID } from "node:crypto"
import { readFile, rm } from "node:fs/promises"
import { resolve, join } from "node:path"
import type { AzureInstallation, Foundation } from "../types.ts"
import { installationNames } from "../settings.ts"

export async function publishImage(
  context: AzureInstallation,
  foundation: Foundation,
): Promise<string> {
  const { run, azure, config, directory, ui } = context
  const repository = resolve(import.meta.dirname, "../../../..")
  const commit = await run("git", ["rev-parse", "HEAD"], { cwd: repository })
  const dirty = await run("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: repository,
  })
  if (
    dirty &&
    !(await ui.confirm(
      "The source checkout has uncommitted changes. Build and publish this working tree?",
    ))
  ) {
    throw new Error("Image publication cancelled; use an approved source checkout.")
  }
  while (true) {
    try {
      await azure("acr", "login", "--name", installationNames(config).registry)
      break
    } catch {
      await ui.wait(
        "ACR login is not ready. Check AcrPush permission, Docker, registry network access, and RBAC propagation, then continue to retry.",
      )
    }
  }
  const metadata = join(directory, `image-${randomUUID()}.json`)
  const tag = `${foundation.registry_url}/replica-hub:${commit.slice(0, 12)}-${randomUUID().slice(0, 8)}`
  try {
    await run("docker", [
      "buildx",
      "build",
      "--platform",
      "linux/amd64",
      "--tag",
      tag,
      "--metadata-file",
      metadata,
      "--push",
      ...(config.npmRegistry ? ["--build-arg", `NPM_REGISTRY=${config.npmRegistry}`] : []),
      join(repository, "hub"),
    ])
    const result = JSON.parse(await readFile(metadata, "utf8")) as Record<string, unknown>
    const digest = result["containerimage.digest"]
    if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
      throw new Error("Docker did not return an immutable image digest.")
    }
    return `${foundation.registry_url}/replica-hub@${digest}`
  } finally {
    await rm(metadata, { force: true })
  }
}
