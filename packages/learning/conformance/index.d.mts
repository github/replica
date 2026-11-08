import type { MemoryProvider } from "../index.d.mts"

/**
 * Register the memory provider conformance suite with node:test. createProvider must return a
 * new, empty provider each time.
 */
export declare function memoryProviderConformance(options: {
  name: string
  createProvider: () => MemoryProvider | Promise<MemoryProvider>
}): void

export declare const HUB_ORIGIN: string
export declare const REPOSITORY: string
export declare const REMOTE: string
export declare function collectionLog(options: {
  snapshotId: string
  capturedAt: string
  threads: unknown[]
  pageSize?: number
  filters?: Record<string, string>
  viewerLogin?: string
  repository?: string
}): { kind: string; calls: unknown[] }
export declare function weekOneLog(overrides?: Record<string, unknown>): {
  kind: string
  calls: unknown[]
}
export declare function weekTwoLog(overrides?: Record<string, unknown>): {
  kind: string
  calls: unknown[]
}
/** Week one's threads a week later, for building a log of a later week with collectionLog. */
export declare function weekTwoThreads(): Array<{
  root: Record<string, unknown>
  replies: unknown[]
}>
export declare function weekOneLabels(): { labels: unknown[] }
export declare function weekOneSecondPassLabels(): { labels: unknown[] }
export declare function designer(scope?: { repository: string }): {
  scope: { repository: string }
  principal: { kind: "human"; id: string; asserted: true }
}
export declare function agent(scope?: { repository: string }): {
  scope: { repository: string }
  principal: { kind: "agent"; id: string; model: string }
}
