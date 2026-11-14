import { readdir, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { privateDirectory, writePrivateFile } from "../../../installer/private-files/index.ts"
import type { RemovalModule } from "../types.ts"

export async function stageRemovalModule(
  module: RemovalModule,
  destination: string,
): Promise<void> {
  const source = resolve(import.meta.dirname, "../..", module === "app" ? "." : module)
  await privateDirectory(destination)
  for (const name of await readdir(source)) {
    if (!name.endsWith(".tf") && name !== ".terraform.lock.hcl") continue
    let content = await readFile(join(source, name), "utf8")
    if (module === "app" && name === "application.tf") {
      const guard = "prevent_destroy = true"
      if (content.split(guard).length !== 2)
        throw new Error("Application destruction guard shape changed; removal needs review.")
      content = content.replace(guard, "prevent_destroy = false")
    }
    if (module === "foundation" && name === "main.tf") {
      const features = "  features {"
      if (content.split(features).length !== 2)
        throw new Error("Foundation provider features changed; removal needs review.")
      content = content.replace(
        features,
        `${features}\n    key_vault {\n      purge_soft_delete_on_destroy = false\n    }`,
      )
    }
    await writePrivateFile(join(destination, name), content, { exclusive: true })
  }
}
