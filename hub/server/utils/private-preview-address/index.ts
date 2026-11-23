const identity = "[1-9][0-9]{0,18}"
const pathPattern = new RegExp(`^/previews/github/(${identity})/(${identity})/(.*)$`)
const maximumId = 9_223_372_036_854_775_807n

export function privatePreviewAddress(repositoryId: string, runId: string) {
  const valid = new RegExp(`^${identity}$`)
  if (
    !valid.test(repositoryId) ||
    !valid.test(runId) ||
    BigInt(repositoryId) > maximumId ||
    BigInt(runId) > maximumId
  ) {
    return null
  }
  const key = `${repositoryId}/${runId}`
  return {
    repositoryId,
    runId,
    mount: `/previews/github/${key}/`,
    launch: `/api/private-preview/launch/${key}`,
    begin: `/__replica/begin/${key}`,
    exchange: `/__replica/exchange/${key}`,
  }
}

export function readPrivatePreviewAddress(path: string) {
  const match = pathPattern.exec(path)
  if (!match) return null
  const address = privatePreviewAddress(match[1]!, match[2]!)
  return address && { address, relativePath: match[3]! }
}

export type PrivatePreviewAddress = NonNullable<ReturnType<typeof privatePreviewAddress>>
