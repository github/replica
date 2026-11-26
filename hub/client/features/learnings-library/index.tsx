import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  LightBulbIcon,
  SearchIcon,
  XCircleIcon,
  type Icon,
} from "@primer/octicons-react"
import {
  Button,
  FormControl,
  Heading,
  Label,
  Pagination,
  Text,
  TextInput,
  Textarea,
} from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubCounter } from "@components/hub-counter"
import { HubEmptyState } from "@components/hub-empty-state"
import { HubUserAvatar } from "@components/hub-user-avatar"
import { CanvasDialog } from "@components/prototype-canvas-dialog"
import { ReviewRelativeTime } from "@features/review-relative-time"

import type {
  LearningDetail,
  LearningEvidence,
  LearningStatus,
  LearningsLibraryData,
} from "./types"
import "./styles.css"

const statuses = ["suggested", "active", "rejected"] as const

const statusLabels: Record<LearningStatus, string> = {
  suggested: "Suggested",
  active: "Active",
  rejected: "Rejected",
}

// Mirrors GitHub's pull request states so people can read status at a glance.
const statusIcons: Record<LearningStatus, Icon> = {
  suggested: LightBulbIcon,
  active: CheckCircleIcon,
  rejected: XCircleIcon,
}

const statusLabelColors = {
  suggested: "default",
  active: "green",
  rejected: "red",
} as const satisfies Record<LearningStatus, string>

const emptyMessages: Record<LearningStatus, string> = {
  suggested: "Hub suggests a learning when the same point comes up in at least two review threads.",
  active: "Accept a suggestion to share it with agents.",
  rejected: "Learnings you reject or stop using stay here so you can accept them again.",
}

/** Renders a learning's state icon; Brand labels need an element, not a component. */
function StatusIcon({ status, className }: { status: LearningStatus; className?: string }) {
  const Glyph = statusIcons[status]
  return <Glyph className={className} size={16} />
}

/**
 * Lists a repository's learnings by status and shows one in detail. Members browse;
 * repository administrators also decide what agents get.
 */
export function LearningsLibrary({
  data,
  authenticityToken,
  error = null,
}: {
  data: LearningsLibraryData
  authenticityToken: string
  /** A failed decision, shown inside the dialog that is still open. */
  error?: { error: string } | null
}) {
  const selectedId = data.selected?.id ?? null
  const previousId = useRef<string | null | undefined>(undefined)
  // Opening or closing a learning only changes the query string, so the page does not
  // move focus. Move it here so keyboard and screen-reader users land in the new view.
  useEffect(() => {
    const before = previousId.current
    previousId.current = selectedId
    if (before === undefined || before === selectedId) return
    const target = selectedId
      ? document.getElementById("learning-detail-heading")
      : (document.querySelector<HTMLElement>(`[data-learning-id="${CSS.escape(before ?? "")}"]`) ??
        document.getElementById("learning-list-heading"))
    target?.focus()
  }, [selectedId])

  return data.selected ? (
    <LearningDetailView
      // A decision changes the status or digest, which closes any open dialog. A failed
      // save changes neither, so people keep what they typed.
      key={`${data.selected.id}:${data.selected.status}:${data.selected.decision?.digest ?? ""}`}
      learning={data.selected}
      backPath={data.returnPath}
      authenticityToken={authenticityToken}
      error={error}
    />
  ) : (
    <LearningList data={data} />
  )
}

