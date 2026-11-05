import { redirect } from "react-router"

import { HubApplication } from "../../../hub-application"
import type { Route } from "./+types/index"
import { isAuthenticationRoute } from "../../is-authentication-route"

export function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  if (!isAuthenticationRoute(request)) throw redirect("/settings/enroll")
  return null
}

export default function AdminEnrollmentRoute() {
  return <HubApplication />
}
