// Types for @github/replica-learning. The JSON Schemas in contracts/v1 are normative; these
// declarations describe the same shapes for TypeScript callers and adapter authors.

export type Digest = `sha256:${string}`
export type Timestamp = string
export type Purpose =
  "review" | "instruction" | "evaluation" | "analytics" | "training" | "publication"
export type MemoryKind =
  "fact" | "preference" | "rule" | "procedure" | "example" | "anti_pattern" | "design_principle"
export type MemoryState = "proposed" | "accepted" | "rejected" | "retired"
export type Stream =
  | "episodes"
  | "events"
  | "grants"
  | "withdrawals"
  | "collections"
  | "audit"
  | "exports"
  | "guidance"
  | "deliveries"
  | "usageReports"
  | "usedLearnings"
  | "screenshots"
  | "scores"
  | "updateProposals"
  | "updateDecisions"

/** The coding agent session asking for guidance or reporting its use. */
export interface AgentSessionRef {
  id: string
  label?: string
}

/** A screenshot an agent took, as the store receives it; only its digest is recorded. */
export interface UsageScreenshot {
  route: string
  viewport: { width: number; height: number }
  theme: string
  capturedAt: Timestamp
  /** PNG bytes, at most 10 MB */
  bytes: Uint8Array
}

/** What a deletion removed: records per stream, and learning versions. */
export interface DeletionResult {
  records: Partial<Record<Stream, number>>
  memories: number
}

export interface Scope {
  /** lowercase Git or Hub host, such as github.com; the same owner/name on two hosts never shares records */
  host?: string
  organization?: string
  team?: string
  /** owner/name in lowercase */
  repository?: string
  product?: string
}

export interface Actor {
  kind: "human" | "agent" | "system" | "service"
  /** such as github:octocat or agent:copilot */
  id: string
  /** Mutable display metadata, never the reviewer's identity or quorum key. */
  login?: string
  role?: string
  model?: string
  /** true when the host could not authenticate the identity */
  asserted?: boolean
}

/** Who is acting and in which scope. Hosts derive scope from the caller's own access. */
export interface LearningContext {
  scope: Scope
  principal: Actor
  /** Source repository name, authenticated by the host when it differs from the scope. */
  sourceRepository?: string
}

export interface SourcePin {
  kind: string
  hubOrigin?: string
  repository?: string
  repositoryId?: number | string
  prototypeId?: number | string
  prototypeName?: string
  branch?: string
  buildNumber?: number
  buildId?: number
  commitSha?: string
  threadId?: number
  commentId?: number
  sessionId?: string
}

export interface EvidenceRef {
  episodeId: string
  eventIds: string[]
  source?: SourcePin
  observedAt?: Timestamp
  author?: Actor
  artifacts?: Array<{
    kind: string
    uri?: string
    digest?: Digest
    mediaType?: string
  }>
}

export interface Episode {
  schemaVersion: "replica.episode/v1"
  id: string
  scope: Scope
  source: SourcePin
  task?: { prompt?: string; goal?: string; role?: string; taskId?: string }
  actors: Actor[]
  versions?: {
    model?: string
    harness?: string
    designSystem?: string
    brandPack?: string
    memorySnapshot?: Digest
  }
  grants: string[]
  contentTrust?: { untrusted: boolean; treatAs: "data"; source?: string }
  provenance: Provenance
  startedAt: Timestamp
  endedAt?: Timestamp
  outcome?: {
    status: "success" | "failure" | "partial" | "unknown"
    summary?: string
  }
  timeline?: EpisodeEvent[]
  digest: Digest
}

export interface EpisodeEvent {
  schemaVersion: "replica.event/v1"
  id: string
  episodeId: string
  scope: Scope
  type: string
  at: Timestamp
  actor: Actor
  payload?: Record<string, unknown>
  payloadDigest: Digest
  /** required on labels and retractions: the event they target, matching the payload and kept through redaction */
  parentEventId?: string
  supersedes?: string
  artifactRefs?: EvidenceRef["artifacts"]
  evidenceRefs?: EvidenceRef[]
  /** commentId: for a review comment, the Hub comment it was a version of */
  redaction?: { at: Timestamp; by: Actor; reason: string; commentId?: number }
  digest: Digest
}

export interface Provenance {
  producer: { name: string; version: string }
  method: string
  createdAt: Timestamp
  createdBy: Actor
  inputs?: Digest[]
}

export interface ConsentGrant {
  schemaVersion: "replica.consent-grant/v1"
  id: string
  scope: Scope
  purposes: Purpose[]
  sources: string[]
  grantedBy: Actor
  grantedAt: Timestamp
  expiresAt?: Timestamp
  evidenceFrom?: Timestamp
  evidenceUntil?: Timestamp
  basis: string
  digest: Digest
}

export interface GrantWithdrawal {
  schemaVersion: "replica.grant-withdrawal/v1"
  id: string
  grantId: string
  scope: Scope
  purposes: Purpose[]
  withdrawnBy: Actor
  withdrawnAt: Timestamp
  reason?: string
  digest: Digest
}

export interface CollectionFilters {
  resolution: "all" | "unresolved" | "resolved"
  read: "all" | "unread" | "read"
  from: Timestamp | null
  to: Timestamp | null
}

export interface Collection {
  schemaVersion: "replica.collection/v1"
  id: string
  source: SourcePin
  scope: Scope
  snapshotId: string
  /** the snapshot's normalized contents; importing the same snapshotId again must match it */
  snapshotDigest: Digest
  /** This Hub source has adopted stable reviewer IDs; legacy identities serve review only. */
  reviewerIdentity?: "stable-user-id"
  capturedAt: Timestamp
  reviewerIdentity?: "stable-user-id"
  filters: CollectionFilters
  complete: boolean
  problems: string[]
  counts: {
    threads: number
    messages: number
    episodes: number
    events: number
  }
  importedAt: Timestamp
  importedBy: Actor
  digest: Digest
}

