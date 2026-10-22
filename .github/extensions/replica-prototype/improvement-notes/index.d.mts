import type { CanvasContext } from "../create-canvas-context/index.mjs"
import type { HubClient } from "../create-hub-client/index.mjs"
import type { PublishSession } from "../request-publish/index.mjs"

export type ImprovementNotes = {
  capture(): Promise<unknown>
  load(): Promise<unknown>
  save(input: Record<string, unknown>): Promise<unknown>
  sync(input: Record<string, unknown>): Promise<unknown>
  fix(input: Record<string, unknown>): Promise<unknown>
  batch(input: Record<string, unknown>): Promise<unknown>
  results(input: Record<string, unknown>): Promise<unknown>
}

export function createImprovementNotes(
  getContext: () => CanvasContext,
  session: PublishSession,
  getHub: () => Promise<HubClient | null>,
  options?: { directory?: string },
): ImprovementNotes
