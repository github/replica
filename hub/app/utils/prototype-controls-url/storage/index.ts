import { validControlsValues } from "../../prototype-controls-protocol/valid-values"
import { controlsUrlEvent, type ControlValues } from "../constants"
import { readControlQuery } from "../read-control-query"
import { encodeControlValues } from "../encode-control-values"
import { withControlQuery } from "../with-control-query"

export function urlControlsStorage(
  identity: string,
  address = () => window.location.href,
  replace = (destination: string) => {
    window.history.replaceState(window.history.state, "", destination)
    window.dispatchEvent(new Event(controlsUrlEvent))
  },
) {
  return (options?: RequestInit): Promise<unknown> =>
    Promise.resolve().then(() => {
      options?.signal?.throwIfAborted()
      const saved = readControlQuery(new URL(address()).search)
      if (!options) return { identity, ...saved }
      if (options.method !== "POST" || typeof options.body !== "string")
        throw new Error("Invalid URL controls request.")
      const input: unknown = JSON.parse(options.body)
      if (
        !input ||
        typeof input !== "object" ||
        !("identity" in input) ||
        input.identity !== identity
      )
        throw new Error("The controls URL identity changed.")
      let scopes = saved.scopes
      if ("reset" in input && input.reset === true) scopes = {}
      else if ("replace" in input && input.replace === true && "scopes" in input) {
        if (!input.scopes || typeof input.scopes !== "object" || Array.isArray(input.scopes))
          throw new Error("Invalid controls history settings.")
        const historyScopes: ControlValues = {}
        for (const [scope, values] of Object.entries(input.scopes)) {
          if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(scope) || !validControlsValues(values))
            throw new Error("Invalid controls history settings.")
          historyScopes[scope] = values
        }
        const validated = readControlQuery(encodeControlValues(historyScopes))
        scopes = validated.scopes
      } else {
        if (
          !("scope" in input) ||
          typeof input.scope !== "string" ||
          !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(input.scope) ||
          !("values" in input) ||
          !validControlsValues(input.values)
        )
          throw new Error("Invalid URL control settings.")
        scopes = { ...scopes, [input.scope]: input.values }
      }
      const destination = withControlQuery(address(), encodeControlValues(scopes))
      if (destination !== address()) replace(destination)
    })
}
