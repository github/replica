import { useLoaderData } from "react-router"

import type { clientLoader as loadWorkspace } from "@application/hub/routes/workspace"
import WorkspaceRoute from "@application/hub/routes/workspace"

export function WorkspaceComponent() {
  return <WorkspaceRoute loaderData={useLoaderData<typeof loadWorkspace>()} />
}
