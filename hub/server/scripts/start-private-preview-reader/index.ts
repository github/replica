import { createServer } from "node:http"

import { parseArtifactStorageSettings } from "../../domains/artifacts/parse-artifact-storage-settings/index.ts"
import { readPrivatePreviewSettings } from "../../domains/private-preview/read-settings/index.ts"
import { readerAuthorizePath, readerExchangePath } from "../../domains/private-preview/types.ts"
import { createPrivateArtifactReader } from "../../integrations/filesystem/create-private-artifact-reader/index.ts"
import { createAuthorityClient } from "../../integrations/private-preview/create-authority-client/index.ts"
import { createPrivatePreviewReader } from "../../routes/private-preview-reader/index.ts"

const settings = readPrivatePreviewSettings(process.env)
if (!settings) throw new Error("The private preview reader is disabled.")

const provider = process.env.ARTIFACT_STORAGE_PROVIDER
const account = process.env.AZURE_STORAGE_ACCOUNT
const storage = parseArtifactStorageSettings(
  provider === "azure"
    ? {
        provider: "azure-blob",
        accountUrl: `https://${account ?? ""}.blob.core.windows.net`,
        container: process.env.AZURE_STORAGE_CONTAINER,
        managedIdentityClientId: process.env.AZURE_CLIENT_ID,
      }
    : { provider, directory: process.env.ARTIFACT_STORAGE_DIRECTORY },
)
const trustedProxyHops = Number(process.env.PRIVATE_PREVIEW_TRUSTED_PROXY_HOPS ?? 0)
const port = Number(process.env.PORT ?? 3002)
if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  !Number.isInteger(trustedProxyHops) ||
  trustedProxyHops < 0 ||
  trustedProxyHops > 10
) {
  throw new Error("Private preview port or trusted proxy hop count is invalid.")
}
const readArtifact =
  storage.provider === "filesystem"
    ? createPrivateArtifactReader(storage.directory)
    : (
        await import("../../integrations/azure-blob/create-private-artifact-reader/index.ts")
      ).createPrivateBlobArtifactReader(storage)
const authority = createAuthorityClient(settings.hubOrigin, settings.readerSecret)
const app = createPrivatePreviewReader({
  settings,
  trustedProxyHops,
  readArtifact,
  exchange: (grant, { repositoryId, runId }, challengeDigest) =>
    authority.exchange(readerExchangePath, { repositoryId, runId, grant, challengeDigest }),
  authorizeFile: (access, { repositoryId, runId }, path, allowEntryPointFallback) =>
    authority.authorizeFile(readerAuthorizePath, {
      repositoryId,
      runId,
      access,
      path,
      allowEntryPointFallback,
    }),
})
const server = createServer({ headersTimeout: 10_000, requestTimeout: 15_000 }, app)
// Container liveness can use a TCP probe; HTTP routes require the HTTPS ingress host.
server.listen(port, process.env.HOST ?? "127.0.0.1")
server.on("error", () => {
  console.error("Private preview reader could not listen.")
  process.exitCode = 1
})
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close()
    setTimeout(() => server.closeAllConnections(), 15_000).unref()
  })
}
