import { randomUUID } from "node:crypto"
import {
  chmod,
  link,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import type { AzureInstallation } from "../../install/types.ts"
import { installationNames } from "../../install/settings.ts"
import { postSetupProgress } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function scenario() {
  const directory = resolve(`.post-progress-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { mode: 0o700 })
  const config: AzureInstallation["config"] = {
    version: 1,
    cloud: "azure",
    name: "sample-hub",
    owner: "sample-team",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: "sample-hub-rg",
    },
  }
  const names = installationNames(config)
  const reference = {
    key_vault_id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}/providers/Microsoft.KeyVault/vaults/${names.vault}`,
    secret_id: `https://${names.vault}.vault.azure.net/secrets/github-client-secret/${"a".repeat(32)}`,
  }
  const ui = { status: vi.fn(), notice: vi.fn(), confirm: vi.fn(), wait: vi.fn() }
  return { context: { directory, config, ui }, reference }
}

it("persists only validated public answers, credential paths and versioned references in a private file", async () => {
  const test = await scenario()
  const progress = await postSetupProgress(test.context, "github")
  const path = join(test.context.directory, "client secret")
  await progress.saveAnswer("github_app_id", "123")
  await progress.saveAnswer("github_client_id", "Iv23synthetic")
  await progress.saveAnswer("GITHUB_CLIENT_SECRET_FILE", path)
  await progress.saveReference("GITHUB_CLIENT_SECRET", test.reference)
  const saved = await readFile(progress.path, "utf8")
  const invalid = "invalid-public-input-for-tests"
  const secret = "synthetic-secret-never-to-persist"

  await expect(progress.saveAnswer("github_app_id", invalid)).rejects.toThrow()
  await expect(progress.saveAnswer("clientSecret", secret)).rejects.toThrow()
  await expect(progress.saveAnswer("consent", "true")).rejects.toThrow()

  expect(await readFile(progress.path, "utf8")).toBe(saved)
  expect(saved).not.toContain(invalid)
  expect(saved).not.toContain(secret)
  expect((await stat(progress.path)).mode & 0o777).toBe(0o600)
  expect((await stat(progress.path)).uid).toBe(process.getuid?.())
  expect((await stat(test.context.directory)).mode & 0o777).toBe(0o700)
  const resumed = await postSetupProgress(test.context, "github")
  expect(resumed.answers).toEqual({
    github_app_id: "123",
    github_client_id: "Iv23synthetic",
    GITHUB_CLIENT_SECRET_FILE: path,
  })
  expect(resumed.references).toEqual({ GITHUB_CLIENT_SECRET: test.reference })
  expect(test.context.ui.notice).not.toHaveBeenCalled()
})

it("isolates actions and refuses to reuse another installation's saved answers", async () => {
  const test = await scenario()
  const github = await postSetupProgress(test.context, "github")
  await github.saveAnswer("github_app_id", "123")
  const saved = await readFile(github.path, "utf8")
  const signIn = await postSetupProgress(test.context, "sign-in")

  expect(signIn.hasSaved).toBe(false)
  expect(signIn.answers).toEqual({})
  await signIn.saveAnswer("origin", "https://sample.example.com")
  await signIn.saveAnswer("proxyHops", "2")
  expect((await postSetupProgress(test.context, "github")).answers).toEqual({
    github_app_id: "123",
  })
  await expect(
    postSetupProgress(
      { ...test.context, config: { ...test.context.config, owner: "another-team" } },
      "github",
    ),
  ).rejects.toThrow(/another installation|invalid/i)
  expect(await readFile(github.path, "utf8")).toBe(saved)
})

it("rejects an overlong origin without overwriting a valid saved answer", async () => {
  const test = await scenario()
  const progress = await postSetupProgress(test.context, "sign-in")
  const maximum = `https://${"a".repeat(492)}`
  await progress.saveAnswer("origin", maximum)
  const saved = await readFile(progress.path, "utf8")

  await expect(progress.saveAnswer("origin", `${maximum}a`)).rejects.toThrow(/invalid/i)

  expect(await readFile(progress.path, "utf8")).toBe(saved)
  expect((await postSetupProgress(test.context, "sign-in")).answers.origin).toBe(maximum)
})

it("preserves previously saved overlong origins for manual recovery", async () => {
  const test = await scenario()
  const progress = await postSetupProgress(test.context, "sign-in")
  await progress.saveAnswer("origin", "https://sample.example.com")
  const record = JSON.parse(await readFile(progress.path, "utf8"))
  record.answers.origin = `https://${"a".repeat(493)}`
  const saved = JSON.stringify(record)
  await writeFile(progress.path, saved)

  await expect(postSetupProgress(test.context, "sign-in")).rejects.toThrow(/invalid/i)

  expect(await readFile(progress.path, "utf8")).toBe(saved)
})

it.each(["malformed JSON", "wrong action", "unexpected secret field"] as const)(
  "preserves and rejects %s without printing its contents",
  async (damage) => {
    const test = await scenario()
    const progress = await postSetupProgress(test.context, "github")
    await progress.saveAnswer("github_app_id", "123")
    const record = JSON.parse(await readFile(progress.path, "utf8")) as Record<string, unknown>
    const secret = "synthetic-private-damaged-evidence"
    const content =
      damage === "malformed JSON"
        ? `{"broken":"${secret}"`
        : JSON.stringify(
            damage === "wrong action"
              ? { ...record, action: "sign-in" }
              : { ...record, clientSecret: secret },
          )
    await writeFile(progress.path, content)

    const failure: unknown = await postSetupProgress(test.context, "github").catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).not.toContain(secret)
    expect(await readFile(progress.path, "utf8")).toBe(content)
    expect(test.context.ui.notice).not.toHaveBeenCalled()
  },
)

