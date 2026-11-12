import { type Params } from "react-router"

export function readTestRouteParameter(params: Params, name: string): string {
  const value = params[name]
  if (value === undefined) throw new Error(`The test route is missing ${name}.`)
  return value
}
