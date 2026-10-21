import type { HubStatus, PrototypeState, PublishPreparation } from "../prototype-canvas/types"

export function publishPreparation(state: PrototypeState, remember = false): PublishPreparation {
  return {
    target: {
      repository: state.stats.repository!,
      branch: state.stats.branch!,
      commitSha: state.stats.commitSha!,
      originFingerprint: null,
      pushFingerprint: null,
    },
    workingTree: state.stats.workingTree === "changed" ? "changed" : "clean",
    remember,
  }
}

const sha = "a".repeat(40)
export const publicationState: PrototypeState = {
  name: "Welcome prototype",
  stats: {
    repository: "github/example",
    branch: "prototype/welcome",
    commitSha: sha,
    workingTree: "clean",
    replicaWorkflowExists: true,
    remoteBranch: {
      state: "present",
      repository: "github/example",
      branch: "prototype/welcome",
      commitSha: sha,
      remoteSha: sha,
    },
    workflow: { state: "not_published", detail: "No matching run", run: null },
  },
}
export const publicationHub: HubStatus = {
  state: "undiscovered",
  canPublish: true,
  repository: "github/example",
  branch: "prototype/welcome",
  commitSha: sha,
  hubOrigin: "https://hub.example.com",
  reviewRevision: {
    id: null,
    treeSha: "c".repeat(40),
    commitSha: sha,
    clean: true,
    prototypeId: 1,
    repository: "github/example",
    branch: "prototype/welcome",
    buildNumber: 1,
    hubOrigin: "https://hub.example.com",
    connectionId: "fixture-review-connection",
  },
  discovery: { state: "valid", origin: "https://hub.example.com", defaultBranch: "main" },
}
export const importedPrototype: NonNullable<HubStatus["prototype"]> = {
  id: 1,
  repositoryId: 1,
  branch: "prototype/welcome",
  name: "Welcome",
  description: null,
  viewerLogin: "octocat",
  registered: true,
  canEdit: true,
  canRegister: true,
  published: true,
  buildState: "successful",
  versionCount: 1,
  currentBuild: { commitSha: sha, state: "successful" },
  build: {
    commitSha: sha,
    number: 1,
    publishedAt: "2026-09-28T10:00:00Z",
    url: "https://hub.example.com/prototypes/1",
    author: { login: "octocat", name: null, avatarUrl: null },
  },
}
const run = {
  headSha: sha,
  headBranch: "prototype/welcome",
  url: "https://github.com/github/example/actions/runs/1",
}

export const publicationExamples: Record<
  string,
  { state: PrototypeState | null; hub: HubStatus | null }
