import { redirect } from "react-router"

import { canvasConnectionsPath } from "@application/hub/canvas-connections/contract"

export function clientLoader(): never {
  throw redirect(canvasConnectionsPath)
}

export function clientAction(): never {
  throw new Response("Open the approval link from the Replica canvas.", { status: 405 })
}
