import { setTimeout as delay } from "node:timers/promises"
import type { AzureInstallation } from "../../install/types.ts"
import type { PostDeployment } from "../types.ts"

export async function verifyPostSetup(
  context: AzureInstallation,
  deployment: PostDeployment,
  {
    origin,
    setup,
    github,
    restart,
    request = fetch,
  }: {
    origin: string
    setup: boolean
    github: boolean
    restart: boolean
    request?: typeof fetch
  },
): Promise<void> {
  const deadline = performance.now() + 300_000
  let reason = "The intended Hub revision has not become ready."
  while (performance.now() < deadline) {
    context.signal?.throwIfAborted()
    const current = JSON.parse(
      await context.azure(
        "containerapp",
        "show",
        "--name",
        deployment.appName,
        "--resource-group",
        context.config.azure.resourceGroup,
        "--query",
        "{id:id,latest:properties.latestRevisionName,ready:properties.latestReadyRevisionName,traffic:properties.configuration.ingress.traffic}",
      ),
    ) as {
      id?: string
      latest?: string
      ready?: string
      traffic?: { weight?: number; latestRevision?: boolean; revisionName?: string }[]
    }
    if (
      current.id?.toLowerCase() !== deployment.appId.toLowerCase() ||
      !Array.isArray(current.traffic)
    )
      throw new Error("Hub identity or traffic became unverifiable after post-setup.")
    const traffic = current.traffic.filter((value) => value.weight !== 0)
    const revision = restart ? deployment.revision : current.latest
    if (typeof revision !== "string" || !revision.startsWith(`${deployment.appName}--`))
      throw new Error("Azure did not return the intended Hub revision.")
    if (
      traffic.length !== 1 ||
      traffic[0]?.weight !== 100 ||
      (traffic[0]?.revisionName ?? (traffic[0]?.latestRevision ? current.latest : undefined)) !==
        revision
    )
      throw new Error(
        "Hub traffic does not target the intended post-setup revision. No old revision was activated.",
      )
    const status = JSON.parse(
      await context.azure(
        "containerapp",
        "revision",
        "show",
        "--name",
        deployment.appName,
        "--resource-group",
        context.config.azure.resourceGroup,
        "--revision",
        revision,
        "--query",
        "{name:name,active:properties.active,health:properties.healthState,image:properties.template.containers[0].image}",
      ),
    ) as { name?: string; active?: boolean; health?: string; image?: string }
    if (status.name !== revision || status.image !== deployment.image)
      throw new Error("The post-setup revision does not use the approved deployed image.")
    if (
      status.active === true &&
      status.health === "Healthy" &&
      (restart || current.ready === revision)
    ) {
      try {
        const signal = context.signal
          ? AbortSignal.any([context.signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000)
        const response = await request(`${origin}/api/ready`, { signal, redirect: "error" })
        await response.body?.cancel()
        if (response.status === 200) {
          if (setup) {
            const result = await request(`${origin}/api/settings/github/status`, {
              signal,
              redirect: "error",
            })
            if (result.status !== 403) {
              await result.body?.cancel()
              throw new Error(
                "Hub is reachable but GitHub setup availability was not verified (expected protected bootstrap/administrator access, not 404).",
              )
            }
            const body: unknown = await result.json()
            if (
              !body ||
              typeof body !== "object" ||
              !("requires" in body) ||
              !["bootstrap", "administrator"].includes(String(body.requires))
            )
              throw new Error("GitHub setup returned an unexpected access contract.")
          }
          if (github) {
            const result = await request(`${origin}/api/auth/providers`, {
              signal,
              redirect: "error",
            })
            if (!result.ok) {
              await result.body?.cancel()
              throw new Error(
                "Hub is ready, but GitHub sign-in is not enabled. Review all seven GitHub settings and provider revision.",
              )
            }
            const body: unknown = await result.json()
            if (
              !body ||
              typeof body !== "object" ||
              !("providers" in body) ||
              !Array.isArray(body.providers) ||
              !body.providers.includes("github")
            )
              throw new Error(
                "GitHub sign-in was not listed by the configured authentication providers.",
              )
          }
          return
        }
        reason = `Hub readiness returned HTTP ${response.status}.`
      } catch (error) {
        context.signal?.throwIfAborted()
        if (
          !(error instanceof TypeError) &&
          !(error instanceof DOMException && error.name === "TimeoutError")
        )
          throw error
        reason = "Hub readiness could not be reached. Check the selected origin and network."
      }
    }
    context.ui.status(`${reason} Rechecking without replaying configuration or restart.`)
    await delay(5_000, undefined, { signal: context.signal })
  }
  throw new Error(
    `${reason} Post-setup may already be applied; retry verification or review the retained locks before a new action.`,
  )
}
