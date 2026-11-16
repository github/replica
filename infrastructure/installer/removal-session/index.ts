import { readPrivateFile, writePrivateFile } from "../private-files/index.ts"
import type { RemovalTarget } from "../types.ts"

export async function removalSession(target: RemovalTarget) {
  const path = `${target.path}.removal.json`
  const identity = JSON.stringify(target.config)
  let original = await readPrivateFile(path, { createDirectory: false })
  let phase: "removing" | "retained" | "complete" | undefined
  if (original !== undefined) {
    let value: unknown
    try {
      value = JSON.parse(original)
    } catch {
      throw new Error("Interrupted removal evidence is invalid; the file was preserved.")
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !("version" in value) ||
      value.version !== 1 ||
      !("target" in value) ||
      value.target !== identity ||
      !("phase" in value) ||
      !["removing", "retained", "complete"].includes(String(value.phase))
    )
      throw new Error(
        "Interrupted removal evidence conflicts with this configuration; the file was preserved.",
      )
    phase = value.phase as typeof phase
  }
  return {
    get phase() {
      return phase
    },
    async save(next: "removing" | "retained" | "complete") {
      if ((await readPrivateFile(path, { createDirectory: false })) !== original)
        throw new Error("Interrupted removal evidence changed. No progress was overwritten.")
      const content = JSON.stringify({
        version: 1,
        target: identity,
        phase: next,
      })
      await writePrivateFile(path, content, {
        exclusive: original === undefined,
      })
      original = content
      phase = next
    },
  }
}
