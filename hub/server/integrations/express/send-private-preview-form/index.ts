import { randomBytes } from "node:crypto"
import type { Response } from "express"

/** Sends a fixed self-submitting form so handoff values stay out of URLs. */
export function sendPrivatePreviewForm(
  response: Response,
  origin: string,
  path: string,
  name: "intent" | "continuation" | "grant" | "resume",
  value: string,
) {
  const nonce = randomBytes(18).toString("base64url")
  // Preserve the form POST's Origin without sending its value in a referrer.
  response.setHeader("Referrer-Policy", "origin")
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${origin}; base-uri 'none'; frame-ancestors 'none'`,
  )
  return response.type("html")
    .send(`<!doctype html><meta charset="utf-8"><title>Open private prototype</title>
<form method="post" action="${origin}${path}">
<input type="hidden" name="${name}" value="${value}">
</form>
<noscript>JavaScript is required to open this private prototype.</noscript>
<script nonce="${nonce}">document.forms[0].submit()</script>`)
}
