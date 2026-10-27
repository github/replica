import type { Request, Response } from "express"

/** Check that the API responds without requiring a database connection. */
export function get(_request: Request, response: Response): void {
  response.json({ status: "ok" })
}