export interface AuditEntry {
  schemaVersion: "replica.audit/v1"
  id: string
  at: Timestamp
  actor: Actor
  operation: string
  scope: Scope
  purpose?: Purpose
  subjects: Array<{ kind: string; id: string; digest?: Digest }>
  outcome: "ok" | "refused"
  reason?: string
  provider: { id: string; version: string }
  digest: Digest
}

export interface ExportManifest {
  schemaVersion: "replica.export/v1"
  id: string
  purpose: Purpose
  scope: Scope
  createdAt: Timestamp
  createdBy: Actor
  provider: { id: string; version: string }
  destination: string
  /** all: grants, collections, episodes with their events, and learnings. learnings: accepted learnings and the grants that permit their evidence. Absent means all. */
  contents?: "all" | "learnings"
  counts: {
    collections?: number
    episodes: number
    events: number
    memories: number
    grants: number
  }
  completeEpisodeIds?: string[]
  completeViews?: string[]
  completePrototypes?: string[]
  excluded: Array<{ reason: string; count: number }>
  records: Array<{
    kind: "collection" | "episode" | "event" | "memory" | "grant"
    id: string
    digest: Digest
  }>
  digest: Digest
}

export interface AgentSession {
  id: string
  label?: string
}

/** One recall an agent asked for. */
export interface Guidance {
  schemaVersion: "replica.guidance/v1"
  id: string
  scope: Scope
  requestedAt: Timestamp
  requestedBy: Actor
  via: "local" | "hub"
  session?: AgentSession
  digest: Digest
}

/** One learning a recall gave an agent, at its place in the guidance. */
export interface DeliveredLearning {
  schemaVersion: "replica.delivered-learning/v1"
  id: string
  scope: Scope
  guidanceId: string
  memoryId: string
  contentDigest: Digest
  sourceScope: Scope
  position: number
  text: string
  deliveredAt: Timestamp
  digest: Digest
}

/** An agent's report of which delivered learnings it used in a commit. */
export interface UsageReport {
  schemaVersion: "replica.usage-report/v1"
  id: string
  scope: Scope
  reportId: string
  guidanceIds: string[]
  session?: AgentSession
  commitSha: string
  prototypeId?: string
  contentDigest: Digest
  reportedBy: Actor
  reportedAt: Timestamp
  digest: Digest
}

/** One delivered learning a usage report says the agent used. */
export interface UsedLearning {
  schemaVersion: "replica.used-learning/v1"
  id: string
  scope: Scope
  usageReportId: string
  deliveryId: string
  memoryId: string
  claimedBy: Actor
  beforeScreenshotId?: string
  afterScreenshotId?: string
  reportedAt: Timestamp
  digest: Digest
}

/** A screenshot as usageForCommit lists it, without the image. */
export type UsedScreenshot = Pick<
  ScreenshotRecord,
  "sha256" | "route" | "viewport" | "theme" | "capturedAt" | "consentGrantId"
>

/** A screenshot's capture details. The image stays on the machine, named by sha256. */
export interface ScreenshotRecord {
  schemaVersion: "replica.screenshot/v1"
  id: string
  scope: Scope
  usageReportId: string
  sha256: Digest
  role: "before" | "after"
  route: string
  viewport: { width: number; height: number }
  theme: string
  capturedAt: Timestamp
  consentGrantId?: string
  digest: Digest
}

/** How an evaluator scored one used learning, and the Copilot route it scored with. */
export interface ScoreRecord {
  schemaVersion: "replica.score/v1"
  id: string
  scope: Scope
  usedLearningId: string
  usageReportId: string
  memoryId: string
  operationId: string
  rubricVersion: "replica.efficiency-rubric/v1"
  efficiency: 1 | 2 | 3 | 4
  followed: "followed" | "not_followed" | "unclear"
  reasoning: string
  /** Present for an efficiency of 1 or 2. */
  issue?: string
  inputs: Array<"screenshots" | "build_diff" | "reviewer_verification">
  route: ScoreRoute
  scoredBy: Actor
  scoredAt: Timestamp
  digest: Digest
}

/** Suggested new wording for one learning version, kept until a person decides. */
export interface UpdateProposalRecord {
  schemaVersion: "replica.update-proposal/v1"
  id: string
  scope: Scope
  memoryId: string
  version: number
  versionDigest: Digest
  issueKey: string
  issue: string
  title?: string
  content: string
  reasoning: string
  /** Scores that showed the issue. */
  support: string[]
  /** Scores of the same version that went well. */
  counter: string[]
  route: ScoreRoute
  proposedBy: Actor
  proposedAt: Timestamp
  digest: Digest
}

/** A person's decision on one update proposal. */
export interface UpdateDecisionRecord {
  schemaVersion: "replica.update-decision/v1"
  id: string
  scope: Scope
  proposalId: string
  memoryId: string
  decision: "applied" | "dismissed"
  /** The version the applied wording became. */
  appliedVersion?: number
  reason: string
  decidedBy: Actor
  decidedAt: Timestamp
  digest: Digest
}

/**
 * An update proposal as a person sees it, with its state. Its wording is withheld, and the
 * proposal is stale, once a score behind it may no longer be read.
 */
export type LearningUpdate = {
  id: string
  memoryId: string
  version: number
  issueKey: string
  support: string[]
  counter: string[]
  proposedAt: Timestamp
  state: "open" | "applied" | "dismissed" | "stale"
  decision?: { reason: string; decidedBy: Actor; decidedAt: Timestamp; appliedVersion?: number }
} & (
  | { withheld?: never; issue: string; title?: string; content: string; reasoning: string }
  | { withheld: true }
)

export type ScoreRoute =
  { kind: "fusion"; fusionTier: string } | { kind: "auto"; model: string; reasoningEffort?: string }

