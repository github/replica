import type { Request, Response } from "express"

import type { ArtifactPublishingService } from "#server/domains/artifact-publishing/create-service/types"

function parameter(request: Request, name: string): string {
  const value = request.params[name]
  return typeof value === "string" ? value : ""
}

function authorization(request: Request): string {
  return request.get("authorization") ?? ""
}

function idempotencyKey(request: Request): string {
  return request.get("idempotency-key") ?? ""
}

export async function publishArtifact(
  artifactPublishing: ArtifactPublishingService,
  request: Request,
  response: Response,
): Promise<void> {
  const result = await artifactPublishing.publish(
    authorization(request),
    parameter(request, "prototypeId"),
    idempotencyKey(request),
    request.body,
  )
  response.status(result.replayed ? 200 : 201).json(result)
}

export async function getPublicationStatus(
  artifactPublishing: ArtifactPublishingService,
  request: Request,
  response: Response,
): Promise<void> {
  response.json(
    await artifactPublishing.getStatus(
      authorization(request),
      parameter(request, "prototypeId"),
      idempotencyKey(request),
    ),
  )
}

export async function promoteVersion(
  artifactPublishing: ArtifactPublishingService,
  request: Request,
  response: Response,
): Promise<void> {
  const channel = await artifactPublishing.promote(
    authorization(request),
    parameter(request, "prototypeId"),
    parameter(request, "channel"),
    request.body,
  )
  response.json({ channel })
}
