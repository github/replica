import { createHubClient } from "../create-hub-client/index.mjs"
import { InvalidHubOrigin } from "../invalid-hub-origin/index.mjs"
import { normalizeSelectedHubOrigin } from "../normalize-selected-hub-origin/index.mjs"
import { createHubOriginStore } from "../create-hub-origin-store/index.mjs"
import { discoverHub } from "../discover-hub/index.mjs"
import { readCanvasRepository } from "../read-canvas-repository/index.mjs"

export function createHubConnection(getContext, options = {}) {
  let hubPromise
  let hubRepository
  const origins = createHubOriginStore(options)
  const selectedOrigins = new Map()
  const discoveries = new Map()

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

  async function hubClient() {
    const context = getContext()
    const { repository, legacyRepository } = await readCanvasRepository(context)
    if (!discoveries.has(repository)) await refreshDiscovery()
    if (!hubPromise || hubRepository !== repository) {
      const pending = (
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
        if (!selected && discovery?.state === "valid") {
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

  async function selectHubOrigin(value) {
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
