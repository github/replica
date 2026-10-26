import type { Request, Response } from "express"

export function get(_request: Request, response: Response): void {
  response.json({ status: "ok" })
}
