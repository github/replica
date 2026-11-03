import { redirect } from "react-router"
import { z } from "zod"

import type { Route } from "./+types/index"
import { sessionResponseSchema } from "../../session-contracts"
import { requestJson } from "../../requests/request-json"

export async function clientAction({ request }: Pick<Route.ClientActionArgs, "request">) {
  if (request.method.toUpperCase() !== "POST") {
    throw new Response("Method not allowed.", { status: 405, headers: { Allow: "POST" } })
  }
  const form = await request.formData()
  const intent = z.enum(["sign-in", "sign-out"]).safeParse(form.get("intent"))
  if (!intent.success) throw new Response("Choose a valid session action.", { status: 422 })
  await requestJson(new URL("/api/session", request.url), sessionResponseSchema, {
    method: intent.data === "sign-out" ? "DELETE" : "POST",
    signal: request.signal,
  })
  return redirect(intent.data === "sign-out" ? "/sign-in" : "/")
}

export default function SessionRoute() {
  return null
}
