export const publishChangesCopy = {
  title: "Publish uncommitted changes?",
  description:
    "Do you want to commit changes before publishing? Publishing the committed version only excludes your local uncommitted edits.",
  checkFailedTitle: "Could not check local changes",
  checkFailed: "Git could not check local changes.",
  retryCheck: "Retry check",
  commit: "Commit changes & publish",
  committed: "Publish committed version only",
  close: "Close publishing dialog",
  changedFiles: "Uncommitted changes",
  moreChanges: (count: number) => `${count} more`,
  localSkills: (count: number) =>
    `${count} local agent skill ${count === 1 ? "file stays" : "files stay"} uncommitted.`,
  selection:
    "Copilot commits only changes related to this prototype task and asks if it cannot tell which changes belong.",
  remember: "Always commit changes before publishing for this prototype",
  settings: "Settings",
  alwaysCommit: "Always commit changes before publishing",
  retrySettings: "Retry settings",
  preferenceTargetChanged: "The checkout changed. Refresh Settings and try again.",
  invalidPreference: "Publishing settings returned an invalid response. Retry settings.",
}
