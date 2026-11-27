import { ManagedIdentityCredential } from "@azure/identity"
import { BlobServiceClient } from "@azure/storage-blob"

import type { AzureBlobArtifactSettings, AzureBlobArtifactStorage } from "./types.ts"

export function createAzureBlobArtifactStorage(
  settings: AzureBlobArtifactSettings,
  maxBytes: number,
): AzureBlobArtifactStorage {
  const credential = settings.managedIdentityClientId
    ? new ManagedIdentityCredential({ clientId: settings.managedIdentityClientId })
    : new ManagedIdentityCredential()
  const container = new BlobServiceClient(settings.accountUrl, credential).getContainerClient(
    settings.container,
  )

  return {
    async isReady(signal) {
      try {
        await container.getProperties({ abortSignal: signal })
        return true
      } catch {
        return false
      }
    },
    async read(key) {
      try {
        const response = await container.getBlockBlobClient(key).download()
        const stream = response.readableStreamBody
        if (!stream) return { status: "unavailable" }
        try {
          if (response.contentLength !== undefined && response.contentLength > maxBytes) {
            return { status: "too-large" }
          }
          const chunks: Buffer[] = []
          let length = 0
          for await (const chunk of stream) {
            const bytes = Buffer.from(chunk)
            length += bytes.length
            if (length > maxBytes) return { status: "too-large" }
            chunks.push(bytes)
          }
          return { status: "ok", bytes: Buffer.concat(chunks, length) }
        } finally {
          stream.destroy()
        }
      } catch (error) {
        return {
          status:
            (error as { details?: { errorCode?: string } }).details?.errorCode === "BlobNotFound"
              ? "not-found"
              : "unavailable",
        }
      }
    },
    async write(key, bytes, mode) {
      try {
        await container.getBlockBlobClient(key).uploadData(bytes, {
          conditions: { ifNoneMatch: "*" },
          blobHTTPHeaders: { blobContentType: "application/octet-stream" },
        })
        return { status: "ok" }
      } catch (error) {
        const failure = error as { statusCode?: number; details?: { errorCode?: string } } | null
        const code = failure?.details?.errorCode
        // A create-only identity can receive a denied overwrite for a conditional duplicate.
        const conflict =
          mode === "verify-existing" && failure?.statusCode === 403
            ? code === "UnauthorizedBlobOverwrite"
            : code === "BlobAlreadyExists" || code === "ConditionNotMet"
        return { status: conflict ? "already-exists" : "unavailable" }
      }
    },
    async delete(key) {
      try {
        await container.getBlockBlobClient(key).delete()
        return { status: "ok" }
      } catch (error) {
        return {
          status:
            (error as { details?: { errorCode?: string } }).details?.errorCode === "BlobNotFound"
              ? "not-found"
              : "unavailable",
        }
      }
    },
  }
}
