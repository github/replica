export interface ReviewActor {
  userId: string
  login: string
  name: string | null
}

export interface ReviewMessage {
  id: number
  storageId: string
  rootId: number | null
  body: string | null
  author: ReviewActor
  createdAt: Date
  updatedAt: Date
  editedAt: Date | null
  deletedAt: Date | null
  mentions?: { login: string; githubId?: number }[]
  reactions?: { content: string; count: number; viewerHasReacted: boolean }[]
}

export interface ReviewResolutionEvent {
  id: string
  sequence: number
  state: "resolved" | "reopened"
  actor: ReviewActor
  occurredAt: Date
}

export type ReviewOutcomeKind =
  "confirmed_fixed" | "still_present" | "not_applicable" | "needs_more_review"

export interface ReviewOutcome {
  id: string
  sequence: number
  kind: ReviewOutcomeKind
  buildNumber: number
  feedbackDigest: string
  resolutionEventId: string
  verifier: ReviewActor
  verifiedAt: Date
  stale: boolean
  staleReason:
    "feedback_changed" | "resolution_changed" | "thread_reopened" | "build_unavailable" | null
}

export interface ReviewThread {
  id: number
  storageId: string
  repositoryId: string
  prototype: {
    id: string
    name: string | null
    branch: string
  }
  buildNumber: number
  anchor: ReviewAnchor
  activityVersion: number
  viewerLastSeenActivityVersion?: number | null
  resolvedAt: Date | null
  resolvedBy: ReviewActor | null
  root: ReviewMessage
  replies: ReviewMessage[]
  feedbackDigest: string
  resolutionHistory: ReviewResolutionEvent[]
  outcomeHistory: ReviewOutcome[]
  createdAt: Date
  updatedAt: Date
}

export interface RepositoryReviewSnapshot {
  snapshotId: string
  capturedAt: Date
  repository: {
    id: string
    nameWithOwner: string
  }
  threads: ReviewThread[]
}

export type ReviewRouteActor = ReviewActor

export const reviewReactionContents = [
  "+1",
  "-1",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
] as const
export type ReviewReactionContent = (typeof reviewReactionContents)[number]
export interface ReviewMentionRecipient {
  recipientKey: string
  login: string
}

export interface ReviewMutationScope {
  sessionDigest: string
  repositoryId: string
  prototypeId: string
  actor: ReviewRouteActor
}

export interface ReviewCommentService {
  listPrototypeThreads(
    repositoryId: string,
    prototypeId: string,
    viewerId?: string,
  ): Promise<ReviewThread[]>
  createThread(input: {
    sessionDigest: string
    repositoryId: string
    prototypeId: string
    buildNumber: number
    body: unknown
    anchor: unknown
    actor: ReviewRouteActor
  }): Promise<ReviewThread>
  createReply(input: {
    sessionDigest: string
    repositoryId: string
    prototypeId: string
    threadId: number
    body: unknown
    actor: ReviewRouteActor
  }): Promise<ReviewThread>
  editComment(input: {
    sessionDigest: string
    repositoryId: string
    prototypeId: string
    commentId: number
    body: unknown
    actor: ReviewRouteActor
  }): Promise<ReviewThread>
  deleteComment(input: {
    sessionDigest: string
    repositoryId: string
    prototypeId: string
    commentId: number
    actor: ReviewRouteActor
  }): Promise<ReviewThread>
  setResolution(input: {
    sessionDigest: string
    repositoryId: string
    prototypeId: string
    threadId: number
    resolved: boolean
    actor: ReviewRouteActor
  }): Promise<ReviewThread>
  recordOutcome(input: {
    sessionDigest: string
    repositoryId: string
    prototypeId: string
    threadId: number
    buildNumber: number
    kind: ReviewOutcomeKind
    feedbackDigest: string
    resolutionEventId: string
    activityVersion: number
    actor: ReviewRouteActor & { membershipId?: string }
  }): Promise<ReviewThread>
  setReaction(
    input: ReviewMutationScope & {
      commentId: number
      content: ReviewReactionContent
      activityVersion: number
      add: boolean
    },
  ): Promise<ReviewThread>
  markThreadRead(
    input: ReviewMutationScope & {
      threadId: number
      activityVersion: number | null
    },
  ): Promise<ReviewThread>
}

export type ReviewAnchor = ElementReviewAnchor | AreaReviewAnchor

interface ReviewRoute {
  pathname: string
  search: string
  hash: string
}

interface ReviewRect {
  x: number
  y: number
  width: number
  height: number
}

interface ReviewViewport {
  width: number
  height: number
  scrollX: number
  scrollY: number
}

interface ElementReviewAnchor {
  schemaVersion: 1
  kind: "element"
  route: ReviewRoute
  selector: string
  accessibleName: string
  tagName: string
  selectedText: string
  rect: ReviewRect
  viewport: ReviewViewport
  elementOffset: { x: number; y: number }
}

interface AreaReviewAnchor {
  schemaVersion: 1
  kind: "area"
  route: ReviewRoute
  path: { x: number; y: number }[]
  rect: ReviewRect
  viewport: ReviewViewport
  elements: {
    selector: string
    accessibleName: string
    tagName: string
    role: string
    textExcerpt: string
    rect: ReviewRect
  }[]
}
