export type PublishState =
  | "failed"
  | "in_progress"
  | "not_published"
  | "published"
  | "requested"
  | "unavailable"
  | "succeeded"

export type WorkflowRun = {
  databaseId?: number
  headSha?: string
  headBranch?: string
  status?: string
  conclusion?: string
  actor?: {
    avatarUrl?: string
    login?: string
    name?: string
  } | null
  actorError?: string
  updatedAt?: string
  url?: string
}

export type PrototypeState = {
  name: string
  sessionId?: string
  publishRequest?: {
    state: "idle" | "requested" | "in_progress" | "published" | "failed"
    requestedAt: string | null
    commitSha?: string | null
    remoteState?: NonNullable<PrototypeState["stats"]["remoteBranch"]>["state"]
    buildNumber?: number | null
    workflowRunId?: number | null
    error?: string | null
  }
  publishStatus?: {
    state: PublishState
    detail: string
    run?: WorkflowRun
    lastUpdatedAt?: string
    versionCount?: number
  }

  stats: {
    branch?: string
    branchError?: string | null
    comparison?: {
      branch: string | null
      source: "local" | "upstream" | null
      behind: number | null
      error: string | null
    }
    repository?: string
    commitSha?: string
    publishedUrl?: string
    workingTree?: string
    urlHost?: string
    refreshedAt?: string | null
    replicaWorkflowExists?: boolean
    remoteBranch?: {
      state: "loading" | "unknown" | "absent" | "present" | "detached"
      repository: string | null
      branch: string | null
      commitSha: string | null
      remoteSha?: string | null
      error?: string
    }
    workflow?: { state: PublishState; detail: string; run?: WorkflowRun | null }
  }
}

export type HubPrototype = {
  id: number
  repositoryId: number
  branch: string
  name: string | null
  description: string | null
  startPage?: string | null
  startPageSet?: boolean
  startPageImportError?: string | null
  viewerLogin: string
  registered: boolean
  canEdit: boolean
  canManageShareLinks?: boolean
  publicSharingEnabled?: boolean
  shareLinkExpirationOptions?: string[]
  canRegister: boolean
  registrationReason?: string | null
  published: boolean
  buildState: string | null
  currentBuild?: { commitSha: string; state: string } | null
  versionCount: number
  build: {
    url: string
    number: number
    commitSha: string
    publishedAt: string
    author: { login: string | null; name: string | null; avatarUrl: string | null }
  } | null
}

export type HubStatus = {
  repositoryAuthorized?: boolean
  viewerLogin?: string
  canPublish?: boolean
  localStartPage?: string | null
  localStartPageError?: string
  state:
    | "connected"
    | "disconnected"
    | "pairing"
    | "undiscovered"
    | "unavailable"
    | "unconfigured"
    | "denied"
  discovery?: {
    state: "valid" | "absent" | "invalid" | "unreachable" | "local"
    origin?: string
    sourceRevision?: string
    defaultBranch?: string
    message?: string
    mismatch?: boolean
    changed?: boolean
  }
  hubOrigin?: string
  repository?: string
  branch?: string
  commitSha?: string
  reviewRevision?: {
    id: number | null
    treeSha: string
    commitSha: string
    clean: boolean
    prototypeId: number | null
    repository?: string
    branch?: string
    buildNumber: number | null
    hubOrigin: string
    connectionId: string
  }
  reviewError?: string
  localCommentsError?: string
  prototype?: HubPrototype
  registrationError?: string
  registrationReason?: string
  pairing?: { verificationUrl: string; userCode: string }
  message?: string
}

export type CanvasConfig = {
  prototypeUrl: string | null
  previewUrl?: string
  name: string
  token: string
  monitorPrototype?: boolean
  improvementThreadsSample?: boolean
  pickAndPolish?: boolean
}

export type PublishPreparation = {
  target: {
    repository: string
    branch: string
    commitSha: string
    originFingerprint: string | null
    pushFingerprint: string | null
  }
  workingTree: "clean" | "changed" | "unavailable"
  workingTreeError?: string
  changes?: {
    files: PublishChangeList
    localSkills: PublishChangeList
  }
  remember: boolean
}

export type PublishChangeList = { paths: string[]; total: number }

export type PublishMode = "commit-changes" | "committed-only"
