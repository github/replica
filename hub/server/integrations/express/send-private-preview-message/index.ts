import { randomBytes } from "node:crypto"
import type { Response } from "express"

/** Hands a signed state to the Hub launch shell that frames this reader document. */
export function sendPrivatePreviewMessage(
  response: Response,
  hubOrigin: string,
  name: "continuation" | "resume",
  value: string,
) {
  const nonce = randomBytes(18).toString("base64url")
  response.removeHeader("X-Frame-Options")
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none'; frame-ancestors ${hubOrigin}`,
  )
  const message = JSON.stringify({ [name]: value })
  return response.type("html")
    .send(`<!doctype html><meta charset="utf-8"><title>Open private prototype</title>
<script nonce="${nonce}">parent.postMessage(${message}, ${JSON.stringify(hubOrigin)})</script>`)
}
