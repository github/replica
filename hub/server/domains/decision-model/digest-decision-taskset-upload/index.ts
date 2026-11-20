import { createHash } from "node:crypto"

import type { DecisionRuntimeTasksetUpload } from "../../../integrations/decision-runtime/create-decision-runtime-client/types.ts"

function sorted(item: unknown): unknown {
  if (Array.isArray(item)) return item.map(sorted)
  if (item && typeof item === "object") {
    return Object.fromEntries(
      Object.entries(item)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, member]) => [key, sorted(member)]),
    )
  }
  return item
}

function runtimeJson(value: unknown): string {
  const json = JSON.stringify(sorted(value))
  let ascii = ""
  for (let index = 0; index < json.length; index += 1) {
    const code = json.charCodeAt(index)
    ascii += code < 128 ? json[index] : `\\u${code.toString(16).padStart(4, "0")}`
  }
  return ascii
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {}
}

export function digestDecisionTasksetUpload(upload: DecisionRuntimeTasksetUpload): string {
  const identity = {
    manifest: upload.manifest,
    tasks: upload.tasks.map((taskValue) => {
      const task = record(taskValue)
      return {
        id: task.id,
        split: task.split,
        state: task.state,
        images: Array.isArray(task.images)
          ? task.images.map((imageValue) => {
              const image = record(imageValue)
              return {
                role: image.role,
                path: image.path,
                mediaType: image.mediaType,
                digest: image.digest,
                size: image.size ?? null,
                theme: image.theme ?? null,
              }
            })
          : [],
        questions: task.questions,
        labels:
          task.labels && typeof task.labels === "object"
            ? Object.fromEntries(
                Object.entries(task.labels).map(([key, label]) => {
                  const value = record(label)
                  return [key, Object.hasOwn(value, "answer") ? value.answer : label]
                }),
              )
            : {},
        provenance: task.provenance,
      }
    }),
  }
  return `sha256:${createHash("sha256")
    .update(`${runtimeJson(identity)}\n`)
    .digest("hex")}`
}
