import { routeIdentifierSchema } from "../contracts"

export function readRouteIdentifier(value: string | undefined, label: string): number {
  const parsed = routeIdentifierSchema.safeParse(value)
  if (!parsed.success) throw new Response(`Invalid ${label}.`, { status: 400 })
  return parsed.data
}
