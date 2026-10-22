export function readHubObject(value) {
  if (isObject(value)) return value
  return undefined
}
function isObject(value) {
  return value !== null && typeof value === "object"
}
