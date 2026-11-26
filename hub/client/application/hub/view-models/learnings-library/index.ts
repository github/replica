import type {
  LearningDetail,
  LearningEvidence,
  LearningStatus,
  LearningsLibraryData,
  LibraryLearning,
} from "@features/learnings-library/types"
import type {
  LearningEvidenceResponse,
  LearningHistoryResponse,
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
    })),
    ...state.learnings.map((entry) => {
      const guidance = entry.content ?? unavailableGuidance(entry.status)
      return {
        id: entry.id,
        status: "active" as const,
        title: titleFrom(entry.title, guidance),
        guidance,
        updatedAt: entry.acceptedAt,
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
      }
    }),
  ]
  const counts = {
    suggested: state.suggestions.length,
    active: state.learnings.length,
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

function detail(
  state: Overview,
  record: LearningRecord,
  history: LearningHistoryResponse | null,
): LearningDetail {
  const repositoryId = state.repository.id
  const path = `/repositories/${repositoryId}/learnings/${encodeURIComponent(record.id)}/decision`
  const canDecide = state.permissions.decide
  const shared = {
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
    contradictions: [],
    otherContradictions: null,
    history: (history?.decisions ?? []).map((entry) => ({
      label: changeLabels[entry.change],
      at: entry.at,
      // Agents propose suggestions under service identities rather than GitHub logins.
      by: entry.by?.includes(":") ? null : entry.by,
      reason: entry.reason,
    })),
  }
  const suggestion = state.suggestions.find((item) => item.id === record.id)
  if (record.status === "suggested" && suggestion) {
    return {
      ...shared,
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
      ...shared,
      facts: [
        ...(accepted.acceptedBy && accepted.acceptedAt
          ? [
              `Accepted by @${accepted.acceptedBy} on ${longDate(accepted.acceptedAt)}${
                accepted.edited ? ", with edits" : ""
              }`,
            ]
          : []),
        recallFact(accepted.status),
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
    }
  }
  const rejected = state.rejected.find((item) => item.id === record.id)
  const verb = rejected?.state === "retired" ? "Retired" : "Rejected"
  return {
    ...shared,
    facts:
      rejected?.decidedBy && rejected.decidedAt
        ? [`${verb} by @${rejected.decidedBy} on ${longDate(rejected.decidedAt)}`]
        : [],
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
  }
}
