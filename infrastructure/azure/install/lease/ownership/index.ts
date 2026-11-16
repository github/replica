import { createHash } from "node:crypto"
import { join } from "node:path"
import { readPrivateFile, writePrivateFile } from "../../../../installer/private-files/index.ts"
import type { AzureInstallation } from "../../types.ts"

export async function leaseOwnership(
  context: Pick<AzureInstallation, "config" | "directory">,
  account: string,
  container: string,
  blob: string,
) {
  const target = JSON.stringify([context.config, account, container, blob])
  const key = createHash("sha256").update(target).digest("hex")
  const path = join(context.directory, `lease-${key}.json`)
  let original = await readPrivateFile(path, { createDirectory: false })
  let lease: string | undefined
  if (original !== undefined) {
    let value: unknown
    try {
      value = JSON.parse(original)
    } catch {
      throw new Error("Private lease ownership evidence is invalid; it was preserved.")
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !("version" in value) ||
      value.version !== 1 ||
      !("target" in value) ||
      value.target !== target ||
      !("lease" in value) ||
      typeof value.lease !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.lease)
    )
      throw new Error(
        "Private lease ownership evidence does not match this target; it was preserved.",
      )
    lease = value.lease
  }
  return {
    get lease() {
      return lease
    },
    async save(id: string) {
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
        throw new Error("Cannot save an invalid lease ownership identity.")
      if ((await readPrivateFile(path, { createDirectory: false })) !== original)
        throw new Error("Private lease ownership evidence changed. Recovery stopped.")
      const content = JSON.stringify({ version: 1, target, lease: id })
      await writePrivateFile(path, content, {
        exclusive: original === undefined,
      })
      original = content
      lease = id
    },
  }
}
