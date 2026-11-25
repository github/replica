import { redirect } from "react-router"

export function clientLoader(): never {
  throw redirect("/")
}
