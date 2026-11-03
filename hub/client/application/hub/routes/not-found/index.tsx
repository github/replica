export function clientLoader(): never {
  throw new Response("This page does not exist in this frontend.", { status: 404 })
}

export default function NotFoundRoute(): null {
  return null
}
