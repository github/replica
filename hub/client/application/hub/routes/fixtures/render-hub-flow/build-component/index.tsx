import { useLoaderData } from "react-router"

import type { clientLoader as loadBuild } from "@application/hub/routes/build"
import BuildRoute from "@application/hub/routes/build"

export function BuildComponent() {
  return <BuildRoute loaderData={useLoaderData<typeof loadBuild>()} />
}
