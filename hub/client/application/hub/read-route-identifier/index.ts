import { routeIdentifierSchema } from "../contracts"

export function readRouteIdentifier(value: string | undefined, label: string): number {
  const parsed = routeIdentifierSchema.safeParse(value)
  if (!parsed.success) {
    throw new Response(`The ${label} identifier must be a positive whole number.`, {
      status: 400,
    })
  }
  return parsed.data
}
