export function clientLoader(): never {
  throw new Response("This page is not connected in the first frontend journey.", { status: 404 })
}

export default function NotFoundRoute(): null {
  return null
}
