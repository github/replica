export const maxLogBytes = 8192
export const maxLogDepth = 6
export const maxLogEntries = 100
export const maxLogStringLength = 2048
export const maxLogKeyLength = 128
export const truncationMarker = "[TRUNCATED]"
export const sensitiveLogKeyPattern =
  /(password|passwd|passphrase|secret|token|authorization|cookie|apikey|privatekey|sessionid)/
export const sensitiveRequestLogKeyPattern =
  /(?:password|passwd|passphrase|secret|token|authorization|cookie|apikey|privatekey|sessionid|^(?:code|state|nonce|codeverifier)$)/
