import { matchesCheckFile as matches } from "../checks-file-matches/index.mjs"

export function resolveCheckScope(check, input) {
  const pages = check.targets
    ? input.pages.filter((page) => check.targets.includes(page.id))
    : (input.config?.pages ?? input.pages)
  const contextFiles = [...(check.context ?? [])].sort()
  const instructionsFile = check.runner.type === "agent" ? check.runner.instructions : undefined
  const guidance = new Set([...contextFiles, instructionsFile, ".replica/checks.json"])
  const includes = check.inputs?.include
  const candidates = includes
    ? new Set([
        ...[...input.files.keys()].filter((file) =>
          includes.some((pattern) => matches(pattern, file)),
        ),
        ...includes.filter((pattern) => !pattern.includes("*")),
      ])
    : check.targets
      ? new Set(pages.flatMap((page) => input.pageFiles[page.id] ?? []))
      : new Set(input.files.keys())
  const files = [...candidates]
    .filter(
      (file) =>
        !guidance.has(file) &&
        !(check.inputs?.exclude ?? []).some((pattern) => matches(pattern, file)),
    )
    .sort()
  const pageFiles = Object.fromEntries(
    pages.map((page) => [
      page.id,
      files.filter(
        (file) =>
          input.files.has(file) &&
          (page.inputs
            ? page.inputs.some((pattern) => matches(pattern, file))
            : input.pageFiles[page.id]?.includes(file)),
      ),
    ]),
  )
  return { files, contextFiles, instructionsFile, pages, pageFiles }
}
