export function createPrototypeSubmission({
  repositoryName,
  branchName,
  prompt,
}: {
  repositoryName: string
  branchName?: string
  prompt: string
}) {
  const params = new URLSearchParams({
    repo: repositoryName,
    ...(branchName ? { base_branch: branchName } : {}),
    prompt,
    mode: "autopilot",
  })
  const launcher = new URL("https://github.com/copilot/app/launch")
  launcher.searchParams.set("open", `ghapp://session/new?${params.toString()}`)
  return { prompt, url: launcher.toString() }
}
