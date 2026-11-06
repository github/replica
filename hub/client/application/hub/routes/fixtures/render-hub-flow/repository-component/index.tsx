import { useLoaderData } from "react-router"

import type { clientLoader as loadRepository } from "@application/hub/routes/repository"
import RepositoryRoute from "@application/hub/routes/repository"

export function RepositoryComponent() {
  return <RepositoryRoute loaderData={useLoaderData<typeof loadRepository>()} />
}
