import { expect, it, vi } from "vitest"

import { deleteWithdrawnAgentScreenshots } from "."

it("deletes each withdrawn screenshot's bytes before its record", async () => {
  const steps: string[] = []
  const list = vi
    .fn()
    .mockResolvedValueOnce([{ id: "shot-1", storageKey: "agent-screenshots/1.png" }])
    .mockResolvedValueOnce([])

  await deleteWithdrawnAgentScreenshots({
    activeGrantId: () => Promise.resolve(null),
    deleteRecord: (id) => Promise.resolve(steps.push(`record ${id}`)),
    grantId: "grant-1",
    list,
    storage: {
      delete: (key) => {
        steps.push(`bytes ${key}`)
        return Promise.resolve({ status: "ok" })
      },
    },
  })

  expect(steps).toEqual(["bytes agent-screenshots/1.png", "record shot-1"])
})

it("keeps screenshots taken under the grant the repository allows now", async () => {
  const list = vi.fn()

  await deleteWithdrawnAgentScreenshots({
    activeGrantId: () => Promise.resolve("grant-1"),
    deleteRecord: vi.fn(),
    grantId: "grant-1",
    list,
    storage: { delete: vi.fn() },
  })

  expect(list).not.toHaveBeenCalled()
})

it("keeps the record for a retry when storage cannot delete the bytes", async () => {
  const deleteRecord = vi.fn()

  const deletion = deleteWithdrawnAgentScreenshots({
    activeGrantId: () => Promise.resolve(null),
    deleteRecord,
    grantId: "grant-1",
    list: () => Promise.resolve([{ id: "shot-1", storageKey: "agent-screenshots/1.png" }]),
    storage: { delete: () => Promise.resolve({ status: "unavailable" }) },
  })

  await expect(deletion).rejects.toThrow("could not delete")
  expect(deleteRecord).not.toHaveBeenCalled()
})
