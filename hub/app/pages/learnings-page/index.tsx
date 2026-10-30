import { type ReactNode, type RefObject, useRef, useState } from "react"
import { Button, FormControl, Heading, Text, Textarea } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubContentPageHeader } from "@components/hub-content-page-header"
import { HubCounter } from "@components/hub-counter"
import { HubUserAvatar } from "@components/hub-user-avatar"
import { RepositoryWorkspace } from "@features/repository-workspace"
import { ReviewRelativeTime } from "@features/review-relative-time"

import type { AcceptedLearning, LearningSuggestion, LearningsPageData } from "./types"
import "./styles.css"

type Copy = LearningsPageData["copy"]

/** Shows what Hub suggests and what agents get, so a repository administrator decides both. */
export function LearningsPage({ data }: { data: LearningsPageData }) {
  const copy = data.copy

  return (
    <RepositoryWorkspace data={data}>
      <div className="learnings-page">
        <HubContentPageHeader
          headingAs="h1"
          title={copy.heading}
          description={copy.description}
          trailing={
            data.run.available ? (
              <form action={data.run.path} method="post">
                <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
                <Button type="submit" variant="secondary">
                  {copy.runLabel}
                </Button>
              </form>
            ) : null
          }
        />
        {data.alert ? <HubAlert title={data.alert} variant="critical" /> : null}
        {data.notice ? <HubAlert title={data.notice} variant="success" /> : null}
        {data.loadError ? <HubAlert title={data.loadError} variant="critical" /> : null}
        {data.identityNotice ? <HubAlert title={data.identityNotice} variant="warning" /> : null}

        <div className="learnings-page__status">
          {data.status.refused ? (
            <HubAlert title={data.status.message} variant="warning" />
          ) : (
            <Text as="p">{data.status.message}</Text>
          )}
          {data.status.activity ? (
            <Text as="p" role="status">
              {data.status.activity}
            </Text>
          ) : null}
          <Text as="p" size="200" variant="muted">
            {data.status.usage}
          </Text>
        </div>

        <section className="learnings-page__section" aria-labelledby="learnings-suggestions">
          <div className="learnings-page__section-header">
            <Heading as="h2" size="5" id="learnings-suggestions">
              {copy.suggestionsHeading}
            </Heading>
            <HubCounter>{data.suggestions.length}</HubCounter>
          </div>
          {data.suggestions.length ? (
            data.suggestions.map((suggestion) => (
              <Suggestion
                key={suggestion.id}
                suggestion={suggestion}
                copy={copy}
                authenticityToken={data.authenticityToken}
              />
            ))
          ) : (
            <Text as="p">{copy.suggestionsEmpty}</Text>
          )}
        </section>

        <section className="learnings-page__section" aria-labelledby="learnings-accepted">
          <div className="learnings-page__section-header">
            <Heading as="h2" size="5" id="learnings-accepted">
              {copy.acceptedHeading}
            </Heading>
            <HubCounter>{data.learnings.length}</HubCounter>
          </div>
          {data.learnings.length ? (
            data.learnings.map((learning) => (
              <Learning
                key={learning.id}
                learning={learning}
                copy={copy}
                authenticityToken={data.authenticityToken}
              />
            ))
          ) : (
            <Text as="p">{copy.acceptedEmpty}</Text>
          )}
        </section>

        <section className="learnings-page__section" aria-labelledby="learnings-recall">
          <Heading as="h2" size="5" id="learnings-recall">
            {copy.recallHeading}
          </Heading>
          <Text as="p">{copy.recallDescription}</Text>
          {data.recall.count ? (
            <pre
              className="learnings-page__recall"
              role="region"
              aria-labelledby="learnings-recall"
              tabIndex={0}
            >
              {data.recall.text}
            </pre>
          ) : (
            <Text as="p">{copy.recallEmpty}</Text>
          )}
        </section>

        <section className="learnings-page__section" aria-labelledby="learnings-runs">
          <Heading as="h2" size="5" id="learnings-runs">
            {copy.runsHeading}
          </Heading>
          {data.runs.length ? (
            <div
              className="learnings-page__runs"
              role="region"
              aria-labelledby="learnings-runs"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">{copy.runColumns.started}</th>
                    <th scope="col">{copy.runColumns.startedBy}</th>
                    <th scope="col">{copy.runColumns.result}</th>
                    <th scope="col">{copy.runColumns.usage}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <ReviewRelativeTime value={run.startedAt} />
                      </td>
                      <td>{run.startedBy}</td>
                      <td>
                        <span className="learnings-page__run-state">{run.stateLabel}</span>
                        {run.result ? `: ${run.result}` : null}
                      </td>
                      <td>{run.usage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Text as="p">{copy.runsEmpty}</Text>
          )}
        </section>
      </div>
    </RepositoryWorkspace>
  )
}

/** One suggestion, the comments behind it, and the decision forms beside it. */
function Suggestion({
  suggestion,
  copy,
  authenticityToken,
}: {
  suggestion: LearningSuggestion
  copy: Copy
  authenticityToken: string
}) {
  const [mode, setMode] = useState<"choose" | "edit" | "reject">("choose")
  const editButton = useRef<HTMLButtonElement>(null)
  const rejectButton = useRef<HTMLButtonElement>(null)
  const contentId = `suggestion-${suggestion.id}`

  // The button that opened the form mounts again only after this render, so read its ref then.
  function cancel(returnTo: RefObject<HTMLButtonElement | null>) {
    setMode("choose")
    window.requestAnimationFrame(() => returnTo.current?.focus())
  }

  return (
    <article className="learnings-page__card" aria-labelledby={contentId}>
      <Text as="p" id={contentId} className="learnings-page__content">
        {suggestion.content}
      </Text>
      {suggestion.support ? (
        <Text as="p" size="200" variant="muted">
          {suggestion.support}
        </Text>
      ) : null}
      {suggestion.replaces.length ? (
        <>
          <HubAlert title={copy.replacementHeading} variant="info" />
          <ul className="learnings-page__replacements" aria-label={copy.replacementHeading}>
            {suggestion.replaces.map((target) => (
              <li key={target.id} className="learnings-page__replacement">
                <code>{target.id}</code>
                <Text as="p">{target.content}</Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {[
        {
          heading: copy.evidenceHeading,
          evidence: suggestion.evidence,
          otherEvidence: suggestion.otherEvidence,
        },
        {
          heading: copy.contradictionsHeading,
          evidence: suggestion.contradictions,
          otherEvidence: suggestion.otherContradictions,
        },
      ].map((group) =>
        group.evidence.length || group.otherEvidence ? (
          <details key={group.heading} className="learnings-page__evidence">
            <summary>{group.heading}</summary>
            <ul>
              {group.evidence.map((item) => (
                <li key={item.eventId} className="learnings-page__comment">
                  <div className="learnings-page__comment-meta">
                    <HubUserAvatar src={item.authorAvatarUrl} size={20} />
                    <span>@{item.authorLogin}</span>
                    <span aria-hidden="true">·</span>
                    <a href={item.prototypePath}>{item.prototypeName}</a>
                    <span aria-hidden="true">·</span>
                    <ReviewRelativeTime value={item.createdAt} />
                  </div>
                  <Text as="p" variant={item.body === null ? "muted" : "default"}>
                    {item.body ?? copy.deletedComment}
                  </Text>
                </li>
              ))}
            </ul>
            {group.otherEvidence ? (
              <Text as="p" size="200" variant="muted">
                {group.otherEvidence}
              </Text>
            ) : null}
          </details>
        ) : null,
      )}

      {mode === "choose" ? (
        <div className="learnings-page__actions">
          <DecisionForm
            path={suggestion.decisionPath}
            decision="accept"
            digest={suggestion.digest}
            authenticityToken={authenticityToken}
          >
            <Button type="submit" variant="primary">
              {copy.accept}
            </Button>
          </DecisionForm>
          <Button
            ref={editButton}
            type="button"
            variant="secondary"
            onClick={() => setMode("edit")}
          >
            {copy.edit}
          </Button>
          <Button
            ref={rejectButton}
            type="button"
            variant="secondary"
            onClick={() => setMode("reject")}
          >
            {copy.reject}
          </Button>
        </div>
      ) : (
        <DecisionForm
          path={suggestion.decisionPath}
          decision={mode === "edit" ? "accept" : "reject"}
          digest={suggestion.digest}
          authenticityToken={authenticityToken}
        >
          <FormControl id={`${contentId}-${mode}`} fullWidth required>
            <FormControl.Label>
              {mode === "edit" ? copy.contentLabel : copy.rejectReason}
            </FormControl.Label>
            <Textarea
              name={mode === "edit" ? "content" : "reason"}
              defaultValue={mode === "edit" ? suggestion.content : ""}
              maxLength={mode === "edit" ? 2000 : 500}
              rows={3}
              fullWidth
              resize="vertical"
              required
              autoFocus
            />
          </FormControl>
          <div className="learnings-page__actions">
            <Button type="submit" variant={mode === "edit" ? "primary" : "secondary"}>
              {mode === "edit" ? copy.acceptEdited : copy.confirmReject}
            </Button>
            <Button
              type="button"
              variant="subtle"
              onClick={() => cancel(mode === "edit" ? editButton : rejectButton)}
            >
              {copy.cancel}
            </Button>
          </div>
        </DecisionForm>
      )}
    </article>
  )
}

/** One accepted learning, whether agents get it, and a way to retire it. */
function Learning({
  learning,
  copy,
  authenticityToken,
}: {
  learning: AcceptedLearning
  copy: Copy
  authenticityToken: string
}) {
  const [retiring, setRetiring] = useState(false)
  const retireButton = useRef<HTMLButtonElement>(null)
  const contentId = `learning-${learning.id}`

  return (
    <article className="learnings-page__card" aria-labelledby={contentId}>
      <Text as="p" id={contentId} className="learnings-page__content">
        {learning.content}
      </Text>
      {learning.accepted ? (
        <Text as="p" size="200" variant="muted">
          {learning.accepted}
        </Text>
      ) : null}
      <Text as="p" size="200" variant={learning.recalled ? "default" : "muted"}>
        {learning.status}
      </Text>
      {retiring ? (
        <DecisionForm
          path={learning.decisionPath}
          decision="retire"
          authenticityToken={authenticityToken}
        >
          <FormControl id={`${contentId}-retire`} fullWidth required>
            <FormControl.Label>{copy.retireReason}</FormControl.Label>
            <Textarea
              name="reason"
              maxLength={500}
              rows={2}
              fullWidth
              resize="vertical"
              required
              autoFocus
            />
          </FormControl>
          <div className="learnings-page__actions">
            <Button type="submit" variant="secondary">
              {copy.confirmRetire}
            </Button>
            <Button
              type="button"
              variant="subtle"
              onClick={() => {
                setRetiring(false)
                window.requestAnimationFrame(() => retireButton.current?.focus())
              }}
            >
              {copy.cancel}
            </Button>
          </div>
        </DecisionForm>
      ) : (
        <div className="learnings-page__actions">
          <Button
            ref={retireButton}
            type="button"
            variant="secondary"
            onClick={() => setRetiring(true)}
          >
            {copy.retire}
          </Button>
        </div>
      )}
    </article>
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
  decision: "accept" | "reject" | "retire"
  digest?: string
  authenticityToken: string
  children: ReactNode
}) {
  return (
    <form action={path} method="post" className="learnings-page__form">
      <input type="hidden" name="authenticity_token" value={authenticityToken} />
      <input type="hidden" name="decision" value={decision} />
      {digest ? <input type="hidden" name="digest" value={digest} /> : null}
      {children}
    </form>
  )
}
