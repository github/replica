import { createHubClient } from "../create-hub-client/index.mjs"
import { InvalidHubOrigin } from "../invalid-hub-origin/index.mjs"
import { normalizeSelectedHubOrigin } from "../normalize-selected-hub-origin/index.mjs"
import { createHubOriginStore } from "../create-hub-origin-store/index.mjs"
import { discoverHub } from "../discover-hub/index.mjs"
import { readCanvasRepository } from "../read-canvas-repository/index.mjs"
import type { HubClient, HubClientOptions, HubContext } from "../create-hub-client/index.mjs"
import type { HubDiscovery, HubDiscoveryOptions } from "../discover-hub/index.mjs"

export type HubConnectionOptions = HubClientOptions & HubDiscoveryOptions
export type HubConnection = ReturnType<typeof createHubConnection>

export function createHubConnection(
  getContext: () => HubContext,
  options: HubConnectionOptions = {},
) {
  let hubPromise: Promise<HubClient | null> | undefined
  let hubRepository: string | null | undefined
  const origins = createHubOriginStore(options)
  const selectedOrigins = new Map<string | null, string | null | undefined>()
  const discoveries = new Map<string | null, HubDiscovery>()

  function invalidate() {
    hubPromise = undefined
    hubRepository = undefined
  }

  async function refreshDiscovery(force = false) {
    const context = getContext()
    const { repository } = await readCanvasRepository(context)
    const discovery = await discoverHub(context, { ...options, force })
    discoveries.set(repository, discovery)
    invalidate()
    return discovery
  }

  async function hubClient(): Promise<HubClient | null> {
    const context = getContext()
    const { repository, legacyRepository } = await readCanvasRepository(context)
    if (!discoveries.has(repository)) await refreshDiscovery()
    if (!hubPromise || hubRepository !== repository) {
      const pending: Promise<HubClient | null> = (
        selectedOrigins.has(repository)
          ? Promise.resolve(selectedOrigins.get(repository))
          : origins
              .read(repository)
              .then(
                async (origin) =>
                  origin ||
                  (legacyRepository && legacyRepository !== repository
                    ? await origins.read(legacyRepository)
                    : null),
              )
      ).then(async (origin) => {
        let selected = origin || options.origin || process.env.REPLICA_HUB_ORIGIN
        const discovery = discoveries.get(repository)
        if (!selected && repository && discovery?.state === "valid") {
          selected = await origins.save(repository, discovery.origin, { ifAbsent: true })
        }
        const client = selected ? createHubClient(context, { ...options, origin: selected }) : null
        if (hubPromise === pending) selectedOrigins.set(repository, selected)
        return client
      })
      hubPromise = pending
      hubRepository = repository
    }
    const pending = hubPromise
    try {
      return await pending
    } catch (error) {
      if (hubPromise === pending) hubPromise = undefined
      throw error
    }
  }

  async function selectHubOrigin(value: string) {
    const context = getContext()
    const { repository } = await readCanvasRepository(context)
    if (!repository)
      throw Object.assign(new Error("Open a repository with a GitHub origin first."), {
        statusCode: 409,
      })
    let origin
    try {
      origin = await origins.save(repository, normalizeSelectedHubOrigin(value))
    } catch (error) {
      if (error instanceof InvalidHubOrigin) error.statusCode = 422
      throw error
    }
    selectedOrigins.set(repository, origin)
    hubPromise = Promise.resolve(createHubClient(context, { ...options, origin }))
    hubRepository = repository
    return { hubOrigin: origin }
  }

  return { hubClient, refreshDiscovery, selectHubOrigin, discoveries, invalidate }
}
