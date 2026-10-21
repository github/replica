export const copy = {
  title: "Checks",
  loading: "Loading checks",
  error: "Check status is unavailable",
  unconfigured: "No checks configured",
  noPages: "No applicable checks",
  scope: "Confirm affected pages",
  failed: "failed",
  unverified: "unverified",
  statuses: {
    not_run: "not run",
    queued: "queued",
    running: "running",
    execution_error: "could not finish",
    cancelled: "cancelled",
    out_of_date: "out of date",
  },
  description: (passed: number, total: number, details: string) =>
    `Prototype checks: ${passed} of ${total} passed${details ? `. ${details}` : ""}`,
}
