const registrationIneligibleTitle = "Branch not eligible for Hub registration"

export const publicationCopy = {
  heading: "Branch publication",
  checking: "Checking...",
  retry: "Retry status",
  retryPublish: "Retry publish",
  requested: "Requested",
  awaitingCopilot: "Waiting for Copilot",
  publishBranch: "Publish",
  publishChanges: "Publish changes",
  registration: "Publishing",
  registrationFailed: "Publication delayed",
  published: "Published",
  alreadyPublished: "Latest changes already published",
  queued: "Build queued",
  building: "Building",
  awaitingHub: "Awaiting Hub",
  awaitingBuild: "Awaiting build",
  connect: "Connect to the hub",
  workflowLink: "View workflow run",
  initial: "Checking branch publication.",
  checkingRemote: "Checking the exact branch on the origin repository.",
  detached: "Open a named branch before publishing.",
  changed: "The checkout changed. Refresh publication status.",
  unknown: (error?: string) =>
    `Remote branch status is unknown. ${error || "Check GitHub access and retry."}`,
  pending:
    "Copilot received the publish request in chat and has not pushed this branch yet. Follow its progress in chat.",
  checkingHub: "Checking the Hub connection.",
  disconnected: "Connect to the hub before publishing this prototype.",
  hubUnavailable: "Hub verification is unavailable. Restore access and retry.",
  hubUnavailableTitle: "Hub verification unavailable",
  staleHub: "The Hub status belongs to a different checkout. Refresh to continue.",
  workflowMissing:
    "This checkout has no .github/workflows/replica.yml. Set up the repository's Replica build workflow before publishing.",
  dispatchFailed: "Copilot could not receive the publish request.",
  absent: "This branch won't appear in the hub until you publish.",
  needsPush:
    "The remote branch points to a different commit. Publish pushes this branch without force.",
  localChanges: "Local changes are not in the published prototype. Choose how to publish them.",
  needsRegistration: "Hub imported this commit. The canvas is publishing it automatically.",
  registrationDenied:
    "Hub could not register this branch. Check repository access and branch eligibility.",
  registrationErrorTitle: "Hub registration failed",
  registrationReasons: new Map<string, { title: string; description: string }>([
    [
      "write_access_required",
      {
        title: registrationIneligibleTitle,
        description: "You lack write access to this repository.",
      },
    ],
    [
      "branch_not_reviewable",
      {
        title: registrationIneligibleTitle,
        description: "Default, reserved, and internal branches cannot be registered in Hub.",
      },
    ],
    [
      "remote_branch_missing",
      {
        title: registrationIneligibleTitle,
        description: "The branch no longer exists on the remote repository.",
      },
    ],
    [
      "branch_authorship_required",
      {
        title: registrationIneligibleTitle,
        description: "You have not authored a commit unique to this branch.",
      },
    ],
    [
      "repository_mismatch",
      {
        title: registrationIneligibleTitle,
        description: "The branch belongs to a different repository.",
      },
    ],
    [
      "already_registered",
      {
        title: "Branch already registered in Hub",
        description: "This branch is already registered in Hub. Refresh its status.",
      },
    ],
    [
      "successful_build_required",
      {
        title: "Hub registration delayed",
        description: "Hub has not imported this checkout's successful Build yet.",
      },
    ],
  ]),
  ready: "Hub imported this commit and the prototype is registered.",
  importFailed:
    "Hub could not import or build this commit. Pushing this unchanged commit does not rerun the failed work. Inspect the Build failure in Hub and repair the cause before publishing again.",
  workflowUnavailable: "Workflow status is unavailable. Check GitHub access and retry.",
  staleWorkflow: "Workflow status belongs to a different branch or commit.",
  workflowQueued: "The Replica workflow for this commit is queued or waiting.",
  workflowBuilding: "The Replica workflow is building this commit.",
  workflowFailed: (conclusion?: string) =>
    `The Replica workflow finished with ${conclusion || "an unsuccessful result"}. Pushing this unchanged commit does not rerun the failed work. Inspect the run and repair the cause before publishing again.`,
  importing:
    "The workflow succeeded. Waiting for Hub discovery and artifact import; this is not published yet.",
  noBuild:
    "The exact branch and commit are on GitHub, but no matching Replica workflow run has appeared yet.",
}
