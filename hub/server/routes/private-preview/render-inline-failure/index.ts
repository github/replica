import type { Response } from "express"

/** Explains inside the Build page frame why the inline shell cannot start. */
export function renderInlineFailure(
  response: Response,
  hubOrigin: string,
  status: 401 | 404 | 409 | 503,
) {
  const message = {
    401: "Sign in to Hub again, then reload this page.",
    404: "This prototype cannot open here. Open it in a new tab.",
    409: "This Build does not support private previews. Open it in a new tab.",
    503: "Private preview is temporarily unavailable. Open it in a new tab or try again.",
  }[status]
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${hubOrigin}`,
  )
  return response
    .status(status)
    .type("html")
    .send(
      `<!doctype html><meta charset="utf-8"><title>Private prototype</title><p role="status">${message}</p>`,
    )
}
