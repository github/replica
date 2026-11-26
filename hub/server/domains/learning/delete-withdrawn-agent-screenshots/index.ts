import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"

/**
 * Deletes the stored images taken under one withdrawn consent grant. A grant never becomes
 * active again, since turning consent back on makes a new one, so this cannot remove images
 * the repository allows now. The bytes go first so a failure leaves the record for a retry.
 */
export async function deleteWithdrawnAgentScreenshots(dependencies: {
  activeGrantId(): Promise<string | null>
  deleteRecord(id: string): Promise<unknown>
  grantId: string
  list(): Promise<{ id: string; storageKey: string }[]>
  storage: Pick<ArtifactStorage, "delete">
}) {
  if ((await dependencies.activeGrantId()) === dependencies.grantId) return
  for (;;) {
    const screenshots = await dependencies.list()
    if (screenshots.length === 0) return
    for (const screenshot of screenshots) {
      const { status } = await dependencies.storage.delete(screenshot.storageKey)
      if (status !== "ok" && status !== "not-found") {
        throw new Error(`Hub could not delete a withdrawn agent screenshot (${status}).`)
      }
      await dependencies.deleteRecord(screenshot.id)
    }
  }
}