> = {
  Loading: { state: null, hub: null },
  "Unpublished branch": {
    state: {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        workingTree: "changed",
        comparison: { branch: "origin/old-name", source: "upstream", behind: 0, error: null },
        remoteBranch: { ...publicationState.stats.remoteBranch!, state: "absent", remoteSha: null },
      },
    },
    hub: publicationHub,
  },
  "Unpushed changes": {
    state: {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        remoteBranch: { ...publicationState.stats.remoteBranch!, remoteSha: "b".repeat(40) },
      },
    },
    hub: publicationHub,
  },
  "Waiting for Copilot": {
    state: {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        remoteBranch: { ...publicationState.stats.remoteBranch!, remoteSha: "b".repeat(40) },
      },
      publishRequest: {
        state: "requested",
        requestedAt: new Date().toISOString(),
        commitSha: sha,
      },
    },
    hub: publicationHub,
  },
  "Publish blocked": {
    state: {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        remoteBranch: { ...publicationState.stats.remoteBranch!, remoteSha: "b".repeat(40) },
      },
      publishRequest: {
        state: "failed",
        requestedAt: null,
        commitSha: sha,
        error:
          "Copilot stopped before pushing because publishing was blocked. The branch cannot fast-forward origin.",
      },
    },
    hub: publicationHub,
  },
  "Awaiting build": { state: publicationState, hub: publicationHub },
  "Build queued": {
    state: {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        workflow: { state: "in_progress", detail: "Queued", run: { ...run, status: "queued" } },
      },
    },
    hub: publicationHub,
  },
  Building: {
    state: {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        workflow: {
          state: "in_progress",
          detail: "Building",
          run: { ...run, status: "in_progress" },
        },
      },
    },
    hub: publicationHub,
  },
  "Build failed": {
    state: {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        workflow: {
          state: "failed",
          detail: "Failure",
          run: { ...run, status: "completed", conclusion: "failure" },
        },
      },
    },
    hub: publicationHub,
  },
  "Awaiting Hub import": {
    state: {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        workflow: {
          state: "succeeded",
          detail: "Success",
          run: { ...run, status: "completed", conclusion: "success" },
        },
      },
    },
    hub: publicationHub,
  },
  "Automatic publication": {
    state: publicationState,
    hub: {
      ...publicationHub,
      state: "connected",
      prototype: { ...importedPrototype, registered: false, published: false },
    },
  },
  "Automatic publication failed": {
    state: publicationState,
    hub: {
      ...publicationHub,
      state: "connected",
      prototype: { ...importedPrototype, registered: false, published: false },
      registrationError: "Automatic prototype registration failed: Hub returned HTTP 404.",
    },
  },
  "Write access required": {
    state: publicationState,
    hub: {
      ...publicationHub,
      state: "connected",
      prototype: {
        ...importedPrototype,
        registered: false,
        published: false,
        canEdit: false,
        canRegister: false,
        registrationReason: "write_access_required",
      },
    },
  },
  "Missing remote branch": {
    state: {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        remoteBranch: {
          ...publicationState.stats.remoteBranch!,
          state: "absent",
          remoteSha: null,
        },
      },
    },
    hub: {
      ...publicationHub,
      state: "connected",
      prototype: {
        ...importedPrototype,
        registered: false,
        published: false,
        canRegister: false,
        registrationReason: "remote_branch_missing",
      },
    },
  },
  "Unknown registration reason": {
    state: publicationState,
    hub: {
      ...publicationHub,
      state: "connected",
      prototype: {
        ...importedPrototype,
        registered: false,
        published: false,
        canRegister: false,
        registrationReason: "future_registration_rule",
      },
    },
  },
  "Registration awaiting Build": {
    state: publicationState,
    hub: {
      ...publicationHub,
      state: "connected",
      prototype: { ...importedPrototype, registered: false, published: false },
      registrationReason: "successful_build_required",
      registrationError:
        "Automatic prototype registration failed: Hub has not imported this checkout's successful Build yet.",
    },
  },
  Published: {
    state: publicationState,
    hub: { ...publicationHub, state: "connected", prototype: importedPrototype },
  },
  "Remote check failed": {
    state: {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        remoteBranch: {
          ...publicationState.stats.remoteBranch!,
          state: "unknown",
          error: "GitHub authentication expired. Sign in with gh and retry.",
        },
      },
    },
    hub: publicationHub,
  },
  "Detached checkout": {
    state: {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        branch: undefined,
        remoteBranch: { ...publicationState.stats.remoteBranch!, state: "detached", branch: null },
      },
    },
    hub: publicationHub,
  },
  Disconnected: { state: publicationState, hub: { ...publicationHub, state: "disconnected" } },
  "Expired connection": {
    state: publicationState,
    hub: {
      ...publicationHub,
      state: "disconnected",
      message: "The Hub connection expired or was revoked.",
    },
  },
  "Hub import failed": {
    state: publicationState,
    hub: {
      ...publicationHub,
      state: "connected",
      prototype: {
        ...importedPrototype,
        build: null,
        published: false,
        currentBuild: { commitSha: sha, state: "failed" },
      },
    },
  },
  "Workflow check failed": {
    state: {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        workflow: {
          state: "unavailable",
          detail: "GitHub could not verify workflow runs. Sign in and retry.",
        },
      },
    },
    hub: publicationHub,
  },
  "Workflow missing": {
    state: {
      ...publicationState,
      stats: { ...publicationState.stats, replicaWorkflowExists: false },
    },
    hub: publicationHub,
  },
}
