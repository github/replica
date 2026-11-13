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
}

export interface ReviewResolutionEvent {
  id: string
  sequence: number
  state: "resolved" | "reopened"
  actor: ReviewActor
  occurredAt: Date
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
  resolvedAt: Date | null
  resolvedBy: ReviewActor | null
  root: ReviewMessage
  replies: ReviewMessage[]
  resolutionHistory: ReviewResolutionEvent[]
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

export interface ReviewCommentService {
  listPrototypeThreads(repositoryId: string, prototypeId: string): Promise<ReviewThread[]>
  createThread(input: {
    repositoryId: string
    prototypeId: string
    buildNumber: number
    body: unknown
    anchor: unknown
    actor: ReviewRouteActor
  }): Promise<ReviewThread>
  createReply(input: {
    repositoryId: string
    prototypeId: string
    threadId: number
    body: unknown
    actor: ReviewRouteActor
  }): Promise<ReviewThread>
  editComment(input: {
    repositoryId: string
    prototypeId: string
    commentId: number
    body: unknown
    actor: ReviewRouteActor
  }): Promise<ReviewThread>
  deleteComment(input: {
    repositoryId: string
    prototypeId: string
    commentId: number
    actor: ReviewRouteActor
  }): Promise<ReviewThread>
  setResolution(input: {
    repositoryId: string
    prototypeId: string
    threadId: number
    resolved: boolean
    actor: ReviewRouteActor
  }): Promise<ReviewThread>
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
