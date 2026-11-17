import type { RequestHandler } from "express"
import { z } from "zod"

import { createBuildPreviewOrigin } from "../../../../../domains/build-preview/create-build-preview-origin/index.ts"
import type { PublicSharingRouteDependencies } from "../../types.ts"

export function get(sharing: PublicSharingRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const publicId = z.uuid().safeParse(request.params.shareId)
      if (!publicId.success) {
        response.status(404).json({ error: "Shared preview not found." })
        return
      }
      const link = await sharing.readPublicLink(publicId.data)
      response.setHeader("Cache-Control", "private, no-store")
      response.setHeader("Referrer-Policy", "no-referrer")
      if (!link) {
        response.status(404).json({ error: "Shared preview not found." })
        return
      }
      if (link.state === "unavailable") {
        response.status(404).json({ error: "Shared preview not found." })
        return
      }
      if (link.state !== "active") {
        response.json({ state: link.state, label: "Shared preview" })
        return
      }
      response.json({
        state: "active",
        label: link.label,
        prototypeName: link.prototypeName,
        buildNumber: link.buildNumber,
        previewUrl: new URL(`/api/shared/${publicId.data}/preview`, sharing.applicationOrigin).href,
        expiresAt: link.expiresAt.toISOString(),
        controlsIdentity: `share:${publicId.data}`,
        controlsOrigin: createBuildPreviewOrigin(link.buildId, sharing.previewBaseOrigin),
      })
    } catch (error) {
      next(error)
    }
  }
}
