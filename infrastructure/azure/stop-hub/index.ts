import timers from "node:timers/promises"

export async function stopHub({
  name,
  resourceGroup,
  command,
}: {
  name: string
  resourceGroup: string
  command(...args: string[]): unknown | Promise<unknown>
}): Promise<void> {
  const args = ["--name", name, "--resource-group", resourceGroup]
  const revisions: unknown = await command("containerapp", "revision", "list", "--all", ...args)
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)
  if (
    !Array.isArray(revisions) ||
    !revisions.every(
      (value): value is { name: string; properties: { active: boolean } } =>
        record(value) &&
        typeof value.name === "string" &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value.name) &&
        record(value.properties) &&
        typeof value.properties.active === "boolean",
    )
  )
    throw new Error("Azure did not return valid Hub revision metadata. Shutdown was not verified.")

  for (const revision of revisions) {
    if (revision.properties.active)
      await command("containerapp", "revision", "deactivate", ...args, "--revision", revision.name)
  }
  const deadline = performance.now() + 300_000
  for (const revision of revisions) {
    while (true) {
      const replicas = await command(
        "containerapp",
        "replica",
        "list",
        ...args,
        "--revision",
        revision.name,
      )
      if (!Array.isArray(replicas))
        throw new Error("Azure did not return a Hub replica list. Shutdown was not verified.")
      if (!replicas.length) break
      if (performance.now() >= deadline)
        throw new Error("Old replicas have not stopped. Hub remains in maintenance.")
      await timers.setTimeout(5_000)
    }
  }
}