/** Any record a provider stores in a stream. */
export type StoredRecord =
  | Episode
  | EpisodeEvent
  | ConsentGrant
  | GrantWithdrawal
  | Collection
  | AuditEntry
  | ExportManifest
  | Guidance
  | DeliveredLearning
  | UsageReport
  | UsedLearning
  | ScreenshotRecord
  | ScoreRecord
  | UpdateProposalRecord
  | UpdateDecisionRecord

export interface RecalledMemory {
  id: string
  /** The repository the learning belongs to, another one's for a shared learning */
  scope: Scope
  kind: MemoryKind
  content: string
  contentDigest: Digest
  themeKey?: string
  appliesTo: Trace[]
  support?: Support
  acceptedBy: string
  acceptedAt: Timestamp
  relevance: number
}

export interface StatusReport {
  provider: {
    id: string
    version: string
    storage: ProviderManifest["storage"]
  }
  scope: Scope
  /** null when stored records fail their checks and every other operation is blocked */
  counts: {
    episodes: number
    events: number
    grants: number
    activeGrants: number
    completeCollections: number
    incompleteCollections: number
    memories: Record<MemoryState, number>
    recallable: number
  } | null
  attention: string[]
  migrationRedactionFollowUps?: {
    memoriesNeedingRebuild: string[]
    exportsToFollowUp: Array<{ id: string; purpose: Purpose; destination: string }>
  }
}

export interface HubReviewCollection {
  meta: {
    hubOrigin: string
    repository: string
    repositoryId: number | string
    snapshotId: string
    capturedAt: Timestamp
  }
  filters: CollectionFilters
  threads: Array<{
    root: Record<string, unknown>
    replies: Array<Record<string, unknown>>
  }>
  complete: boolean
  problems: string[]
  counts: { threads: number; messages: number }
}

export interface Trace {
  kind: "rule" | "skill" | "component" | "context" | "token" | "other"
  ref: string
}

export interface Support {
  distinctEpisodes: number
  distinctPrototypes: number
  distinctReviewers: number
  distinctBuilds: number
}

export interface MemoryProposal {
  schemaVersion: "replica.memory-proposal/v1"
  kind: MemoryKind
  title?: string
  content: string
  themeKey?: string
  appliesTo?: Trace[]
  evidence: EvidenceRef[]
  contradictions?: EvidenceRef[]
  support?: Support
  confidence?: number
  rationale: {
    recurrence: string
    contradictions?: string
    expectedBenefit: string
    falsification: string
  }
  lifecycle: {
    action: "new" | "merge" | "supersede" | "retire"
    targets?: string[]
  }
  consolidator: { id: string; version: string }
  validFrom?: Timestamp
  validUntil?: Timestamp
  expiresAt?: Timestamp
}

export interface MemoryRecord {
  schemaVersion: "replica.memory/v1"
  id: string
  version: number
  previousDigest?: Digest
  scope: Scope
  kind: MemoryKind
  state: MemoryState
  title?: string
  content: string
  themeKey?: string
  appliesTo?: Trace[]
  evidence: EvidenceRef[]
  contradictions?: EvidenceRef[]
  support?: Support
  confidence?: number
  validFrom?: Timestamp
  validUntil?: Timestamp
  expiresAt?: Timestamp
  /** learnings this accepted learning replaces, recorded once; the replaced ones keep their own state */
  supersedes?: string[]
  /** identifies the learning itself; an approval is valid only while accepted.contentDigest equals it */
  contentDigest: Digest
  /** covers everything a reviewer is shown; accept and reject require the reviewDigest the person reviewed */
  reviewDigest: Digest
  proposal: {
    consolidator: { id: string; version: string }
    rationale: MemoryProposal["rationale"]
    lifecycle: MemoryProposal["lifecycle"]
    proposedAt: Timestamp
    proposedBy: Actor
    proposalDigest: Digest
  }
  accepted?: {
    by: Actor
    at: Timestamp
    contentDigest: Digest
    reviewedDigest: Digest
    edited: boolean
    decision?: "edit" | "reinstate"
    note?: string
    operationId?: string
  }
  rejected?: {
    by: Actor
    at: Timestamp
    reviewedDigest: Digest
    reason: string
    operationId?: string
  }
  retired?: { by?: Actor; at: Timestamp; reason: string; operationId?: string }
  provenance: Provenance
  createdAt: Timestamp
  updatedAt: Timestamp
  digest: Digest
}

export interface ProviderManifest {
  schemaVersion: "replica.provider/v1"
  id: string
  name: string
  version: string
  contract: { name: "replica.memory-provider"; versions: number[] }
  capabilities: string[]
  storage: { kind: "local" | "memory" | "remote"; location?: string }
  externalCalls: string[]
  dataRetention?: string
}

export interface ProviderQuery {
  scope: Scope
  ids?: string[]
  episodeIds?: string[]
  operations?: string[]
  since?: Timestamp
  until?: Timestamp
}

/**
 * The memory provider contract, version 1. A provider stores canonical records and returns
 * them; the learning store applies every consent, purpose, scope, and approval rule.
 * Conflicts throw an error with code "conflict"; bad queries throw code "invalid_input".
 */