function LearningList({ data }: { data: LearningsLibraryData }) {
  function pageHref(page: number) {
    const url = new URL(data.listPath, window.location.origin)
    if (page > 1) url.searchParams.set("page", String(page))
    return `${url.pathname}${url.search}`
  }
  const searchPath = new URL(data.listPath, window.location.origin).pathname

  return (
    <section className="learning-library" aria-labelledby="learning-list-heading">
      <Heading as="h2" size="5" id="learning-list-heading" tabIndex={-1}>
        Browse learnings
      </Heading>
      <div className="learning-library__toolbar">
        <nav className="learning-library__filters" aria-label="Learning status">
          {statuses.map((status) => (
            <a
              aria-current={data.status === status ? "true" : undefined}
              className="learning-library__filter"
              href={data.statusPaths[status]}
              key={status}
            >
              <StatusIcon status={status} />
              {statusLabels[status]}
              <HubCounter>{data.counts[status]}</HubCounter>
            </a>
          ))}
        </nav>
        <form action={searchPath} className="learning-library__search" method="get" role="search">
          <input type="hidden" name="status" value={data.status} />
          <FormControl fullWidth id="learning-search">
            <FormControl.Label visuallyHidden>Search learnings</FormControl.Label>
            <TextInput
              // Back and forward change the applied search without remounting the
              // list, so a new search resets what was typed.
              key={data.query}
              defaultValue={data.query}
              fullWidth
              leadingVisual={<SearchIcon />}
              maxLength={200}
              name="q"
              placeholder="Search learnings"
              type="search"
            />
          </FormControl>
        </form>
      </div>
      {data.learnings.length ? (
        <div className="learning-library__table-wrap">
          <table className="learning-library__table">
            <thead>
              <tr>
                <th scope="col">Learning</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.learnings.map((learning) => (
                <tr key={learning.id}>
                  <td>
                    <div className="learning-library__learning-cell">
                      <StatusIcon
                        className={`learning-library__state-icon learning-library__state-icon--${learning.status}`}
                        status={learning.status}
                      />
                      <div>
                        <a
                          className="learning-library__learning-link"
                          data-learning-id={learning.id}
                          href={learning.detailPath}
                        >
                          {learning.title}
                        </a>
                        <p>{learning.guidance}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    {learning.updatedAt ? <ReviewRelativeTime value={learning.updatedAt} /> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <HubEmptyState
          heading={`No ${statusLabels[data.status].toLowerCase()} learnings`}
          description={data.query ? "Try another search." : emptyMessages[data.status]}
        />
      )}
      {data.pageCount > 1 ? (
        <Pagination
          aria-label="Learnings pages"
          className="learning-library__pagination"
          currentPage={data.page}
          hrefBuilder={pageHref}
          pageCount={data.pageCount}
        />
      ) : null}
    </section>
  )
}

function LearningDetailView({
  learning,
  backPath,
  authenticityToken,
  error,
}: {
  learning: LearningDetail
  backPath: string
  authenticityToken: string
  error: { error: string } | null
}) {
  const [dialog, setDialog] = useState<"reject" | "edit" | "retire" | "reinstate" | null>(null)
  // An error from an earlier attempt does not belong to a dialog opened afterwards.
  const [staleError, setStaleError] = useState(error)
  const decision = learning.decision

  function open(next: NonNullable<typeof dialog>) {
    setStaleError(error)
    setDialog(next)
  }

  return (
    <div className="learning-library__detail">
      <a className="learning-library__back" href={backPath}>
        <ArrowLeftIcon size={16} />
        Back to learnings
      </a>
      <header className="learning-library__detail-header">
        <div>
          <Label
            color={statusLabelColors[learning.status]}
            leadingVisual={<StatusIcon status={learning.status} />}
          >
            {statusLabels[learning.status]}
          </Label>
          <Heading
            as="h1"
            className="learning-library__title"
            id="learning-detail-heading"
            size="6"
            tabIndex={-1}
          >
            {learning.title}
          </Heading>
          <Text as="p" className="learning-library__guidance">
            {learning.guidance}
          </Text>
          {learning.facts.length ? (
            <ul className="learning-library__facts">
              {learning.facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {decision ? (
          <div className="learning-library__actions">
            {learning.status === "suggested" ? (
              <>
                <DecisionForm
                  decision="accept"
                  digest={decision.digest}
                  path={decision.path}
                  authenticityToken={authenticityToken}
                >
                  <Button type="submit" variant="primary">
                    Accept learning
                  </Button>
                </DecisionForm>
                <Button type="button" variant="secondary" onClick={() => open("reject")}>
                  Reject suggestion
                </Button>
              </>
            ) : learning.status === "active" ? (
              <>
                <Button type="button" variant="secondary" onClick={() => open("edit")}>
                  Edit learning
                </Button>
                <Button type="button" variant="secondary" onClick={() => open("retire")}>
                  Reject learning
                </Button>
              </>
            ) : (
              <Button type="button" variant="primary" onClick={() => open("reinstate")}>
                Accept learning
              </Button>
            )}
          </div>
        ) : null}
      </header>

      {learning.reason ? (
        <div className="learning-library__reason">
          <strong>
            <XCircleIcon size={16} />
            {learning.reason.heading}
          </strong>
          <Text as="p">{learning.reason.text}</Text>
        </div>
      ) : null}

      {learning.replaces.length ? (
        <DetailSection
          heading="Accepting this replaces"
          description="Agents stop getting this guidance."
        >
          <ul className="learning-library__evidence-list">
            {learning.replaces.map((target) => (
              <li className="learning-library__evidence-item" key={target.id}>
                <Text as="p" size="200">
                  {target.content}
                </Text>
              </li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {learning.history.length ? (
        <DetailSection heading="Decision history">
          <ul className="learning-library__history">
            {learning.history.map((entry, index) => (
              <li key={`${entry.label}-${entry.at ?? index}`}>
                <span>
                  <strong>{entry.label}</strong>
                  {entry.by ? ` by @${entry.by}` : null}
                  {entry.at ? (
                    <>
                      {" · "}
                      <ReviewRelativeTime value={entry.at} />
                    </>
                  ) : null}
                </span>
                {entry.reason ? <p>{entry.reason}</p> : null}
              </li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {learning.evidence.length || learning.otherEvidence ? (
        <DetailSection
          heading="Review comments"
          description="The feedback this learning came from."
        >
          <EvidenceList evidence={learning.evidence} other={learning.otherEvidence} />
        </DetailSection>
      ) : null}

      {learning.contradictions.length || learning.otherContradictions ? (
        <DetailSection heading="What reviewers disagreed with">
          <EvidenceList evidence={learning.contradictions} other={learning.otherContradictions} />
        </DetailSection>
      ) : null}

      {decision && dialog ? (
        <CanvasDialog
          title={
            dialog === "edit"
              ? "Edit learning"
              : dialog === "reinstate"
                ? "Accept learning"
                : dialog === "reject"
                  ? "Reject suggestion"
                  : "Reject learning"
          }
          closeLabel="Cancel"
          descriptionId="learning-decision-description"
          onClose={() => setDialog(null)}
        >
          <p id="learning-decision-description">
            {dialog === "edit"
              ? "Agents get the new wording. The decision history keeps your reason."
              : dialog === "reinstate"
                ? "Agents get this learning again."
                : "Agents do not get rejected learnings. You can accept it later."}
          </p>
          {error && error !== staleError ? (
            <HubAlert title={error.error} variant="critical" layout="compact" />
          ) : null}
          <DecisionForm
            authenticityToken={authenticityToken}
            decision={dialog}
            digest={dialog === "retire" ? undefined : decision.digest}
            path={decision.path}
          >
            {dialog === "edit" ? (
              <>
                <FormControl id="learning-edit-title" fullWidth>
                  <FormControl.Label>Title</FormControl.Label>
                  <TextInput name="title" defaultValue={decision.title} maxLength={120} fullWidth />
                </FormControl>
                <FormControl id="learning-edit-content" fullWidth required>
                  <FormControl.Label>Guidance</FormControl.Label>
                  <Textarea
                    name="content"
                    defaultValue={decision.content}
                    maxLength={2000}
                    rows={4}
                    fullWidth
                    resize="vertical"
                    required
                  />
                </FormControl>
              </>
            ) : null}
            <FormControl id="learning-decision-reason" fullWidth required>
              <FormControl.Label>
                {dialog === "edit"
                  ? "Why change it?"
                  : dialog === "reinstate"
                    ? "Why accept it now?"
                    : "Why reject it?"}
              </FormControl.Label>
              <Textarea
                name="reason"
                maxLength={500}
                rows={3}
                fullWidth
                resize="vertical"
                required
              />
            </FormControl>
            <div className="learning-library__actions">
              <Button
                type="submit"
                variant={dialog === "edit" || dialog === "reinstate" ? "primary" : "secondary"}
              >
                {dialog === "edit"
                  ? "Save changes"
                  : dialog === "reinstate"
                    ? "Accept learning"
                    : dialog === "reject"
                      ? "Reject suggestion"
                      : "Reject learning"}
              </Button>
              <Button type="button" variant="subtle" onClick={() => setDialog(null)}>
                Cancel
              </Button>
            </div>
          </DecisionForm>
        </CanvasDialog>
      ) : null}
    </div>
  )
}

function DetailSection({
  heading,
  description,
  children,
}: {
  heading: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="learning-library__section" aria-label={heading}>
      <div className="learning-library__section-header">
        <Heading as="h2" className="learning-library__section-heading" size="6">
          {heading}
        </Heading>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function EvidenceList({ evidence, other }: { evidence: LearningEvidence[]; other: string | null }) {
  return (
    <>
      {evidence.length ? (
        <ul className="learning-library__evidence-list">
          {evidence.map((item) => (
            <li className="learning-library__evidence-item" key={item.eventId}>
              <div className="learning-library__evidence-meta">
                <HubUserAvatar src={item.authorAvatarUrl} size={20} />
                <strong>@{item.authorLogin}</strong>
                <span aria-hidden="true">·</span>
                <a href={item.prototypePath}>{item.prototypeName}</a>
                <span aria-hidden="true">·</span>
                <ReviewRelativeTime value={item.createdAt} />
              </div>
              <Text as="p" size="200" variant={item.body === null ? "muted" : "default"}>
                {item.body ?? "The user deleted this comment."}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}
      {other ? (
        <Text as="p" size="200" variant="muted">
          {other}
        </Text>
      ) : null}
    </>
  )
}

function DecisionForm({
  path,
  decision,
  digest,
  authenticityToken,
  children,
}: {
  path: string
  decision: "accept" | "reject" | "retire" | "edit" | "reinstate"
  digest?: string
  authenticityToken: string
  children: ReactNode
}) {
  return (
    <form action={path} method="post" className="learning-library__form">
      <input type="hidden" name="authenticity_token" value={authenticityToken} />
      <input type="hidden" name="decision" value={decision} />
      {digest ? <input type="hidden" name="digest" value={digest} /> : null}
      {children}
    </form>
  )
}
