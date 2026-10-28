import { plainText } from "../validate-controls/index.mjs"
import { readHubObject } from "../read-hub-object/index.mjs"

export type ControlsRuntimeStatus =
  "pending" | "ready" | "no-controls" | "missing-runtime" | "unsupported-runtime" | "invalid-config"

const STATUSES: ReadonlySet<unknown> = new Set<ControlsRuntimeStatus>([
  "pending",
  "ready",
  "no-controls",
  "missing-runtime",
  "unsupported-runtime",
  "invalid-config",
])

export type ControlsStatus = ReturnType<typeof projectControlsStatus>
export type ControlDiagnostic = ReturnType<typeof projectControls>[number]

function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit
}

function status(value: unknown): value is ControlsRuntimeStatus {
  return STATUSES.has(value)
}

/** Projects runtime diagnostics without forwarding definitions, values or app callback results. */
export function projectControlsStatus(input: unknown, prototypeUrl?: string) {
  const value = readHubObject(input)
  const url = typeof value?.url === "string" ? URL.parse(value.url) : null
  if (
    !value ||
    !url ||
    (prototypeUrl && url.origin !== new URL(prototypeUrl).origin) ||
    url.username ||
    url.password ||
    !text(value.url, 16_384) ||
    !status(value.status) ||
    !text(value.error, 1000) ||
    !Array.isArray(value.controls) ||
    value.controls.length > 10_000 ||
    (value.status === "pending" && value.controls.length)
  )
    throw new Error("The live canvas returned invalid Controls status.")
  const controls = projectControls(value.controls)
  let runtime
  if (value.runtime !== undefined) {
    const reported = readHubObject(value.runtime)
    if (
      !reported ||
      !status(reported.status) ||
      !text(reported.error, 1000) ||
      !Array.isArray(reported.controls) ||
      reported.controls.length > 10_000 ||
      (reported.status === "pending" && reported.controls.length)
    )
      throw new Error("The live canvas returned invalid runtime Controls diagnostics.")
    runtime = {
      status: reported.status,
      error: plainText(reported.error, 1000),
      controls: projectControls(reported.controls),
    }
  }
  return {
    status: value.status,
    url: url.href,
    origin: url.origin,
    route: { pathname: url.pathname, search: url.search, hash: url.hash },
    error: plainText(value.error, 1000),
    controls,
    ...(runtime ? { runtime } : {}),
  }
}

function projectControls(controls: unknown[]) {
  return controls.map((input) => {
    const control = readHubObject(input)
    if (
      !control ||
      !text(control.scope, 64) ||
      !text(control.id, 64) ||
      typeof control.available !== "boolean" ||
      typeof control.busy !== "boolean" ||
      typeof control.visible !== "boolean" ||
      !text(control.error, 500)
    )
      throw new Error("The live canvas returned invalid control diagnostics.")
    return {
      scope: control.scope,
      id: control.id,
      available: control.available,
      busy: control.busy,
      visible: control.visible,
      error: plainText(control.error, 500),
    }
  })
}
