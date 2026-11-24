import { useOutletContext } from "react-router"

import { RealInboxScreen } from "@application/hub/screens/real-inbox-screen"
import type { WorkspaceResponse } from "@application/hub/contracts/types"

import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = {
  workspaceSection: "notifications",
  independentOfRepositoryNavigation: true,
} satisfies WorkspaceRouteHandle

export function clientAction(): never {
  throw new Response("Method not allowed.", { status: 405 })
}

export function meta() {
  return [{ title: "Inbox - Replica Hub" }]
}

export default function SettingsNotifications() {
  const workspace = useOutletContext<WorkspaceResponse>()
  return <RealInboxScreen workspace={workspace} />
}
