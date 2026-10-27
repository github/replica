import type { Request, Response } from "express"

/** Return the API's JSON error rather than Express's HTML fallback. */
export function respondNotFound(_request: Request, response: Response): void {
  response.status(404).json({ error: "Not found" })
}
