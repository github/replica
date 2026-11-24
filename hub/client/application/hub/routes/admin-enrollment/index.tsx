import { redirect } from "react-router"

import { HubApplication } from "@application/hub-application"
export function clientLoader() {
  if (import.meta.env.DEV && import.meta.env.MODE === "mock") throw redirect("/settings/enroll")
  return null
}

export default function AdminEnrollment() {
  return <HubApplication />
}
