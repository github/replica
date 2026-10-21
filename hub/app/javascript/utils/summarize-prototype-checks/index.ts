import type { ChecksState } from "@utils/prototype-checks/types"

import { copy } from "./en"

export function summarizePrototypeChecks(state?: ChecksState | null, error?: string | null) {
  const checks = (state?.checks ?? []).filter((check) => check.status !== "not_applicable")
  const unavailable = !!error || state?.state === "error"
  const confirmed = state?.state === "ready" && !unavailable
  const passed = confirmed
    ? checks.filter((check) => check.status === "completed" && check.outcome === "pass").length
    : 0
  const failed = checks.filter(
    (check) => check.status === "completed" && check.outcome === "fail",
  ).length
  const unverified = checks.filter(
    (check) => check.status === "completed" && check.outcome !== "pass" && check.outcome !== "fail",
  ).length
  const running = checks.some((check) => ["queued", "running"].includes(check.status))
  const loading = !state || state.state === "loading"
  const warning =
    unavailable ||
    state?.state === "scope_required" ||
    unverified > 0 ||
    checks.some((check) => check.status === "execution_error")
  const status = unavailable
    ? "warning"
    : loading || running
      ? "running"
      : confirmed && failed
        ? "failed"
        : warning
          ? "warning"
          : checks.length > 0 && passed === checks.length
            ? "passed"
            : "neutral"
  const details = [
    ...(confirmed
      ? [
          ...(failed ? [`${failed} ${copy.failed}`] : []),
          ...(unverified ? [`${unverified} ${copy.unverified}`] : []),
        ]
      : []),
    ...Object.entries(copy.statuses).flatMap(([key, label]) => {
      const count = checks.filter((check) => check.status === key).length
      return count ? [`${count} ${label}`] : []
    }),
  ].join("; ")
  const explanation = unavailable
    ? copy.error
    : loading
      ? copy.loading
      : state.state === "unconfigured"
        ? copy.unconfigured
        : state.state === "scope_required"
          ? copy.scope
          : checks.length === 0
            ? copy.noPages
            : details

  return {
    label: checks.length ? `${passed}/${checks.length}` : copy.title,
    description: copy.description(passed, checks.length, explanation),
    status,
  } as const
}
