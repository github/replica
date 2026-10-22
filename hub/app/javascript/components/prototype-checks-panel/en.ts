export const checksCopy = {
  title: "Prototype checks",
  close: "Close prototype checks",
  loading: "Loading checks...",
  unconfigured:
    "Add .replica/checks.json to define this repository's checks, assessment inputs and guidance.",
  outdated: "Out of date",
  error: "Checks need attention",
  runAll: "Run all",
  run: "Run",
  retry: "Retry",
  cancel: "Cancel",
  cancelAll: "Cancel all",
  reset: "Reset saved results",
  fix: "Fix selected with Copilot",
  requested: "Fix requested in chat",
  criteria: "What was checked",
  criterionStatus: {
    pass: "Passed",
    fail: "Failed",
    unverified: "Needs verification",
  },
  coverageReason: {
    not_recorded:
      "Read coverage was not recorded. Run this check again to verify its source coverage.",
    incomplete:
      "Required source was not fully read. See Read coverage for missing or partial files.",
    no_source: "No required source files were available for this check.",
  },
  selectForFix: (title: string) => `Select ${title} for a fix`,
  severity: { error: "Error", warning: "Warning", info: "Information" },
  limitations: "Not verified",
  automatic: "Automatic after edits",
  manual: "Manual",
  status: {
    not_run: "Not run",
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    execution_error: "Execution error",
    cancelled: "Cancelled",
    out_of_date: "Out of date",
  },
}
