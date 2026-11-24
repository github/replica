import { redirect } from "react-router"

export function clientLoader({ request }: { request: Request }): never {
  const url = new URL(request.url)
  throw redirect(`/settings/administrators${url.search}`)
}
