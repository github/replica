import type { Request, Response } from "express"

export function respondNotFound(_request: Request, response: Response): void {
  response.status(404).json({ error: "Not found" })
}
