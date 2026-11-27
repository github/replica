import { randomBytes, randomUUID } from "node:crypto"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"

import { writePrivateFile } from "../../../../installer/private-files/index.ts"

export interface StateTarget {
  account: string
  container: string
  key: string
}

interface Snapshot {
  lineage: string
  serial: number
}

function readSnapshot(value: unknown): Snapshot | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const { version, lineage, serial } = value as Record<string, unknown>
  return version === 4 && typeof lineage === "string" && /^[0-9a-f-]{36}$/.test(lineage) &&
      typeof serial === "number" && Number.isSafeInteger(serial) && serial >= 0
    ? { lineage, serial }
    : undefined
}

/*
 * Terraform's AzureRM backend writes an empty state blob, without a create-only condition and
 * before it takes its lease, whenever the key is missing. A deleted state would then be silently
 * replaced and the next plan would ignore every existing reader resource. This guard fixes the
 * expected lineage before Terraform opens the key and stops when Terraform reports any other.
 */
export async function guardPreviewState({
  azure,
  directory,
  target,
  resourcesExist,
}: {
  azure(...args: string[]): Promise<string>
  directory: string
  target: StateTarget
  resourcesExist(): Promise<boolean>
}) {
  const blob = [
    "--account-name", target.account, "--container-name", target.container, "--name", target.key,
    "--auth-mode", "login",
  ]
  const block = (reason: string): never => {
    throw new Error(
      `Private preview state blocked: ${reason} Terraform was not run. Review ${target.account}/${target.container}/${target.key} and restore it from a blob version before retrying.`,
    )
  }
  const download = async () => {
    const file = join(directory, `preview-state-${randomBytes(8).toString("hex")}.json`)
    try {
      await azure("storage", "blob", "download", ...blob, "--file", file)
      let parsed: unknown
      try {
        parsed = JSON.parse(await readFile(file, "utf8"))
      } catch {
        parsed = undefined
      }
      return readSnapshot(parsed) ?? block("the saved state is not a Terraform state snapshot.")
    } finally {
      await rm(file, { force: true })
    }
  }
  const { exists } = JSON.parse(await azure("storage", "blob", "exists", ...blob)) as {
    exists?: unknown
  }
  if (typeof exists !== "boolean") return block("Azure did not confirm whether saved state exists.")
  let expected: Snapshot
  if (exists) {
    expected = await download()
  } else {
    if (await resourcesExist())
      return block("saved state is missing, but private preview resources exist.")
    const seed = { version: 4, terraform_version: "1.13.0", serial: 0, lineage: randomUUID(), outputs: {}, resources: [], check_results: null }
    const file = join(directory, `preview-seed-${randomBytes(8).toString("hex")}.json`)
    try {
      await writePrivateFile(file, JSON.stringify(seed))
      // Create-only: a concurrent writer makes this fail instead of being overwritten.
      await azure("storage", "blob", "upload", ...blob, "--file", file, "--if-none-match", "*")
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error
      return block("the empty state could not be created exclusively. Another process may have written it.")
    } finally {
      await rm(file, { force: true })
    }
    expected = await download()
    if (expected.lineage !== seed.lineage || expected.serial !== 0)
      return block("the state created for this run was changed by another process.")
  }
  return {
    lineage: expected.lineage,
    // Call after Terraform opens the backend and around every apply.
    verify(state: unknown) {
      const actual = readSnapshot(state)
      if (!actual || actual.lineage !== expected.lineage || actual.serial < expected.serial)
        block("Terraform opened a different state than the one checked before it started.")
      expected = actual!
    },
  }
}
