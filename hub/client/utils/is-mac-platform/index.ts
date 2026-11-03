export function isMacPlatform() {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
}
