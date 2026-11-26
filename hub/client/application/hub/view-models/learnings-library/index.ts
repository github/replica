import type {
  LearningDetail,
  LearningEvidence,
  LearningOutcome,
  LearningStatus,
  LearningsLibraryData,
  LibraryLearning,
} from "@features/learnings-library/types"
import type {
  LearningEvidenceResponse,
  LearningHistoryResponse,
  LearningOutcomeResponse,
  LearningsResponse,
} from "@application/hub/learnings-contracts/types"

// Matches GitHub's pull request list so long lists page the way people expect.
const pageSize = 25
const titleLength = 80

const changeLabels: Record<LearningHistoryResponse["decisions"][number]["change"], string> = {
  proposed: "Suggested",
  accepted: "Accepted",
  edited: "Edited",
  reinstated: "Accepted again",
  rejected: "Rejected",
  retired: "Retired",
}

type Overview = Extract<LearningsResponse, { accessDenied: false }>
type LearningRecord = Omit<LibraryLearning, "detailPath">

function count(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`
}

function longDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(value))
}

// Older learnings have no title, so the list leads with the start of their guidance.
function titleFrom(title: string | null, guidance: string) {
  if (title) return title
  const line = guidance.split("\n")[0]?.trim() ?? ""
  return line.length > titleLength ? `${line.slice(0, titleLength - 1).trimEnd()}…` : line
}

function unavailableGuidance(status: Overview["learnings"][number]["status"] | null) {
  return status === "damaged"
    ? "This learning's wording is unavailable because its stored record failed integrity checks."
    : status === "identity-review"
      ? "This version's wording is withheld until its reviewer identities are revalidated."
      : "This learning's wording is not available for review."
}

// Hub shares only what this repository's own agents get, so it refuses the rest.
function shareable(status: Overview["learnings"][number]["status"]) {
  return status === "recalled" || status === "budget-excluded"
}

function recallFact(status: Overview["learnings"][number]["status"]) {
  return status === "recalled"
    ? "Agents get this learning."
    : status === "budget-excluded"
      ? "Eligible, but the preview's count or text limit leaves it out."
      : status === "damaged"
        ? "Agents do not get this learning because it failed integrity checks."
        : status === "identity-review"
          ? "Agents do not get this version until its reviewer identities are revalidated."
          : "Eligible. An agent's task decides whether it fits."
}

function evidence(items: LearningEvidenceResponse[], repositoryId: string): LearningEvidence[] {
  return items.map(({ prototypeId, ...item }) => ({
    ...item,
    prototypePath: `/repositories/${repositoryId}/prototypes/${prototypeId}`,
  }))
}

/**
 * Reads a score as a plain result. A score only says something about the guidance when
 * the agent followed it, and 3 or 4 means the work went well.
 */
function outcomes(items: LearningOutcomeResponse[], repositoryId: string): LearningOutcome[] {
  function screenshot(value?: { sha256: string }) {
    return value ? `/api/repositories/${repositoryId}/learnings/screenshots/${value.sha256}` : null
  }
  return items.toReversed().map((item) => ({
    id: item.id,
    result:
      item.followed !== "followed" ? "inconclusive" : item.efficiency >= 3 ? "supports" : "concern",
    reviewerConfirmed: item.source === "reviewer_confirmed",
    summary: item.issue ?? item.reasoning,
    buildLabel: `${item.build.prototypeName}, Build ${item.build.number}`,
    buildPath: `/repositories/${repositoryId}/prototypes/${item.build.prototypeId}?build=${item.build.number}`,
    evaluatedAt: item.scoredAt,
    beforeScreenshotUrl: screenshot(item.before),
    afterScreenshotUrl: screenshot(item.after),
  }))
}

function parseStatus(value: string | null): LearningStatus | null {
  return value === "suggested" || value === "active" || value === "rejected" ? value : null
}

/**
 * Turns the Learnings overview and the address bar into one page of the library. The
 * status, search and page live in the address so the back button and shared links
 * work without extra page state.
 */
export function learningsLibrary(
  state: Overview,
  location: { pathname: string; search: string },
  history: LearningHistoryResponse | null,
): LearningsLibraryData {
  const params = new URLSearchParams(location.search)
  const records: LearningRecord[] = [
    ...state.suggestions.map((entry) => ({
      id: entry.id,
      status: "suggested" as const,
      title: titleFrom(entry.title, entry.content),
      guidance: entry.content,
      updatedAt: null,
      source: null,
    })),
    ...state.learnings.map((entry) => {
      const guidance = entry.content ?? unavailableGuidance(entry.status)
      return {
        id: entry.id,
        status: "active" as const,
        title: titleFrom(entry.title, guidance),
        guidance,
        updatedAt: entry.acceptedAt,
        source: null,
      }
    }),
    ...state.shared.map((entry) => {
      const guidance = entry.content ?? unavailableGuidance(null)
      return {
        id: entry.id,
        status: "active" as const,
        title: titleFrom(entry.title, guidance),
        guidance,
        updatedAt: entry.sharedAt,
        source: entry.source,
      }
    }),
    ...state.rejected.map((entry) => {
      const guidance = entry.content ?? unavailableGuidance(null)
      return {
        id: entry.id,
        status: "rejected" as const,
        title: titleFrom(entry.title, guidance),
        guidance,
        updatedAt: entry.decidedAt,
        source: null,
      }
    }),
  ]
  const counts = {
    suggested: state.suggestions.length,
    active: state.learnings.length + state.shared.length,
    rejected: state.rejected.length,
  }
  // Suggestions need a decision, so they lead until there are none.
  const status = parseStatus(params.get("status")) ?? (counts.suggested ? "suggested" : "active")
  const query = (params.get("q") ?? "").trim()
  const needle = query.toLocaleLowerCase()
  const matching = records.filter(
    (record) =>
      record.status === status &&
      (!needle ||
        record.title.toLocaleLowerCase().includes(needle) ||
        record.guidance.toLocaleLowerCase().includes(needle)),
  )
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize))
  const requestedPage = Number.parseInt(params.get("page") ?? "1", 10)
  const page = Number.isFinite(requestedPage) ? Math.min(Math.max(requestedPage, 1), pageCount) : 1

  function listPath(target: LearningStatus, targetPage = 1, learningId?: string) {
    const next = new URLSearchParams({ status: target })
    if (query) next.set("q", query)
    if (targetPage > 1) next.set("page", String(targetPage))
    if (learningId) next.set("learning", learningId)
    return `${location.pathname}?${next}`
  }

  const selectedId = params.get("learning")
  const selected = selectedId ? records.find((record) => record.id === selectedId) : undefined
  return {
    activity: state.activity.map(({ startedBy, ...day }) => ({
      ...day,
      startedBy:
        startedBy.type === "daily"
          ? "the daily schedule"
          : startedBy.type === "user"
            ? `@${startedBy.login}`
            : null,
    })),
    today: state.today,
    status,
    counts,
    statusPaths: {
      suggested: listPath("suggested"),
      active: listPath("active"),
      rejected: listPath("rejected"),
    },
    query,
    listPath: listPath(status),
    returnPath: listPath(status, page),
    page,
    pageCount,
    learnings: matching
      .slice((page - 1) * pageSize, page * pageSize)
      .map((record) => ({ ...record, detailPath: listPath(status, page, record.id) })),
    selected: selected ? detail(state, selected, history) : null,
  }
}

// Edits and reinstatements replace the acceptance receipt, so name the latest decision.
const receiptLabels = { accepted: "Accepted", edited: "Edited", reinstated: "Reinstated" }

function detail(
  state: Overview,
  record: LearningRecord,
  history: LearningHistoryResponse | null,
): LearningDetail {
  const repositoryId = state.repository.id
  const path = `/repositories/${repositoryId}/learnings/${encodeURIComponent(record.id)}/decision`
  const canDecide = state.permissions.decide
  const common = {
    id: record.id,
    status: record.status,
    title: record.title,
    guidance: record.guidance,
    reason: null,
    replaces: [],
    evidence: evidence(history?.evidence ?? [], repositoryId),
    otherEvidence:
      history && history.otherEvidenceCount > 0
        ? `${count(history.otherEvidenceCount, "more comment")} that Hub cannot show here`
        : null,
    contradictions: evidence(history?.contradictions ?? [], repositoryId),
    otherContradictions:
      history && history.otherContradictionsCount > 0
        ? `${count(history.otherContradictionsCount, "more opposing comment")} that Hub cannot show here`
        : null,
    history: (history?.decisions ?? []).map((entry) => ({
      label: changeLabels[entry.change],
      at: entry.at,
      // Agents propose suggestions under service identities rather than GitHub logins.
      by: entry.by?.includes(":") ? null : entry.by,
      reason: entry.reason,
    })),
    // Only guidance agents get now can have later Builds to judge.
    outcomes: record.status === "active" ? outcomes(history?.outcomes ?? [], repositoryId) : null,
    source: record.source,
    share: null,
  }
  const sharedLearning = record.source
    ? state.shared.find((item) => item.id === record.id)
    : undefined
  if (sharedLearning) {
    return {
      ...common,
      facts: [
        `Shared${sharedLearning.sharedBy ? ` by @${sharedLearning.sharedBy}` : ""} on ${longDate(
          sharedLearning.sharedAt,
        )}`,
        recallFact(sharedLearning.status),
      ],
      decision: null,
    }
  }
  const suggestion = state.suggestions.find((item) => item.id === record.id)
  if (record.status === "suggested" && suggestion) {
    return {
      ...common,
      facts: suggestion.support
        ? [
            `Raised by ${count(suggestion.support.reviewers, "reviewer")} on ${count(
              suggestion.support.prototypes,
              "prototype",
            )}`,
          ]
        : [],
      replaces: suggestion.replaces.map((target) => ({
        id: target.id,
        content: target.content ?? "This learning's wording is not available for review.",
      })),
      evidence: evidence(suggestion.evidence, repositoryId),
      otherEvidence:
        suggestion.otherEvidenceCount > 0
          ? `${count(suggestion.otherEvidenceCount, "more comment")} that Hub cannot show here`
          : null,
      contradictions: evidence(suggestion.contradictions, repositoryId),
      otherContradictions:
        suggestion.otherContradictionsCount > 0
          ? `${count(suggestion.otherContradictionsCount, "more opposing comment")} that Hub cannot show here`
          : null,
      decision: canDecide
        ? { path, digest: suggestion.reviewDigest, title: "", content: "" }
        : null,
    }
  }
  const accepted = state.learnings.find((item) => item.id === record.id)
  if (record.status === "active" && accepted) {
    return {
      ...common,
      facts: [
        ...(accepted.acceptedBy && accepted.acceptedAt
          ? [
              `${receiptLabels[accepted.lastDecision]} by @${accepted.acceptedBy} on ${longDate(
                accepted.acceptedAt,
              )}${accepted.lastDecision === "accepted" && accepted.edited ? ", with edits" : ""}`,
            ]
          : []),
        recallFact(accepted.status),
        ...(accepted.shared ? ["Shared across Hub"] : []),
      ],
      decision:
        canDecide && accepted.digest && accepted.content !== null
          ? {
              path,
              digest: accepted.digest,
              title: accepted.title ?? "",
              content: accepted.content,
            }
          : null,
      share:
        state.permissions.share && (accepted.shared || shareable(accepted.status))
          ? {
              path: path.replace(/\/decision$/, "/share"),
              shared: accepted.shared,
            }
          : null,
    }
  }
  const rejected = state.rejected.find((item) => item.id === record.id)
  const verb = rejected?.state === "retired" ? "Retired" : "Rejected"
  return {
    ...common,
    facts: [
      ...(rejected?.decidedBy && rejected.decidedAt
        ? [`${verb} by @${rejected.decidedBy} on ${longDate(rejected.decidedAt)}`]
        : []),
      ...(rejected?.shared ? ["Still shared across Hub once accepted again"] : []),
    ],
    reason: rejected?.reason
      ? { heading: `Why it was ${verb.toLowerCase()}`, text: rejected.reason }
      : null,
    decision:
      canDecide && rejected?.digest
        ? {
            path,
            digest: rejected.digest,
            title: rejected.title ?? "",
            content: rejected.content ?? "",
          }
        : null,
    // A saved share would come back on reinstatement, so administrators can stop it here.
    share:
      state.permissions.share && rejected?.shared
        ? { path: path.replace(/\/decision$/, "/share"), shared: true }
        : null,
  }
}
