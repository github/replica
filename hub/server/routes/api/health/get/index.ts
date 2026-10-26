import type { Request, Response } from "express"

export function handleApiHealthGet(_request: Request, response: Response): void {
  response.json({ status: "ok" })
}
