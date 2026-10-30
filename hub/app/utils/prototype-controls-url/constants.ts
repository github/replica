export const controlsUrlLimit = 8192
export const controlsUrlEvent = "replica:controls:url"
export const controlParameter = /^rc\.([a-zA-Z][a-zA-Z0-9_-]{0,63})\.([a-zA-Z][a-zA-Z0-9_-]{0,63})$/
export type ControlValues = Record<string, Record<string, unknown>>
