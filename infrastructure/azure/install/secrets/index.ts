import { randomBytes } from "node:crypto"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import type { AzureInstallation, Foundation } from "../types.ts"
import { writePrivateFile } from "../../../installer/private-files/index.ts"

export async function installationSecrets(context: AzureInstallation, foundation: Foundation) {
  const { azure, directory, config, ui } = context
  const vault = new URL(foundation.vault_url).hostname.split(".")[0]!
  const list = async () =>
    JSON.parse(await azure("keyvault", "secret", "list", "--vault-name", vault)) as {
      name: string
    }[]
  let known: { name: string }[]
  while (true) {
    try {
      known = await list()
      break
    } catch {
      await ui.wait(
        "Key Vault access is not ready. Check Key Vault Secrets Officer permission, network access, and RBAC propagation, then continue to retry.",
      )
    }
  }
  const names = new Set(known.map(({ name }) => name))
  const read = async (name: string) => {
    const result = JSON.parse(
      await azure("keyvault", "secret", "show", "--vault-name", vault, "--name", name),
    ) as { value: string; id: string }
    return result
  }
  const put = async (name: string, value: string) => {
    const file = join(directory, `secret-${randomBytes(8).toString("hex")}`)
    try {
      await writePrivateFile(file, value)
      const result = JSON.parse(
        await azure(
          "keyvault",
          "secret",
          "set",
          "--vault-name",
          vault,
          "--name",
          name,
          "--file",
          file,
          "--encoding",
          "utf-8",
        ),
      ) as { id: string }
      names.add(name)
      return result.id
    } finally {
      await rm(file, { force: true })
    }
  }
  const ensure = async (name: string, create: () => string) => {
    if (!names.has(name)) await put(name, create())
    return read(name)
  }
  const password = () => `${randomBytes(32).toString("base64url")}Aa1!`
  const admin = await ensure("postgres-admin-password", password)
  const migration = await ensure("postgres-migration-password", password)
  const runtime = await ensure("postgres-runtime-password", password)
  const host = `${config.name}-postgres.postgres.database.azure.com`
  const url = (role: string, password: string) =>
    `postgresql://${role}:${encodeURIComponent(password)}@${host}:5432/replica?sslmode=verify-full`
  const adminUrl = await ensure("postgres-admin-url", () => url("replicaadmin", admin.value))
  const migrationUrl = await ensure("postgres-migration-url", () =>
    url("replica_migration", migration.value),
  )
  const runtimeUrl = await ensure("postgres-runtime-url", () =>
    url("replica_runtime", runtime.value),
  )
  return {
    adminPassword: admin.value,
    migrationUrl: migrationUrl.id,
    runtimeUrl: runtimeUrl.id,
    provisioning: {
      DATABASE_URL: adminUrl.id,
      HUB_MIGRATION_PASSWORD: migration.id,
      HUB_RUNTIME_PASSWORD: runtime.id,
    },
    async provisioned() {
      return (
        names.has("database-provisioned") &&
        (await read("database-provisioned")).value === config.azure.resourceGroup
      )
    },
    async markProvisioned() {
      await put("database-provisioned", config.azure.resourceGroup)
    },
  }
}
