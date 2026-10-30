import { redirect } from "react-router"

import type { Route } from "./+types/index"
import { mockProfileSchema, sessionResponseSchema } from "../../session-contracts"
import { requestJson } from "../../requests/request-json"

export async function clientAction({ request }: Pick<Route.ClientActionArgs, "request">) {
  if (request.method.toUpperCase() !== "POST") {
    throw new Response("Method not allowed.", { status: 405, headers: { Allow: "POST" } })
  }
  const form = await request.formData()
  const profile = mockProfileSchema.safeParse(form.get("profile"))
  if (!profile.success) throw new Response("Choose a known mock profile.", { status: 422 })
  await requestJson(new URL("/api/session", request.url), sessionResponseSchema, {
    method: "POST",
    body: JSON.stringify({ profile: profile.data }),
    signal: request.signal,
  })
  return redirect(profile.data === "signed-out" ? "/sign-in" : "/")
}

export default function SessionRoute() {
  return null
}
