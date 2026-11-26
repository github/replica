import { Button, Heading, Text } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubContentPageHeader } from "@components/hub-content-page-header"
import { HubToast } from "@components/hub-toast"
import { DecisionModelPanel } from "@features/decision-model-panel"
import { LearningsLibrary } from "@features/learnings-library"
import { RepositoryWorkspace } from "@features/repository-workspace"
import { ReviewRelativeTime } from "@features/review-relative-time"

import type { LearningsPageData } from "./types"
import "./styles.css"

/**
 * Shows a repository's learnings and what agents get. Members browse; repository
 * administrators also decide which learnings agents get.
 */
export function LearningsPage({
  data,
  decisionModelActionRevision = 0,
  decisionModelTrainingSubmitting = false,
  actionError = null,
}: {
  data: LearningsPageData
  decisionModelActionRevision?: number
  decisionModelTrainingSubmitting?: boolean
  /** A failed learning decision, which an open dialog must show itself. */
  actionError?: { error: string } | null
}) {
  return (
    <RepositoryWorkspace data={data}>
      {data.accessDenied ? (
        <div className="learnings-page">
          <HubContentPageHeader headingAs="h1" title="Learnings" />
          <HubAlert title={data.accessDeniedLabel} variant="warning" />
        </div>
      ) : (
        <LearningsContent
          data={data}
          decisionModelActionRevision={decisionModelActionRevision}
          decisionModelTrainingSubmitting={decisionModelTrainingSubmitting}
          actionError={actionError}
        />
      )}
    </RepositoryWorkspace>
  )
}

function LearningsContent({
  data,
  decisionModelActionRevision,
  decisionModelTrainingSubmitting,
  actionError,
}: {
  data: Extract<LearningsPageData, { accessDenied: false }>
  decisionModelActionRevision: number
  decisionModelTrainingSubmitting: boolean
  actionError: { error: string } | null
}) {
  const copy = data.copy

  // A selected learning replaces the overview so its decisions have the page's focus.
  if (data.library.selected) {
    return (
      <div className="learnings-page">
        {data.alert ? <HubAlert title={data.alert} variant="critical" /> : null}
        {data.notice ? <HubToast title={data.notice} /> : null}
        <LearningsLibrary
          data={data.library}
          authenticityToken={data.authenticityToken}
          error={actionError}
        />
      </div>
    )
  }

  return (
    <div className="learnings-page">
      <HubContentPageHeader
        headingAs="h1"
        title={copy.heading}
        description={copy.description}
        trailing={
          <div className="learnings-page__header-actions">
            {data.evaluationsPath ? (
              <Button as="a" href={data.evaluationsPath} variant="secondary">
                Automated evaluations
              </Button>
            ) : null}
            {data.agentsPath ? (
              <Button as="a" href={data.agentsPath} variant="secondary">
                Connect an agent
              </Button>
            ) : null}
            {data.run.available ? (
              <form action={data.run.path} method="post">
                <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
                <Button type="submit" variant="secondary">
                  {copy.runLabel}
                </Button>
              </form>
            ) : null}
          </div>
        }
      />
      {data.alert ? <HubAlert title={data.alert} variant="critical" /> : null}
      {data.notice ? <HubToast title={data.notice} /> : null}
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
        {data.status.usage ? (
          <Text as="p" size="200" variant="muted">
            {data.status.usage}
          </Text>
        ) : null}
      </div>

      <LearningsLibrary
        data={data.library}
        authenticityToken={data.authenticityToken}
        error={actionError}
      />

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

      {data.runs ? (
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
      ) : null}

      <DecisionModelPanel
        key={
          data.decisionModel.state === "available"
            ? [
                data.decisionModel.settingsPath,
                data.decisionModel.configuration?.generation ?? "new",
                data.decisionModel.promotion?.generation ?? 0,
                data.decisionModel.activeJob?.id ?? "idle",
                data.decisionModel.activeJob?.state ?? "idle",
                data.decisionModel.readiness.latestTasksetDigest ?? "no-taskset",
                data.decisionModel.candidates
                  .map((candidate) => `${candidate.id}:${candidate.rejection?.rejectedAt ?? ""}`)
                  .join(","),
                decisionModelActionRevision,
              ].join(":")
            : `${data.selectedRepositoryId}:${data.decisionModel.state}:${decisionModelActionRevision}`
        }
        data={data.decisionModel}
        authenticityToken={data.authenticityToken}
        trainingSubmitting={decisionModelTrainingSubmitting}
      />
    </div>
  )
}