export interface MemoryProvider {
  /** When true, decisionFence and expectedDecisionFence are checked atomically. */
  readonly atomicDecisionFence?: true
  /** Capture the scope's eligibility state before reading it for a decision. */
  decisionFence?(scope: Scope): Promise<Digest>
  /** Find the connected replacement histories for a decision. */
  readDecisionMemoryIds?(scope: Scope, ids: string[]): Promise<string[]>
  /** Find episodes from the same Hub review threads as the selected episodes. */
  readRelatedEpisodeIds?(scope: Scope, ids: string[]): Promise<string[]>
  /** Read the consent, identity, and migration inputs for selected evidence. */
  readDecisionInputs?(
    scope: Scope,
    selection: {
      evidence: Array<{ source: string; at: Timestamp }>
      at: Timestamp
      purpose: Purpose
      hubSources: Array<Pick<SourcePin, "hubOrigin" | "repositoryId">>
      eventIds: string[]
    },
  ): Promise<{
    grants: ConsentGrant[]
    withdrawals: GrantWithdrawal[]
    collections: Collection[]
    origins: Array<{ kind: "grant" | "event"; id: string; origin: string }>
  }>
  manifest(): ProviderManifest
  health(): Promise<{ ok: boolean; detail: string }>
  /**
   * Appends records, and the audit entries that record the change, in one atomic write: if any
   * part is refused or fails, nothing is stored.
   */
  appendRecords(
    stream: Stream,
    records: Array<{ id: string; digest: Digest; scope: Scope }>,
    options?: { audit?: AuditEntry[] },
  ): Promise<{ appended: number; existing: number }>
  /**
   * Appends records to several streams, and the audit entries that record them, in one atomic
   * write: if any part is refused or fails, nothing is stored.
   */
  appendBatch(
    batch: Partial<Record<Stream, Array<{ id: string; digest: Digest; scope: Scope }>>>,
    options?: { audit?: AuditEntry[] },
  ): Promise<Partial<Record<Stream, { appended: number; existing: number }>>>
  readRecords(stream: Stream, query: ProviderQuery): Promise<StoredRecord[]>
  /** Appends a version, and the audit entries that record it, in one atomic write. */
  appendMemoryVersion(
    record: MemoryRecord,
    options: {
      expectedPreviousDigest: Digest | null
      expectedDecisionFence?: Digest
      audit?: AuditEntry[]
    },
  ): Promise<void>
  readMemoryVersions(query: Omit<ProviderQuery, "episodeIds">): Promise<MemoryRecord[]>
  /**
   * Only with the observation.redact capability. Replaces a stored event with a copy that has
   * the same ID and digest, no payload, and a redaction note; see redactionProblem.
   */
  redactRecord?(stream: "events", record: StoredRecord): Promise<{ redacted: boolean }>
  /**
   * Only with the records.delete capability. Removes the named records and every version of
   * the named learnings in one atomic write with the audit entries.
   */
  deleteRecords?(
    scope: Scope,
    targets: { records: Partial<Record<Stream, string[]>>; memories?: string[] },
    options?: { audit?: AuditEntry[] },
  ): Promise<DeletionResult>
  close?(): Promise<void>
}

export interface ConsolidationView {
  readonly purpose: "instruction" | "evaluation"
  readonly window: { from: Timestamp; to: Timestamp }
  readonly scope: Scope
  readonly episodes: readonly Episode[]
  readonly events: readonly EpisodeEvent[]
  readonly memories: readonly MemoryView[]
}

/** What a consolidator sees of a memory. content, appliesTo, and evidence appear only while its evidence permits the purpose. */
export interface MemoryView {
  readonly id: string
  readonly version: number
  readonly state: MemoryState
  readonly kind: MemoryKind
  readonly themeKey?: string
  readonly support?: Support
  /** when the learning applies; shown whatever the purpose, since they hold no review content */
  readonly validFrom?: Timestamp
  readonly validUntil?: Timestamp
  readonly expiresAt?: Timestamp
  readonly effective: boolean
  readonly needsRebuild: boolean
  readonly superseded: boolean
  readonly expired: boolean
  readonly content?: string
  readonly appliesTo?: readonly Trace[]
  readonly evidence?: readonly EvidenceRef[]
  /** the counterevidence a reviewer saw, shown under the same rule as content */
  readonly contradictions?: readonly EvidenceRef[]
}

export interface Diagnostic {
  code: string
  message: string
  themeKey?: string
  [detail: string]: unknown
}

/** Reads a frozen view and returns proposals. It cannot write, and nothing it returns is accepted. */
export interface MemoryConsolidator {
  manifest: {
    id: string
    version: string
    description?: string
    [detail: string]: unknown
  }
  consolidate(
    request: {
      window: { from: Timestamp; to: Timestamp }
      scope: Scope
      purpose: "instruction" | "evaluation"
      /**
       * The store keeps at most maxProposals new or changed proposals. Proposals it already
       * holds unchanged and undecided do not count, so return every proposal you would make.
       */
      budget: { maxProposals: number }
    },
    view: ConsolidationView,
  ): Promise<{ proposals: MemoryProposal[]; diagnostics?: Diagnostic[] }>
}

/** One comment a labeler is asked about, or an earlier one in its thread for context. */
export interface LabelingComment {
  id: string
  label: boolean
  text: string
  page?: string
  element?: string
}

/** A label a labeler returns. The comment is the comment event's ID it was given. */
export interface ProposedLabel {
  comment: string
  theme: { key: string; statement: string }
  signal: string
  observation: string
  stance: "supports" | "contradicts"
}

/** One model call's usage as the labeler's service reported it. */
export interface LabelingUsage {
  model: string | null
  inputTokens: number
  outputTokens: number
  /** Whole nano-AI units; the built-in labeler rounds positive SDK fractions up. */
  nanoAiu: number
}

/**
 * Labels review comments. It receives only comments the review purpose may use, grouped in
 * threads, without their authors, and the themes already in use. It records nothing itself.
 */
export interface MemoryLabeler {
  manifest: {
    id: string
    name: string
    version: string
    [detail: string]: unknown
  }
  label(request: {
    threads: Array<{ comments: LabelingComment[] }>
    themes: Array<{ key: string; statement: string }>
  }): Promise<{ labels: ProposedLabel[]; usage?: LabelingUsage[] }>
  status?(): Promise<{
    signedIn: boolean
    via: string | null
    login: string | null
    host: string | null
    models: string[]
  }>
  close?(): Promise<void>
}

