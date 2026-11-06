import { lstat } from "node:fs/promises"
import { join, resolve } from "node:path"

import { privateDirectory, privateFile } from "../../../installer/private-files/index.ts"
import { lockSession } from "../../../installer/session/lock/index.ts"
import type { DeploymentConfig } from "../../../installer/types.ts"
import { installationWorkspace } from "../../../installer/workspace/index.ts"

export async function openInstallationWorkspace(config: DeploymentConfig, parent: string) {
  await privateDirectory(parent)
  const directory = installationWorkspace(config, parent)
  const legacy = join(resolve(parent), config.name)
  try {
    await lstat(legacy)
    throw new Error(
      `A legacy name-only workspace exists at ${legacy}. Verify its saved target and move it to ${directory} after a separate manual migration review before rerunning setup. No installation assets were moved or overwritten.`,
    )
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
  await privateDirectory(directory)
  const path = join(directory, "workspace.lock")
  await privateFile(path)
  await privateFile(`${path}.recovery`)
  const close = await lockSession(path)
  return { directory, close }
}
