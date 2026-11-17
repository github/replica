import { redirect } from "react-router"

import { HubApplication } from "@application/hub-application"
import { isPublicRoute } from "@application/hub/is-public-route"

import type { Route } from "./+types/index"

export function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  if (!isPublicRoute(request)) throw redirect("/settings/enroll")
  return null
}

export default function AdminEnrollment() {
  return <HubApplication />
}
