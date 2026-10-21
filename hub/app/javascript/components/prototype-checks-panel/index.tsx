import { Button, Checkbox, Text } from "@primer/react-brand"
import { useEffect, useRef, useState } from "react"

import { HubAlert } from "@components/hub-alert"
import { HubSidebar } from "@components/hub-sidebar"

import { ChecksReadCoverage } from "@components/prototype-checks-read-coverage"
import { checksCopy as copy } from "./en"
import type { ChecksAction, ChecksState } from "@utils/prototype-checks/types"
import { summarizePrototypeChecks } from "@utils/summarize-prototype-checks"

import "./styles.css"

export function ChecksPanel({
  state,
  error,
  busy,
  onAction,
  onClose,
}: {
  state: ChecksState | null
  error: string | null
  busy: boolean
  onAction: (input: ChecksAction) => Promise<boolean>
  onClose: () => void
}) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const [scopeSelection, setScopeSelection] = useState<{ key?: string; pageIds: string[] } | null>(
    null,
  )
  const additionalPages =
    scopeSelection?.key === state?.selectionKey ? (scopeSelection?.pageIds ?? []) : []
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [requested, setRequested] = useState<string | null>(null)
  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true })
  }, [])
  const active = state?.checks.some((check) => ["running", "queued"].includes(check.status))
  const summary = summarizePrototypeChecks(state, error)
  return (
    <div
      className="canvas-checks-shell"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <HubSidebar
        title={copy.title}
        open
        className="canvas-checks-panel"
        contentClassName="canvas-checks-content"
        closeLabel={copy.close}
        closeShortcut="Escape"
        closeRef={closeButton}
        onClose={onClose}
      >
        {error || state?.error ? <p role="alert">{error || state?.error}</p> : null}
        {!state ? <p role="status">{copy.loading}</p> : null}
        {state?.state === "unconfigured" ? (
          <HubAlert title={copy.unconfigured} variant="info" layout="compact" />
        ) : null}
        {state?.state === "no_pages" ? <p>{copy.noPages}</p> : null}
        {state && state.state !== "unconfigured" ? (
          <p role="status">
            <strong>{summary.description}</strong>
          </p>
        ) : null}
        {state?.state === "scope_required" ? (
          <section aria-label={copy.scope}>
            <h3>{copy.scope}</h3>
            <p>{copy.scopeDescription}</p>
            <ul>
              {state.unknown.map((file) => (
                <li key={file}>
                  <code>{file}</code>
                </li>
              ))}
            </ul>
            {state.availablePages
              .filter((page) => !state.pages.some((included) => included.id === page.id))
              .map((page) => (
                <label key={page.id} className="canvas-checks-choice">
                  <Checkbox
                    checked={additionalPages.includes(page.id)}
                    onChange={(event) =>
                      setScopeSelection((previous) => {
                        const ids =
                          previous?.key === state.selectionKey ? (previous?.pageIds ?? []) : []
                        return {
                          key: state.selectionKey,
                          pageIds: event.target.checked
                            ? [...ids, page.id]
                            : ids.filter((id) => id !== page.id),
                        }
                      })
                    }
                  />
                  {page.name} <code>{page.route}</code>
                </label>
              ))}
            <Button
              size="small"
              disabled={busy || !state.selectionKey}
              onClick={() => {
                if (state.selectionKey)
                  void onAction({
                    action: "scope",
                    key: state.selectionKey,
                    pageIds: additionalPages,
                  })
              }}
            >
              {copy.confirmScope}
            </Button>
          </section>
        ) : null}
        {state?.pages.length ? (
          <section aria-label={copy.pages}>
            <h3>{copy.pages}</h3>
            <ul>
              {state.pages.map((page) => (
                <li key={page.id}>
                  {page.name} <code>{page.route}</code>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {state?.checks.length ? (
          <div className="canvas-checks-actions">
            <Button
              size="small"
              disabled={busy || state.state !== "ready"}
              onClick={() => void onAction({ action: "run" })}
            >
              {copy.runAll}
            </Button>
            {active ? (
              <Button
                size="small"
                variant="secondary"
                disabled={busy}
                onClick={() => void onAction({ action: "cancel" })}
              >
                {copy.cancelAll}
              </Button>
            ) : null}
          </div>
        ) : null}
        {state?.checks.map((check) => {
          const key = `${check.id}:${check.runId}`
          const ids = selected[key] ?? []
          const running = ["running", "queued"].includes(check.status)
          return (
            <section key={check.id} className="canvas-check-card" aria-label={check.name}>
              <h3>{check.name}</h3>
              <p>
                {check.status === "completed" && check.outcome
                  ? copy.criterionStatus[check.outcome]
                  : copy.status[check.status]}
                <br />
                <Text size="100">
                  {check.runner}
                  <br />
                  {check.automatic ? copy.automatic : copy.manual}
                </Text>
              </p>
              {check.summary ? <p>{check.summary}</p> : null}
              {check.limitations?.length ? (
                <section aria-label={copy.limitations}>
                  <h4>{copy.limitations}</h4>
                  <ul>
                    {check.limitations.map((limitation, index) => (
                      <li key={index}>{limitation}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {check.coverageReason ? <p>{copy.coverageReason[check.coverageReason]}</p> : null}
              {check.error ? <p role="alert">{check.error}</p> : null}
              <Button
                size="small"
                variant="secondary"
                disabled={
                  busy || check.status === "not_applicable" || (!running && state.state !== "ready")
                }
                onClick={() =>
                  void onAction({ action: running ? "cancel" : "run", checkIds: [check.id] })
                }
              >
                {running
                  ? copy.cancel
                  : ["execution_error", "cancelled"].includes(check.status)
                    ? copy.retry
                    : copy.run}
              </Button>
              {check.criteria.length ? (
                <section aria-label={copy.criteria}>
                  <h4>{copy.criteria}</h4>
                  <ul className="canvas-check-criteria">
                    {check.criteria.map((criterion) => (
                      <li key={criterion.id}>
                        <details className="canvas-check-criterion">
                          <summary>
                            <span className="canvas-check-criterion__name">
                              {criterion.name || criterion.id.replaceAll("-", " ")}
                            </span>{" "}
                            <span
                              className={`canvas-check-criterion__status canvas-check-criterion__status--${criterion.status}`}
                            >
                              {copy.criterionStatus[criterion.status]}
                            </span>
                          </summary>
                          {criterion.coverageReason ? (
                            <p>{copy.coverageReason[criterion.coverageReason]}</p>
                          ) : null}
                          <p className="canvas-check-criterion__evidence">{criterion.evidence}</p>
                        </details>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {check.runner === "agent" && check.status === "completed" ? (
                <ChecksReadCoverage key={check.runId} coverage={check.readCoverage} />
              ) : null}
              {check.findings.map((finding) => (
                <details key={finding.id}>
                  <summary>
                    {copy.severity[finding.severity]}: {finding.title}
                  </summary>
                  <p>{finding.description}</p>
                  <p>{finding.evidence}</p>
                  {finding.file ? (
                    <code>
                      {finding.file}
                      {finding.line ? `:${finding.line}` : ""}
                    </code>
                  ) : null}
                  <label className="canvas-checks-choice">
                    <Checkbox
                      checked={ids.includes(finding.id)}
                      onChange={(event) =>
                        setSelected((previous) => ({
                          ...previous,
                          [key]: event.target.checked
                            ? [...ids, finding.id]
                            : ids.filter((id) => id !== finding.id),
                        }))
                      }
                    />
                    {copy.selectForFix(finding.title)}
                  </label>
                </details>
              ))}
              {check.findings.length && check.runId ? (
                <Button
                  size="small"
                  disabled={busy || !ids.length || check.status !== "completed"}
                  onClick={async () => {
                    if (
                      check.runId &&
                      (await onAction({
                        action: "fix",
                        checkId: check.id,
                        runId: check.runId,
                        findingIds: ids,
                      }))
                    ) {
                      setRequested(key)
                      setSelected((previous) => ({ ...previous, [key]: [] }))
                    }
                  }}
                >
                  {requested === key ? copy.requested : copy.fix}
                </Button>
              ) : null}
            </section>
          )
        })}
        {state?.state === "error" ? (
          <Button
            size="small"
            variant="secondary"
            disabled={busy || active}
            onClick={() => void onAction({ action: "reset" })}
          >
            {copy.reset}
          </Button>
        ) : null}
      </HubSidebar>
    </div>
  )
}