/** What labelComments did: counts, refused labels, created label events, and usage. */
export interface LabelingResult {
  /** Comments actually sent to the labeler, including an attempted group reported on failure. */
  considered: number
  labeled: number
  unlabeled: number
  /** Comments still awaiting durable annotation or no-annotation markers, including capped groups. */
  remaining: number
  rejected: Array<{ comment: string; reason: string }>
  events: string[]
  models: string[]
  /** On failures only: durable progress could not be re-read; remaining is a conservative bound. */
  progressError?: string
  /** On command failures only: closing the labeler failed after the result or original error. */
  cleanupError?: string
  /** On failures only: malformed usage was omitted without replacing the original failure. */
  usageError?: string
  usage: {
    requests: number
    inputTokens: number
    outputTokens: number
    nanoAiu: number
  }
}

/** The package's consolidators, handed to a consolidator module's factory so it can build on them. */
export interface BuiltinConsolidators {
  createNoopConsolidator(): MemoryConsolidator
  createRecurrenceConsolidator(
    options?: Partial<typeof DEFAULT_RECURRENCE_OPTIONS>,
  ): MemoryConsolidator
}

/** What a consolidator module exports, as createConsolidator unless the config names another export. */
export type ConsolidatorFactory = (
  options: Record<string, unknown>,
  builtins: BuiltinConsolidators,
) => MemoryConsolidator | Promise<MemoryConsolidator>

export interface MemoryStatus {
  /** inEffect, and every piece of evidence and counterevidence may serve the purpose */
  recallEligible: boolean
  /** accepted, approved, valid now, not replaced, and not a replacement that lost; export and recall both require it */
  inEffect: boolean
  needsRebuild: boolean
  /** A dependency was identity-corrected or remains unverified after stable-identity adoption. */
  identityNeedsReview: boolean
  approvalValid: boolean
  expired: boolean
  notYetValid: boolean
  /** derived from accepted replacements; the replaced record itself never changes */
  superseded: boolean
  evidenceEligible: boolean
  /** the replacement that won, when superseded */
  supersededBy: string[]
  /** replacements this memory lost to one made first; a lost acceptance means it is not used, a lost later step leaves it as it was */
  conflicts: string[]
  problems: string[]
}

/** The fields a damaged learning, or a past version a purpose may not read, still shows. Each appears only if it passes a strict check. */
export type MemoryMetadata = Partial<
  Pick<
    MemoryRecord,
    | "id"
    | "version"
    | "state"
    | "kind"
    | "themeKey"
    | "updatedAt"
    | "contentDigest"
    | "reviewDigest"
    | "digest"
  >
>

/**
 * A memory as read for a purpose. When withheld because its evidence is not permitted, its
 * content, evidence, contradictions, and rationale are left out. When its history is damaged,
 * only MemoryMetadata is shown and status.problems says why.
 */
export interface MemoryReading {
  record:
    | MemoryRecord
    | Omit<MemoryRecord, "title" | "content" | "evidence" | "contradictions" | "appliesTo">
    | MemoryMetadata
  status: MemoryStatus
  withheld: boolean
}

