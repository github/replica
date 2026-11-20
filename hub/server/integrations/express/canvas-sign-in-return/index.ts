import { createHash } from "node:crypto"
import type { Request } from "express"

import { readCookie } from "../read-cookie/index.ts"

export const canvasSignInReturnCookie = "replica_canvas_sign_in_return"
export const canvasSignInReturnPattern = /^\/canvas\/(?:pair\/[A-F0-9]{10}|connections)(?![\s\S])/

function bindingDigest(browserBinding: string) {
  return createHash("sha256").update(browserBinding).digest("hex")
}

export function bindCanvasSignInReturn(browserBinding: string, destination: string) {
  return `${bindingDigest(browserBinding)}:${destination}`
}

export function readCanvasSignInReturn(request: Request, browserBinding: string) {
  const [digest, destination, extra] = (readCookie(request, canvasSignInReturnCookie) ?? "").split(
    ":",
  )
  return !extra &&
    digest === bindingDigest(browserBinding) &&
    destination &&
    canvasSignInReturnPattern.test(destination)
    ? destination
    : null
}
