import type { z } from "zod"

import type { AnchorReference, ReviewRoute } from "@utils/review-anchor/types"

import type { PREVIEW_BRIDGE_MESSAGE_SCHEMA } from "./schemas"

export interface PreviewBridgeCommandPayloads {
  "replica:bridge:request-ready": Record<string, never>
  "replica:bridge:restore-fragment": { route: ReviewRoute }
  "replica:bridge:set-theme": { theme: "light" | "dark" }
  "replica:bridge:select-element": Record<string, never>
  "replica:bridge:select-area": Record<string, never>
  "replica:bridge:cancel-selection": Record<string, never>
  "replica:bridge:clear-selection": Record<string, never>
  "replica:bridge:focus-anchor": { commentId: number }
  "replica:bridge:resolve-anchors": { replace: boolean; anchors: AnchorReference[] }
}

export type PreviewBridgeCommandType = keyof PreviewBridgeCommandPayloads

export type PreviewBridgeCommand = {
  [Type in PreviewBridgeCommandType]: {
    protocolVersion: 1
    requestId: string
    type: Type
    payload: PreviewBridgeCommandPayloads[Type]
  }
}[PreviewBridgeCommandType]

export type PreviewBridgeMessage = z.infer<typeof PREVIEW_BRIDGE_MESSAGE_SCHEMA>
