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
  "episodes" | "events" | "grants" | "withdrawals" | "collections" | "audit" | "exports"

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
}

export interface SourcePin {
  kind: string
  hubOrigin?: string
  repository?: string
  repositoryId?: number
  prototypeId?: number
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
  /** all: grants, episodes with their events, and learnings. learnings: accepted learnings and the grants that permit their evidence. Absent means all. */
  contents?: "all" | "learnings"
  counts: {
    episodes: number
    events: number
    memories: number
    grants: number
  }
  excluded: Array<{ reason: string; count: number }>
  records: Array<{
    kind: "episode" | "event" | "memory" | "grant"
    id: string
    digest: Digest
  }>
  digest: Digest
}

/** Any record a provider stores in a stream. */
export type StoredRecord =
  Episode | EpisodeEvent | ConsentGrant | GrantWithdrawal | Collection | AuditEntry | ExportManifest

export interface RecalledMemory {
  id: string
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
}

export interface HubReviewCollection {
  meta: {
    hubOrigin: string
    repository: string
    repositoryId: number
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
    note?: string
  }
  rejected?: {
    by: Actor
    at: Timestamp
    reviewedDigest: Digest
    reason: string
  }
  retired?: { by?: Actor; at: Timestamp; reason: string }
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
    options: { expectedPreviousDigest: Digest | null; audit?: AuditEntry[] },
  ): Promise<void>
  readMemoryVersions(query: Omit<ProviderQuery, "episodeIds">): Promise<MemoryRecord[]>
  /**
   * Only with the observation.redact capability. Replaces a stored event with a copy that has
   * the same ID and digest, no payload, and a redaction note; see redactionProblem.
   */
  redactRecord?(stream: "events", record: StoredRecord): Promise<{ redacted: boolean }>
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
    | Omit<MemoryRecord, "content" | "evidence" | "contradictions" | "appliesTo">
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
  /** Remove a review comment's text: every version of it and every label on them. */
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
  queryMemory(
    context: LearningContext,
    query?: { states?: MemoryState[]; kinds?: MemoryKind[]; purpose?: Purpose },
  ): Promise<MemoryReading[]>
  acceptMemory(
    context: LearningContext,
    id: string,
    input: { expectedDigest: Digest; content?: string; note?: string },
  ): Promise<MemoryRecord>
  rejectMemory(
    context: LearningContext,
    id: string,
    input: { expectedDigest: Digest; reason: string },
  ): Promise<MemoryRecord>
  retireMemory(
    context: LearningContext,
    id: string,
    input: { reason: string },
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
    },
  ): Promise<{ memories: RecalledMemory[]; text: string; considered: number }>
  exportRecords(
    context: LearningContext,
    options: {
      purpose: Purpose
      destination: string
      contents?: "all" | "learnings"
    },
  ): Promise<{
    manifest: ExportManifest
    bundle: {
      manifest: ExportManifest
      grants: ConsentGrant[]
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

export declare function createLearningStore(options: {
  provider: MemoryProvider
  clock?: () => number
}): Promise<LearningStore>
export declare function createSqliteMemoryProvider(options: {
  directory: string
  file?: string
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
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
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
    prototypeId: number
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