it("refuses a concurrent writer and changed desired inputs without overwriting saved progress", async () => {
  const test = await scenario()
  const inputs = { image: `registry.azurecr.io/hub@sha256:${"a".repeat(64)}`, deploy_hub: true }
  const first = await postSetupProgress(test.context, "github", inputs)
  const stale = await postSetupProgress(test.context, "github", inputs)
  await first.saveAnswer("github_app_id", "123")
  const saved = await readFile(first.path, "utf8")

  await expect(stale.saveAnswer("github_app_id", "456")).rejects.toThrow(/another process|changed/i)
  await expect(
    postSetupProgress(test.context, "github", { ...inputs, deploy_hub: false }),
  ).rejects.toThrow(/inputs changed|inputs.*review/i)
  expect(await readFile(first.path, "utf8")).toBe(saved)
})

it("rejects foreign-vault and unversioned references before recording a successful upload", async () => {
  const test = await scenario()
  const progress = await postSetupProgress(test.context, "github")
  await progress.saveAnswer("github_app_id", "123")
  const saved = await readFile(progress.path, "utf8")
  const foreign = {
    key_vault_id: test.reference.key_vault_id.replace(
      test.context.config.azure.subscriptionId,
      "00000000-0000-0000-0000-000000000099",
    ),
    secret_id: test.reference.secret_id,
  }

  await expect(progress.saveReference("GITHUB_CLIENT_SECRET", foreign)).rejects.toThrow()
  await expect(
    progress.saveReference("GITHUB_CLIENT_SECRET", {
      ...test.reference,
      secret_id: test.reference.secret_id.slice(0, -33),
    }),
  ).rejects.toThrow()
  expect(await readFile(progress.path, "utf8")).toBe(saved)
})

it("retains confirmed uploads and unresolved writes when starting over, then completes without retaining prompts", async () => {
  const test = await scenario()
  const progress = await postSetupProgress(test.context, "github")
  await progress.saveAnswer("github_app_id", "123")
  await progress.pendingUpload("GITHUB_CLIENT_SECRET")
  expect((await postSetupProgress(test.context, "github")).pending).toBe("GITHUB_CLIENT_SECRET")
  await progress.saveReference("GITHUB_CLIENT_SECRET", test.reference)
  expect(progress.pending).toBeUndefined()
  await progress.pendingUpload("GITHUB_APP_PRIVATE_KEY_BASE64")

  await progress.startOver()

  const restarted = await postSetupProgress(test.context, "github")
  expect(restarted.answers).toEqual({})
  expect(restarted.references).toEqual({ GITHUB_CLIENT_SECRET: test.reference })
  expect(restarted.pending).toBe("GITHUB_APP_PRIVATE_KEY_BASE64")
  await restarted.saveReference("GITHUB_APP_PRIVATE_KEY_BASE64", {
    ...test.reference,
    secret_id: test.reference.secret_id.replace("github-client-secret", "github-app-private-key"),
  })
  await restarted.finish()
  expect(JSON.parse(await readFile(progress.path, "utf8"))).toMatchObject({
    complete: true,
    answers: {},
  })
  expect((await postSetupProgress(test.context, "github")).hasSaved).toBe(false)
})

it("preserves an unresolved upload when another credential is requested, but permits reconciling the same credential", async () => {
  const test = await scenario()
  const progress = await postSetupProgress(test.context, "github")
  await progress.pendingUpload("GITHUB_APP_PRIVATE_KEY_BASE64")
  await progress.startOver()
  const saved = await readFile(progress.path, "utf8")

  await expect(progress.pendingUpload("GITHUB_CLIENT_SECRET")).rejects.toThrow(/unknown outcome/i)
  await expect(progress.finish()).rejects.toThrow(/unknown outcome/i)

  expect(await readFile(progress.path, "utf8")).toBe(saved)
  expect((await postSetupProgress(test.context, "github")).pending).toBe(
    "GITHUB_APP_PRIVATE_KEY_BASE64",
  )
  await progress.pendingUpload("GITHUB_APP_PRIVATE_KEY_BASE64")
  await progress.saveReference("GITHUB_APP_PRIVATE_KEY_BASE64", {
    ...test.reference,
    secret_id: test.reference.secret_id.replace("github-client-secret", "github-app-private-key"),
  })
  expect((await postSetupProgress(test.context, "github")).pending).toBeUndefined()
})

it.each(["shared file", "shared directory", "symbolic link", "hard link"] as const)(
  "rejects a progress location with a %s without changing it",
  async (unsafe) => {
    const test = await scenario()
    const progress = await postSetupProgress(test.context, "github")
    await progress.saveAnswer("github_app_id", "123")
    const saved = await readFile(progress.path, "utf8")
    if (unsafe === "shared file") await chmod(progress.path, 0o644)
    if (unsafe === "shared directory") await chmod(test.context.directory, 0o755)
    if (unsafe === "symbolic link") {
      await rename(progress.path, `${progress.path}.original`)
      await symlink(`${progress.path}.original`, progress.path)
    }
    if (unsafe === "hard link") await link(progress.path, `${progress.path}.other`)

    await expect(postSetupProgress(test.context, "github")).rejects.toThrow(/private|regular/i)

    expect(await readFile(progress.path, "utf8")).toBe(saved)
    if (unsafe === "shared file") expect((await stat(progress.path)).mode & 0o777).toBe(0o644)
    if (unsafe === "shared directory")
      expect((await stat(test.context.directory)).mode & 0o777).toBe(0o755)
  },
)
