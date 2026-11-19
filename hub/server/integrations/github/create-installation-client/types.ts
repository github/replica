import type { KeyObject } from "node:crypto"

export interface GitHubInstallationCredentials {
  appId: string
  installationId: string
  privateKey: KeyObject
}

export interface GitHubInstallationTransport {
  apiUrl?: string
  fetch?: typeof globalThis.fetch
  now?: () => Date
  timeoutMs?: number
}
