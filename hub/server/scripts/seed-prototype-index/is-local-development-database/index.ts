const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"])

export function isLocalDevelopmentDatabase(environment: NodeJS.ProcessEnv): boolean {
  const url = environment.DATABASE_URL
  const address = url ? URL.parse(url) : null
  if (
    environment.NODE_ENV !== "development" ||
    !address ||
    !["postgres:", "postgresql:"].includes(address.protocol)
  ) {
    return false
  }
  if (localHosts.has(address.hostname)) return true
  return (
    environment.REPLICA_DEVCONTAINER === "true" &&
    address.hostname === "db" &&
    address.port === "5432" &&
    address.username === "replica" &&
    address.password === "replica" &&
    address.pathname === "/replica"
  )
}
