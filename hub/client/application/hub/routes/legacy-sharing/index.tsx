import { redirect } from "react-router"
import type { LoaderFunctionArgs } from "react-router"

export function clientLoader({ request }: Pick<LoaderFunctionArgs, "request">) {
  const url = new URL(request.url)
  throw redirect(`/settings/sharing${url.search}${url.hash}`)
}
