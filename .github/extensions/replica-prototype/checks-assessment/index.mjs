import { createHash } from "node:crypto"

import { resolveCheckScope } from "../checks-scope/index.mjs"

export function createCheckAssessment(check, input) {
  const scope = resolveCheckScope(check, input)
  const context = {
    version: 2,
    checkId: check.id,
    scope: { files: scope.files, contextFiles: scope.contextFiles },
    criteria: check.criteria ?? [],
  }
  const definition = Object.fromEntries(
    Object.entries(check).filter(([key]) => key !== "automatic"),
  )
  function fileDigest(file) {
    const content = input.files.get(file)
    return [file, content === undefined ? null : (input.fileHashes?.get(file) ?? digest(content))]
  }
  const fingerprint = digest(
    JSON.stringify(
      canonical({
        version: 1,
        definition,
        context,
        source: scope.files.map(fileDigest),
        guidance: scope.contextFiles.map(fileDigest),
        instructions: scope.instructionsFile ? fileDigest(scope.instructionsFile) : null,
      }),
    ),
  )
  return {
    fingerprint,
    scope,
    context: { ...context, fingerprint },
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex")
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    )
  return value
}
