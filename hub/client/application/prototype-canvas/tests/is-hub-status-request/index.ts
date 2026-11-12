/** Lets integration fixtures distinguish Hub reads from prototype state reads. */
export function isHubStatusRequest(input: RequestInfo | URL) {
  const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  return ["/api/hub/status", "/api/hub/open", "/api/hub/activity"].includes(path)
}
