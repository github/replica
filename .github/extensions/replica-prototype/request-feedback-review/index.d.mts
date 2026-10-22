import type { CanvasContext } from "../create-canvas-context/index.mjs"
import type { HubClient } from "../create-hub-client/index.mjs"
import type { PublishSession } from "../request-publish/index.mjs"

export function requestFeedbackReview(
  context: CanvasContext,
  session: PublishSession,
  hub: HubClient | null,
  target: unknown,
  options?: { verifyCurrent?: () => Promise<void> },
): Promise<{ requested: true }>
