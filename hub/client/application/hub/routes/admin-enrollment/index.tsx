import { redirect } from "react-router"

import { HubApplication } from "@application/hub-application"
import { isAuthenticationRoute } from "@application/hub/is-authentication-route"

import type { Route } from "./+types/index"

export function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  if (!isAuthenticationRoute(request)) throw redirect("/settings/enroll")
  return null
}

export default function AdminEnrollmentRoute() {
  return <HubApplication />
}
