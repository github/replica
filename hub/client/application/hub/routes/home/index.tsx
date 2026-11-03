import { redirect } from "react-router"

import { HubEmptyState } from "@components/hub-empty-state"

import type { Route } from "./+types/index"
import { getSession } from "../../requests/get-session"
import { getWorkspace } from "../../requests/get-workspace"

export async function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  const session = await getSession(request)
  if (!session.viewer) throw redirect("/sign-in")
  const workspace = await getWorkspace(request)
  const firstRepository = workspace.repositories[0]
  if (firstRepository) throw redirect(`/repositories/${firstRepository.id}`)
  return null
}

export default function HomeRoute() {
  return (
    <main>
      <HubEmptyState
        heading="No repositories available"
        description="No repositories are available to this viewer."
      />
    </main>
  )
}
