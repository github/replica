export function readTrustedProxyHops(environment: NodeJS.ProcessEnv): number {
  const value = environment.HUB_TRUSTED_PROXY_HOPS ?? "0"
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error("HUB_TRUSTED_PROXY_HOPS must be an integer from 0 through 10.")
  }
  const hops = Number(value)
  if (hops > 10) {
    throw new Error("HUB_TRUSTED_PROXY_HOPS must be an integer from 0 through 10.")
  }
  return hops
}
