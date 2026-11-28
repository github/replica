import type { PrivatePreviewSettings } from "../../domains/private-preview/read-settings/index.ts"
import type { PrivatePreviewAuthority } from "../../domains/private-preview/types.ts"

export interface PrivatePreviewRouteDependencies {
  settings: PrivatePreviewSettings
  authority: PrivatePreviewAuthority
  hasCurrentHubSession(this: void, sessionDigest: string): Promise<boolean>
}
