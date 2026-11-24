import type { PrivatePreviewAddress } from "../../utils/private-preview-address/index.ts"
import { maximumDistFileBytes } from "../build-artifacts/constants.ts"

export const privatePreviewManifestPath = "dist/replica-preview-base.json"
export const maximumPrivatePreviewManifestBytes = 256
export const maximumPrivatePreviewFileBytes = maximumDistFileBytes
export const grantLifetime = 30_000
export const sessionLifetime = 15 * 60_000
export const readerExchangePath = "/api/private-preview/reader/exchange"
export const readerAuthorizePath = "/api/private-preview/reader/file"

export const previewTokenPattern = /^[A-Za-z0-9_-]{43}$/
export const previewDigestPattern = /^[0-9a-f]{64}$/
export const previewStorageKeyPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export interface PrivatePreviewTarget {
  buildId: string
  repositoryId: string
  startPage: string
}

export interface PrivatePreviewFile {
  storageKey: string
  byteLength: number
  path: string
}

export interface PrivatePreviewAuthority {
  launch(
    session: string,
    address: PrivatePreviewAddress,
  ): Promise<"allowed" | "denied" | "incompatible">
  issue(
    session: string,
    address: PrivatePreviewAddress,
    challengeDigest: string,
  ): Promise<string | null>
  exchange(
    grant: string,
    address: PrivatePreviewAddress,
    challengeDigest: string,
  ): Promise<{ access: string; startPage: string } | null>
  authorizeFile(
    access: string,
    address: PrivatePreviewAddress,
    path: string,
    allowEntryPointFallback: boolean,
  ): Promise<PrivatePreviewFile | null>
}
