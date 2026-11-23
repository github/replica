import { ManagedIdentityCredential } from "@azure/identity"
import { BlobServiceClient } from "@azure/storage-blob"

export function createPrivateBlobArtifactReader(settings: {
  accountUrl: string
  container: string
  managedIdentityClientId?: string
}) {
  const identity = settings.managedIdentityClientId
    ? new ManagedIdentityCredential({ clientId: settings.managedIdentityClientId })
    : new ManagedIdentityCredential()
  const container = new BlobServiceClient(settings.accountUrl, identity).getContainerClient(
    settings.container,
  )
  return async (key: string, length: number, signal: AbortSignal) => {
    try {
      const response = await container
        .getBlockBlobClient(key)
        .download(0, undefined, { abortSignal: signal })
      const stream = response.readableStreamBody
      if (!stream) return { status: "unavailable" } as const
      try {
        if (response.contentLength !== length) return { status: "unavailable" } as const
        const bytes = Buffer.alloc(length)
        let offset = 0
        for await (const chunk of stream) {
          signal.throwIfAborted()
          const part = Buffer.from(chunk)
          if (offset + part.byteLength > length) return { status: "unavailable" } as const
          part.copy(bytes, offset)
          offset += part.byteLength
        }
        if (offset !== length) return { status: "unavailable" } as const
        return { status: "ok", bytes } as const
      } finally {
        stream.destroy()
      }
    } catch (error) {
      if (error instanceof Error && "statusCode" in error && error.statusCode === 404) {
        return { status: "not-found" } as const
      }
      return { status: "unavailable" } as const
    }
  }
}
