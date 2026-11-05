import { randomUUID } from "node:crypto"
import { readFile, rm } from "node:fs/promises"
import { resolve, join } from "node:path"
import type { AzureInstallation, Foundation } from "../types.ts"
import { installationNames } from "../settings.ts"
import { CommandExecutionError } from "../../../installer/command/index.ts"
import { promptForField } from "../../../installer/prompt-for-field/index.ts"

export async function publishImage(
  context: AzureInstallation,
  foundation: Foundation,
): Promise<string> {
  const { run, azure, config, directory, ui, saveNpmRegistry } = context
  const repository = resolve(import.meta.dirname, "../../../..")
  while (true) {
    const metadata = join(directory, `image-${randomUUID()}.json`)
    let failure: Error
    try {
      const commit = await run("git", ["rev-parse", "HEAD"], { cwd: repository })
      const dirty = await run("git", ["status", "--porcelain", "--untracked-files=normal"], {
        cwd: repository,
      })
      if (
        dirty &&
        !(await ui.confirm(
          "The source checkout has uncommitted changes. Build and publish this working tree?",
        ))
      )
        throw new DOMException(
          "Image publication cancelled; use an approved source checkout.",
          "AbortError",
        )
      await azure("acr", "login", "--name", installationNames(config).registry)
      const tag = `${foundation.registry_url}/replica-hub:${commit.slice(0, 12)}-${randomUUID().slice(0, 8)}`
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
      const result: unknown = JSON.parse(await readFile(metadata, "utf8"))
      const digest =
        typeof result === "object" && result !== null && "containerimage.digest" in result
          ? result["containerimage.digest"]
          : undefined
      if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest))
        throw new Error("Docker did not return an immutable image digest.")
      return `${foundation.registry_url}/replica-hub@${digest}`
    } catch (error) {
      if (
        (error instanceof CommandExecutionError && error.aborted) ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        throw error
      failure = error instanceof Error ? error : new Error("Image publication failed.")
    } finally {
      await rm(metadata, { force: true })
    }
    if (!ui.select) throw failure
    while (true) {
      const headline =
        failure.message.split("\n", 1)[0]?.slice(0, 180) || "Image publication failed."
      const message = `${headline}\nContainer npm proxy: ${config.npmRegistry ? "configured" : "not configured; public npm access is required"}. Docker does not inherit host npm settings.\nRetry affects image publication only, not infrastructure or database work. A previous attempt may already have published a candidate image.`
      if (ui.notice) ui.notice("error", message)
      else ui.status(message)
      const choice = await ui.select("How would you like to recover image publication?", [
        { label: "Retry image build and publication", value: "retry" },
        ...(saveNpmRegistry && (ui.field || ui.text)
          ? [{ label: "Set or change the npm proxy, then retry", value: "registry" }]
          : []),
        { label: "Show full error details", value: "details" },
        { label: "Exit and keep saved progress", value: "exit" },
      ])
      if (choice === "details") {
        await ui.wait(
          `${failure.message}\n\nContainer npm registry: ${config.npmRegistry ?? "not configured; public npm access is required"}.\nCheck the build error, Docker/Buildx, network access, and ACR push permissions. A previous attempt may have published a candidate image.\nScroll to inspect the output, then press Enter to return to recovery choices. This does not retry the build.`,
        )
        continue
      }
      if (choice === "exit") throw failure
      if (choice === "registry" && saveNpmRegistry && (ui.field || ui.text)) {
        const registry = await promptForField(ui, "npmRegistry", config.npmRegistry)
        await saveNpmRegistry(registry)
        config.npmRegistry = registry
        ui.status("Saved the npm proxy for this installation. Retrying image publication.")
      } else if (choice !== "retry") {
        throw new Error("Choose a supported image recovery action.")
      }
      if (ui.notice) ui.notice("info", "Retrying image build and publication.")
      else ui.status("Retrying image build and publication.")
      break
    }
  }
}
