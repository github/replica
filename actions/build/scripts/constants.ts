export const ARTIFACT_NAME = "replica-build-v1"
export const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
}
export const MAX_ENTRIES = 2_000
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_PATH_DEPTH = 20
export const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024
export const MAX_SCREENSHOT_HEIGHT = 16_384
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024
export const MAX_PACKAGE_BYTES = 150 * 1024 * 1024
export const MAX_TEMPLATES = 12
export const MAX_TEMPLATE_MANIFEST_BYTES = 16 * 1024
export const START_ROUTE = "/"
export const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "narrow", width: 390, height: 844 },
]
