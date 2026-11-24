import viewports from "../../../hub/client/utils/screenshot-viewports/viewports.json" with { type: "json" }

export const ARTIFACT_NAME = "replica-build-v1"
export const SCREENSHOTS_ARTIFACT_NAME = "replica-screenshots-v1"
export const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
}
export const MAX_ENTRIES = 2_000
export const MAX_FILE_BYTES = 100 * 1024 * 1024
export const MAX_PATH_DEPTH = 20
export const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024
export const MAX_SCREENSHOT_HEIGHT = 16_384
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024
export const MAX_PACKAGE_BYTES = 150 * 1024 * 1024
export const MAX_TEMPLATES = 12
export const MAX_TEMPLATE_MANIFEST_BYTES = 16 * 1024
export const START_ROUTE = "/"
export const VIEWPORTS = Object.entries(viewports).map(([name, dimensions]) => ({
  name,
  ...dimensions,
}))
