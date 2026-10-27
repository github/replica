export type PublisherAction = "publish" | "read-status"
export type PrototypeChannelName = "current" | "preview"

export interface ArtifactManifest {
  schemaVersion: 1
  prototypeId: string
  artifact: {
    format: string
    version: string
    digest: string
    sizeBytes: number
    builtAt: string
  }
  provenance: {
    provider: string
    sourceUrl?: string
    revision?: string
    ref?: string
    pipeline?: string
    runId?: string
  }
}

export interface ArtifactPublishingService {
  publish(
    authorization: string,
    prototypeId: string,
    idempotencyKey: string,
    input: unknown,
  ): Promise<{ version: unknown; replayed: boolean; promotedChannel: string | null }>
  getStatus(authorization: string, prototypeId: string, idempotencyKey: string): Promise<unknown>
  promote(
    authorization: string,
    prototypeId: string,
    channel: string,
    input: unknown,
  ): Promise<unknown>
}
