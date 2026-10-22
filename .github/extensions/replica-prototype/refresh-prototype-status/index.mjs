import { getPrototypeState } from "../get-prototype-state/index.mjs"
export async function refreshPrototypeStatus(context) {
  return getPrototypeState(context, { refresh: true })
}