export interface LearningStore {
  readonly manifest: ProviderManifest
  health(): Promise<{ ok: boolean; detail: string }>
  close(): Promise<void>
  addGrant(
    context: LearningContext,
    input: {
      purposes: Purpose[]
      sources: string[]
      basis: string
      expiresAt?: Timestamp
      evidenceFrom?: Timestamp
      evidenceUntil?: Timestamp
    },
  ): Promise<ConsentGrant>
  listGrants(context: LearningContext): Promise<
    Array<{
      grant: ConsentGrant
      activePurposes: Purpose[]
      withdrawnPurposes: Purpose[]
      expired: boolean
    }>
  >
  listWithdrawals(context: LearningContext): Promise<GrantWithdrawal[]>
  withdrawGrant(
    context: LearningContext,
    grantId: string,
    input: { purposes?: Purpose[]; reason?: string },
  ): Promise<{
    withdrawal: GrantWithdrawal
    memoriesNeedingRebuild: string[]
    exportsToFollowUp: Array<{
      id: string
      purpose: Purpose
      destination: string
    }>
  }>
  /**
   * Remove the text of a review comment or an agent session message: every version of it and
   * every label on them.
   */
  redactComment(
    context: LearningContext,
    eventId: string,
    input: { reason: string },
  ): Promise<{
    redacted: string[]
    memoriesNeedingRebuild: string[]
    exportsToFollowUp: Array<{
      id: string
      purpose: Purpose
      destination: string
    }>
  }>
  /**
   * Remove the text of one Hub comment, named by its Hub comment ID, as redactComment does. It
   * imports nothing and needs no active grant; a comment with no text left removes nothing.
   */
  redactHubComment(
    context: LearningContext,
    commentId: number,
    /** reason defaults to "The comment was deleted at its source." */
    input?: { reason?: string },
  ): Promise<{
    redacted: string[]
    memoriesNeedingRebuild: string[]
    exportsToFollowUp: Array<{
      id: string
      purpose: Purpose
      destination: string
    }>
  }>
  importHubReviewComments(
    context: LearningContext,
    log: unknown,
    /** redactDeleted also removes the text of every comment the snapshot shows as deleted. */
    options: { grantIds: string[]; redactDeleted?: boolean },
  ): Promise<{
    collection: Collection
    addedEpisodes: number
    addedEvents: number
    complete: boolean
    problems: string[]
    redacted: string[]
    memoriesNeedingRebuild: string[]
    exportsToFollowUp: Array<{
      id: string
      purpose: Purpose
      destination: string
    }>
    identityUpdates?: {
      reason: string
      eventIds: string[]
      memoryIds: string[]
    }
  }>
  /**
   * Store an agent session as one episode of user and agent messages and an outcome. Sending
   * the same sessionId again adds new messages and versions of changed ones.
   */
  importAgentSession(
    context: LearningContext,
    session: {
      sessionId: string
      task?: string
      user?: string
      startedAt?: string
      messages: Array<{ role: "user" | "agent" | "tool"; text: string; at?: string }>
      outcome?: { status: "success" | "failure" | "partial" | "unknown"; summary?: string }
    },
    options: { grantIds: string[] },
  ): Promise<{
    episodeId: string
    sessionId: string
    addedEpisodes: number
    addedEvents: number
    skippedMessages: number
  }>
  appendObservations(
    context: LearningContext,
    input: { episodes?: Partial<Episode>[]; events?: Partial<EpisodeEvent>[] },
  ): Promise<{ episodes: Episode[]; events: EpisodeEvent[] }>
  annotate(context: LearningContext, labels: unknown[]): Promise<EpisodeEvent[]>
  /** Record that the caller read these comment events and found nothing to label. */
  recordNoAnnotation(context: LearningContext, eventIds: string[]): Promise<EpisodeEvent[]>
  queryObservations(
    context: LearningContext,
    query: {
      purpose: Purpose
      episodeIds?: string[]
      /** At most 100 IDs. Omitted reads all; [] reads none. Missing or ineligible IDs are omitted. */
      eventIds?: string[]
      since?: Timestamp
      until?: Timestamp
      types?: string[]
    },
  ): Promise<{ episodes: Episode[]; events: EpisodeEvent[] }>
  proposeMemory(context: LearningContext, proposal: MemoryProposal): Promise<MemoryRecord>
  getMemory(
    context: LearningContext,
    id: string,
    options?: { history?: boolean; purpose?: Purpose },
  ): Promise<
    MemoryReading & {
      versions?: Array<MemoryRecord | (MemoryMetadata & { withheld: true })>
    }
  >
  findMemoryOperation(
    context: LearningContext,
    id: string,
    operationId: string,
  ): Promise<{ state: MemoryState | null }>
  queryMemory(
    context: LearningContext,
    query?: { states?: MemoryState[]; kinds?: MemoryKind[]; purpose?: Purpose },
  ): Promise<MemoryReading[]>
  acceptMemory(
    context: LearningContext,
    id: string,
    input: { expectedDigest: Digest; content?: string; note?: string; operationId?: string },
  ): Promise<MemoryRecord>
  rejectMemory(
    context: LearningContext,
    id: string,
    input: { expectedDigest: Digest; reason: string; operationId?: string },
  ): Promise<MemoryRecord>
  retireMemory(
    context: LearningContext,
    id: string,
    input: { reason: string; operationId?: string },
  ): Promise<MemoryRecord>
  editMemory(
    context: LearningContext,
    id: string,
    input: {
      expectedDigest: Digest
      title?: string
      content?: string
      reason: string
      operationId?: string
    },
  ): Promise<MemoryRecord>
  reinstateMemory(
    context: LearningContext,
    id: string,
    input: { expectedDigest: Digest; reason: string; operationId?: string },
  ): Promise<MemoryRecord>
  supersedeMemory(
    context: LearningContext,
    oldIds: string[],
    newId: string,
    input?: { reason?: string },
  ): Promise<MemoryRecord>
  consolidate(
    context: LearningContext,
    options: {
      consolidator: MemoryConsolidator
      window: { from: Timestamp; to: Timestamp }
      purpose?: "instruction" | "evaluation"
      /**
       * The most new or changed proposals one run stores, 10 by default. A proposal already
       * stored unchanged and still undecided does not count, and neither does a refused one.
       */
      maxProposals?: number
      dryRun?: boolean
    },
  ): Promise<{
    status: "complete" | "incomplete"
    summary: string
    coverage: {
      complete: boolean
      gaps: Array<{ from: Timestamp; to: Timestamp }>
      notes: string[]
    }
    proposals: Array<MemoryRecord | MemoryProposal>
    changed: string[]
    /** How many proposals maxProposals held back, 0 when none */
    overBudget: number
    diagnostics: Diagnostic[]
    sourceEpisodeIds: string[]
  }>
  recall(
    context: LearningContext,
    options?: {
      task?: string
      limit?: number
      /** Includes the full rendered output; a budget too small for its framing throws invalid_input. */
      budgetChars?: number
      /**
       * Show a person what an agent would get, without recording a use for instruction. Needs a
       * human principal.
       */
      preview?: boolean
      /** Where the agent asked from, "local" by default. */
      via?: "local" | "hub"
      session?: AgentSessionRef
      /**
       * Accepted learnings other repositories shared with this one, read by the host from
       * their own stores. Each must be intact and from another scope. Only a preview takes
       * them.
       */
      shared?: MemoryRecord[]
    },
  ): Promise<{
    /** Absent for a preview, which stores nothing. */
    guidanceId?: string
    memories: Array<RecalledMemory & { deliveryId?: string }>
    text: string
    considered: number
  }>
  /**
   * Record which delivered learnings an agent says it used for a commit. Sending the same
   * reportId with the same content again stores nothing new.
   */
  reportUsage(
    context: LearningContext,
    report: {
      reportId: string
      guidanceIds: string[]
      commitSha: string
      session?: AgentSessionRef
      prototypeId?: string
      used: Array<{ deliveryId: string; before?: UsageScreenshot; after?: UsageScreenshot }>
      /**
       * An active evaluation grant for agent screenshots. Required for screenshots when the
       * screenshot store requiresGrant, as on a host.
       */
      consentGrantId?: string
    },
  ): Promise<{ id: string; reportId: string; stored: boolean }>
  /**
   * List what agents said they used for a commit. Title and text are null when the learning's
   * evidence no longer allows review, so withdrawn consent hides the delivered wording.
   */
  usageForCommit(
    context: LearningContext,
    options: { commitSha: string },
  ): Promise<
    Array<{
      id: string
      reportId: string
      prototypeId?: string
      reportedAt: Timestamp
      used: Array<{
        id: string
        memoryId: string
        version: number | null
        title: string | null
        text: string | null
        before?: UsedScreenshot
        after?: UsedScreenshot
      }>
    }>
  >
  /**
   * What an evaluator may read about one used learning. A screenshot whose consent no longer
   * allows evaluation is left out; bytes are null when the store does not keep them.
   */
  evaluationInputs(
    context: LearningContext,
    request: { usedLearningId: string },
  ): Promise<{
    usedLearning: { id: string; memoryId: string; usageReportId: string }
    learning: { version: number | null; title: string | null; text: string }
    report: {
      commitSha: string
      prototypeId?: string
      session?: AgentSessionRef
      reportedAt: string
    }
    screenshots: Array<{
      sha256: string
      role: "before" | "after"
      route: string
      viewport: { width: number; height: number }
      theme: string
      capturedAt: string
      bytes: Uint8Array | null
    }>
  }>
  /**
   * How agents' uses of one learning were scored, oldest first. Scores of a version whose
   * evidence no longer permits review are left out.
   */
  outcomesFor(
    context: LearningContext,
    request: { memoryId: string },
  ): Promise<
    Array<{
      id: string
      usedLearningId: string
      version: number
      commitSha: string
      prototypeId?: string
      efficiency: 1 | 2 | 3 | 4
      followed: "followed" | "not_followed" | "unclear"
      reasoning: string
      issue?: string
      inputs: Array<"screenshots" | "build_diff" | "reviewer_verification">
      scoredAt: string
      before?: { sha256: string; route: string; consentGrantId?: string }
      after?: { sha256: string; route: string; consentGrantId?: string }
    }>
  >
  /** The score already kept for one scoring attempt, or null when it has none. */
  scoreFor(
    context: LearningContext,
    request: { usedLearningId: string; operationId: string },
  ): Promise<ScoreRecord | null>
  /**
   * Keep an evaluator's score for one used learning. A retry with the same operationId
   * stores nothing new and returns the first score.
   */
  recordScore(
    context: LearningContext,
    score: {
      usedLearningId: string
      operationId: string
      efficiency: 1 | 2 | 3 | 4
      followed: "followed" | "not_followed" | "unclear"
      reasoning: string
      /** Required for an efficiency of 1 or 2. */
      issue?: string
      inputs?: Array<"screenshots" | "build_diff" | "reviewer_verification">
      route: ScoreRoute
    },
  ): Promise<{ id: string; stored: boolean; score: ScoreRecord }>
  /**
   * Keep suggested new wording for the current version of an accepted learning. A retry with
   * the same version, issue, and scores keeps the first proposal.
   */
  proposeUpdate(
    context: LearningContext,
    input: {
      memoryId: string
      versionDigest: Digest
      issueKey: string
      issue: string
      title?: string
      content: string
      reasoning: string
      support: string[]
      counter?: string[]
      route: ScoreRoute
    },
  ): Promise<{ id: string; stored: boolean; proposal: UpdateProposalRecord }>
  /** One learning's update proposals, oldest first, each with its state. */
  updatesFor(context: LearningContext, request: { memoryId: string }): Promise<LearningUpdate[]>
  /**
   * Make an open proposal's wording, or a person's edit of it, the learning's next version.
   * Needs a person.
   */
  applyUpdate(
    context: LearningContext,
    proposalId: string,
    /** Retrying with the same operation ID finishes an apply that stopped after the edit. */
    input: { title?: string; content?: string; reason: string; operationId: string },
  ): Promise<{ update: LearningUpdate; memory: MemoryRecord | null; stored: boolean }>
  /** Dismiss an open proposal. Needs a person. */
  dismissUpdate(
    context: LearningContext,
    proposalId: string,
    input: { reason: string },
  ): Promise<{ update: LearningUpdate; stored: boolean }>
  /**
   * Remove a learning for good, with its deliveries, use, screenshots, scores, and update
   * proposals. Needs a person.
   */
  deleteMemory(
    context: LearningContext,
    id: string,
    options: { reason: string },
  ): Promise<DeletionResult>
  /** Remove guidance older than days (365 by default) that no usage report names. */
  expireGuidance(context: LearningContext, options?: { days?: number }): Promise<DeletionResult>
  /** Remove every record in this scope, including its audit trail. Needs a person. */
  deleteRepository(context: LearningContext): Promise<DeletionResult>
  exportRecords(
    context: LearningContext,
    options: {
      purpose: Purpose
      destination: string
      contents?: "all" | "learnings"
      /** Prepare the exact bundle without recording an export or export audit. */
      preview?: boolean
    },
  ): Promise<{
    manifest: ExportManifest
    bundle: {
      manifest: ExportManifest
      grants: ConsentGrant[]
      collections: Collection[]
      episodes: Episode[]
      memories: MemoryRecord[]
    }
  }>
  status(context: LearningContext): Promise<StatusReport>
  verify(context: LearningContext): Promise<{
    ok: boolean
    problems: string[]
    health: { ok: boolean; detail: string }
  }>
}

