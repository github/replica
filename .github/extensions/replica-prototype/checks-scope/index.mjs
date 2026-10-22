import { matchesCheckFile as matches } from "../checks-file-matches/index.mjs"

export function resolveCheckScope(check, input) {
  const contextFiles = [...(check.context ?? [])].sort()
  const instructionsFile = check.runner.type === "agent" ? check.runner.instructions : undefined
  const guidance = new Set([...contextFiles, instructionsFile, ".replica/checks.json"])
  const includes = check.inputs.include
  const candidates = new Set([
    ...[...input.files.keys()].filter((file) => includes.some((pattern) => matches(pattern, file))),
    ...includes.filter((pattern) => !pattern.includes("*")),
  ])
  const files = [...candidates]
    .filter(
      (file) =>
        !guidance.has(file) &&
        !(check.inputs.exclude ?? []).some((pattern) => matches(pattern, file)),
    )
    .sort()
  return { files, contextFiles, instructionsFile }
}
