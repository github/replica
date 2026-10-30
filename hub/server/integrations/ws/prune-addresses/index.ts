import type { RealtimeState } from "../types.ts"

export function pruneAddresses({ addresses }: RealtimeState) {
  const now = Date.now()
  for (const [address, state] of addresses) {
    if (state.connections === 0 && state.windowEndsAt <= now) addresses.delete(address)
  }
}