export declare const PURPOSES: readonly Purpose[]
export declare const REQUIRED_CAPABILITIES: readonly string[]
export declare const REDACT_CAPABILITY: "observation.redact"
export declare const DELETE_CAPABILITY: "records.delete"
/** Why a provider must refuse to replace a stored event with this redacted copy, or null. */
export declare function redactionProblem(stored: unknown, record: unknown): LearningError | null
export declare const PROVIDER_CONTRACT: {
  readonly name: "replica.memory-provider"
  readonly version: 1
}
export declare const STREAMS: Readonly<Record<Stream, string>>
export declare const SCHEMA_VERSIONS: Readonly<Record<string, string>>
export declare const RECORD_KINDS: readonly string[]
export declare const HUB_SOURCE: "hub_review_comments"
export declare const HUB_COLLECTION_KIND: "replica.hub-review-collection/v1"
export declare const DEFAULT_RECURRENCE_OPTIONS: Readonly<{
  minEpisodes: number
  minPrototypes: number
  minReviewers: number
  signals: readonly string[]
  observations: readonly string[]
}>

export declare class LearningError extends Error {
  constructor(code: string, message: string, details?: Record<string, unknown>)
  code: string
  details: Record<string, unknown>
}
export declare class ProviderConflictError extends LearningError {}

/** Where a store keeps screenshot images; records hold only their sha256. */
export interface ScreenshotStore {
  /** True when the host keeps the bytes, so screenshots need a consent grant. */
  requiresGrant?: boolean
  put(bytes: Uint8Array): Promise<Digest>
  read(digest: Digest): Promise<Uint8Array | null>
  remove(digest: Digest): Promise<void>
}

export declare function createLearningStore(options: {
  provider: MemoryProvider
  clock?: () => number
  legacyScopes?: Scope[]
  digestMappings?: Record<string, string>
  /** Without it, a usage report with screenshots is refused. */
  screenshots?: ScreenshotStore
}): Promise<LearningStore>
/** Keep screenshot images in a private directory on this machine. */
export declare function createScreenshotStore(directory: string): ScreenshotStore
export declare function createSqliteMemoryProvider(options: {
  directory: string
  file?: string
}): MemoryProvider
export declare function createPostgresMemoryProvider(options: {
  connectionString: string
}): MemoryProvider
export declare function createJsonLinesMemoryProvider(options: {
  directory: string
  lockTimeoutMs?: number
  staleLockMs?: number
}): MemoryProvider
export declare function createInMemoryProvider(): MemoryProvider
export declare function createCopilotLabeler(options?: {
  model?: string
  token?: string
  timeoutMs?: number
}): MemoryLabeler & Required<Pick<MemoryLabeler, "status" | "close">>
export declare function labelComments(
  store: LearningStore,
  context: LearningContext,
  /** since skips comments written before that RFC 3339 UTC time. */
  options: {
    labeler: MemoryLabeler
    limit?: number
    /** Maximum labeler invocations; omitted processes every selected group. Not a model-usage event cap. */
    maxRequests?: number
    since?: string
  },
): Promise<LabelingResult>
export declare function createNoopConsolidator(): MemoryConsolidator
export declare function createRecurrenceConsolidator(
  options?: Partial<typeof DEFAULT_RECURRENCE_OPTIONS>,
): MemoryConsolidator
export declare function assertContext(context: LearningContext): void
export declare function validateRecord(
  kind: string,
  value: unknown,
  options?: { sealed?: boolean },
): { valid: boolean; errors: string[] }
export declare function canonicalJson(value: unknown): string
export declare function digestOf(value: unknown): Digest
export declare function parseJson(text: string, label?: string): unknown
export declare function portabilityProblems(value: unknown): string[]
export declare function memoryContentDigest(memory: MemoryRecord): Digest
export declare function memoryReviewDigest(memory: MemoryRecord): Digest
export declare function matchesQuery(
  stream: Stream | "memories",
  record: { id: string; scope: Scope; [field: string]: unknown },
  query: ProviderQuery,
): boolean
export declare function normalizeTimestamp(value: string): Timestamp
export declare function readHubReviewCollection(
  log: unknown,
  expected: { repository: string },
): HubReviewCollection

/** A typed question a decision model answers with a probability for every option. */
export type DecisionQuestion =
  | {
      type: "noul"
      instructions: string
      learning_text?: string
      criteria?: { true?: string; false?: string }
    }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
export interface DecisionModel {
  /** The Hugging Face model ID, such as LiquidAI/d1-2B */
  id: string
  name: string
  maker: string
  parameters: string
  /** decision answers typed questions directly; generative learns a decision readout in training */
  readout: "decision" | "generative"
  license: { name: string; url: string; commercialUse: "allowed" | "limited" | "terms" }
  url: string
}
export interface DecisionTaskPlan {
  scope: Scope
  exportId: string
  learnings: Array<{ id: string; content: string }>
  tasks: Array<{
    id: string
    split: "train" | "dev" | "test"
    prototypeId: number | string
    buildNumber: number
    route: string
    /** The page's screenshots from the Builds file: desktop before narrow, light before dark. */
    screenshots: Array<{ size: "desktop" | "narrow"; theme: "light" | "dark"; path: string }>
    /** true when the Build follows the learning, false when it breaks it. */
    labels: Record<string, boolean>
    evidence: Array<{
      learningId: string
      outcome: "breaks" | "follows"
      episodeId: string
      eventIds: string[]
    }>
  }>
  /** Review evidence that did not become a label, counted by reason. */
  skipped: Record<string, number>
}
export interface DecisionTasksetManifest {
  schemaVersion: "replica.decision-taskset/v1"
  exportId: string
  scope: Scope
  createdAt: Timestamp
  learnings: number
  counts: Record<"tasks" | "train" | "dev" | "test" | "follows" | "breaks", number>
  skipped: Record<string, number>
}
export declare const DECISION_MODEL_CATALOG: {
  schemaVersion: "replica.decision-models/v1"
  checkedAt: string
  models: DecisionModel[]
}
export declare function brandCheckQuestions(learnings: Array<{ id: string; content: string }>): {
  questions: Record<string, DecisionQuestion>
  rules: Array<{ id: string; text: string }>
}
/** Plan labeled tasks from a training export and a replica.decision-builds/v1 Builds file. */
export declare function planDecisionTasks(bundle: unknown, builds: unknown): DecisionTaskPlan
export declare function writeDecisionTaskset(
  plan: DecisionTaskPlan,
  options: { directory: string; baseDirectory: string; brandSheet?: string; createdAt: Timestamp },
): Promise<DecisionTasksetManifest>
