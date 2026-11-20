import { useRef, useState } from "react"
import { Button, Checkbox, FormControl, Heading, Text, TextInput } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"

import "./styles.css"
import type { DecisionCandidate, DecisionModelPanelData, DecisionTrainingJob } from "./types"

/** Repository decision-model settings, training progress, and explicit model decisions. */
export function DecisionModelPanel({
  data,
  authenticityToken,
}: {
  data: DecisionModelPanelData
  authenticityToken: string
}) {
  if (data.state === "repository-learning-only") {
    return (
      <section className="decision-model-panel" aria-labelledby="decision-model-heading">
        <Heading as="h2" size="5" id="decision-model-heading">
          Decision model
        </Heading>
        <HubAlert title={data.message} variant="info" />
      </section>
    )
  }
  if (data.state === "not-configured") {
    return (
      <section className="decision-model-panel" aria-labelledby="decision-model-heading">
        <Heading as="h2" size="5" id="decision-model-heading">
          Decision model
        </Heading>
        <HubAlert title={data.message} variant="warning" />
        <Text as="p">{data.setupGuidance}</Text>
      </section>
    )
  }
  if (data.state === "unavailable") {
    return (
      <section className="decision-model-panel" aria-labelledby="decision-model-heading">
        <Heading as="h2" size="5" id="decision-model-heading">
          Decision model
        </Heading>
        <HubAlert title={data.message} variant="critical" />
        <Text as="p">{data.setupGuidance}</Text>
      </section>
    )
  }
  return <AvailableDecisionModel data={data} authenticityToken={authenticityToken} />
}

function AvailableDecisionModel({
  data,
  authenticityToken,
}: {
  data: Extract<DecisionModelPanelData, { state: "available" }>
  authenticityToken: string
}) {
  const [confirmTraining, setConfirmTraining] = useState(false)
  const [promoting, setPromoting] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [idempotencyKey] = useState(() => `hub-ui-${crypto.randomUUID()}`)
  const trainingButton = useRef<HTMLButtonElement>(null)
  const rollbackButton = useRef<HTMLButtonElement>(null)
  const generation = data.promotion?.generation ?? 0

  return (
    <section className="decision-model-panel" aria-labelledby="decision-model-heading">
      <div className="decision-model-panel__heading">
        <div>
          <Heading as="h2" size="5" id="decision-model-heading">
            Decision model
          </Heading>
          <Text as="p">
            A decision model checks Build screenshots against accepted learnings. Training and
            promotion always require a person&apos;s decision.
          </Text>
        </div>
        <span className="decision-model-panel__badge">
          {data.configuration?.enabled ? "Training enabled" : "Training paused"}
        </span>
      </div>

      <div className="decision-model-panel__grid">
        <article className="decision-model-panel__card" aria-labelledby="decision-model-settings">
          <Heading as="h3" size="4" id="decision-model-settings">
            Repository settings
          </Heading>
          <Text as="p">
            These limits bound one training job and the repository&apos;s monthly training budget.
          </Text>
          <SettingsForm
            data={data}
            authenticityToken={authenticityToken}
            key={data.configuration?.generation ?? "new"}
          />
        </article>

        <article className="decision-model-panel__card" aria-labelledby="decision-model-readiness">
          <Heading as="h3" size="4" id="decision-model-readiness">
            Training readiness
          </Heading>
          <Text as="p">{data.readiness.runtime}</Text>
          <Text as="p">{data.readiness.evidence}</Text>
          {data.readiness.blockedReasons.length ? (
            <HubAlert
              title={`Blocked: ${data.readiness.blockedReasons.join(", ")}.`}
              variant="critical"
            />
          ) : null}
          {data.readiness.warnings.map((warning) => (
            <HubAlert key={warning} title={warning} variant="warning" />
          ))}
          {data.readiness.latestTasksetDigest ? (
            <p className="decision-model-panel__digest">
              Latest pinned taskset <code>{data.readiness.latestTasksetDigest}</code>
            </p>
          ) : null}
        </article>
      </div>

      {data.configuration?.backend === "fixture" ? (
        <HubAlert
          title="Fixture backend: these deterministic results are for local development and contract testing only. They are not evidence that a trained model improved."
          variant="warning"
        />
      ) : null}

      {data.deletions.length ? (
        <article className="decision-model-panel__card" aria-labelledby="decision-model-deletions">
          <Heading as="h3" size="4" id="decision-model-deletions">
            Runtime deletions
          </Heading>
          <Text as="p">
            Consent withdrawal can remove private exports, tasksets, and runtime artifacts without
            deleting the repository&apos;s decision history.
          </Text>
          <ul className="decision-model-panel__findings">
            {data.deletions.map((deletion) => (
              <li key={deletion.id}>
                <strong>
                  {deletion.state === "pending"
                    ? "Deletion pending"
                    : deletion.state === "completed"
                      ? "Deletion completed"
                      : "Deletion failed"}
                </strong>
                <Text as="p">{deletion.summary}</Text>
                {deletion.failure ? (
                  <Text as="p" variant="muted">
                    {deletion.failure}
                  </Text>
                ) : null}
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      <article className="decision-model-panel__card" aria-labelledby="decision-model-training">
        <div className="decision-model-panel__heading">
          <div>
            <Heading as="h3" size="4" id="decision-model-training">
              Training
            </Heading>
            <Text as="p">
              Hub creates a private taskset from permitted review evidence and immutable Build
              screenshots, then sends it to the customer-run runtime.
            </Text>
          </div>
          {!confirmTraining && data.trainingAvailable ? (
            <Button
              ref={trainingButton}
              type="button"
              variant="primary"
              onClick={() => setConfirmTraining(true)}
            >
              Start training
            </Button>
          ) : null}
        </div>

        {confirmTraining && data.configuration ? (
          <form action={data.trainingPath} method="post" className="decision-model-panel__confirm">
            <input type="hidden" name="authenticity_token" value={authenticityToken} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <input
              type="hidden"
              name="expectedConfigurationGeneration"
              value={data.configuration.generation}
            />
            <HubAlert
              title={`Confirm a job capped at ${data.configuration.maxUpdates.toLocaleString()} updates, ${formatDuration(data.configuration.maxSeconds)}, and ${data.configuration.monthlyBudgetCredits} credits within the monthly repository budget.`}
              variant="warning"
            />
            <Text as="p" size="200">
              Starting training does not promote its candidate.
            </Text>
            <div className="decision-model-panel__actions">
              <Button type="submit" variant="primary" autoFocus>
                Confirm and start training
              </Button>
              <Button
                type="button"
                variant="subtle"
                onClick={() => {
                  setConfirmTraining(false)
                  window.requestAnimationFrame(() => trainingButton.current?.focus())
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {data.activeJob ? (
          <HubAlert
            title={`${data.activeJob.stateLabel}: training is using the pinned evidence shown for this job.`}
            variant="info"
          />
        ) : !data.trainingAvailable ? (
          <Text as="p" size="200" variant="muted">
            {data.configuration === null
              ? "Save repository settings before starting training."
              : !data.configuration.enabled
                ? "Enable repository training before starting a job."
                : data.readiness.blockedReasons.length
                  ? "Resolve the evidence blockers before starting training."
                  : "Wait for the active job to finish before starting another."}
          </Text>
        ) : null}
        <TrainingJobs jobs={data.jobs} authenticityToken={authenticityToken} />
      </article>

      <article className="decision-model-panel__card" aria-labelledby="decision-model-candidates">
        <Heading as="h3" size="4" id="decision-model-candidates">
          Candidate comparison
        </Heading>
        <Text as="p">
          Held-out evidence is data reserved from training so a person can compare a candidate with
          the baseline it started from.
        </Text>
        {data.candidates.length ? (
          <div className="decision-model-panel__candidates">
            {data.candidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                allowPromotion={
                  candidate.productionEligible || data.configuration?.backend === "fixture"
                }
                expectedGeneration={generation}
                authenticityToken={authenticityToken}
                confirming={promoting === candidate.id}
                rejecting={rejecting === candidate.id}
                onConfirm={() => setPromoting(candidate.id)}
                onCancel={() => setPromoting(null)}
                onReject={() => setRejecting(candidate.id)}
                onCancelReject={() => setRejecting(null)}
              />
            ))}
          </div>
        ) : (
          <Text as="p">No training candidate has finished yet.</Text>
        )}
      </article>

      <article className="decision-model-panel__card" aria-labelledby="decision-model-current">
        <Heading as="h3" size="4" id="decision-model-current">
          Current promoted model
        </Heading>
        {data.promotion ? (
          <>
            <dl className="decision-model-panel__facts">
              <div>
                <dt>Runtime model</dt>
                <dd>{data.promotion.runtimeCandidateId}</dd>
              </div>
              <div>
                <dt>Promotion generation</dt>
                <dd>{data.promotion.generation}</dd>
              </div>
              <div>
                <dt>Last decision</dt>
                <dd>{data.promotion.operation === "promote" ? "Promoted" : "Rolled back"}</dd>
              </div>
            </dl>
            {!data.promotion.rollbackAvailable ? (
              <Text as="p" size="200" variant="muted">
                No eligible previous candidate is available to restore.
              </Text>
            ) : !confirmRollback ? (
              <Button
                ref={rollbackButton}
                type="button"
                variant="secondary"
                onClick={() => setConfirmRollback(true)}
              >
                Roll back to previous model
              </Button>
            ) : (
              <form
                action={data.rollbackPath}
                method="post"
                className="decision-model-panel__confirm"
              >
                <input type="hidden" name="authenticity_token" value={authenticityToken} />
                <input type="hidden" name="expectedGeneration" value={data.promotion.generation} />
                <HubAlert
                  title="Restore the previous candidate as a new promotion generation?"
                  variant="warning"
                />
                <div className="decision-model-panel__actions">
                  <Button type="submit" variant="danger" autoFocus>
                    Confirm rollback
                  </Button>
                  <Button
                    type="button"
                    variant="subtle"
                    onClick={() => {
                      setConfirmRollback(false)
                      window.requestAnimationFrame(() => rollbackButton.current?.focus())
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </>
        ) : (
          <Text as="p">No candidate is promoted. Build evaluation remains off.</Text>
        )}
      </article>

      <article className="decision-model-panel__card" aria-labelledby="decision-model-evaluate">
        <Heading as="h3" size="4" id="decision-model-evaluate">
          Evaluate a Build
        </Heading>
        <Text as="p">
          Hub sends the selected Build&apos;s captured views and accepted-learning questions to the
          currently promoted model, then saves the findings below.
        </Text>
        {!data.promotion ? (
          <Text as="p" size="200" variant="muted">
            Promote a candidate before evaluating a Build.
          </Text>
        ) : data.evaluationBuilds.length ? (
          <ul className="decision-model-panel__findings">
            {data.evaluationBuilds.map((build) => (
              <li key={build.id}>
                <form action={build.evaluationPath} method="post">
                  <input type="hidden" name="authenticity_token" value={authenticityToken} />
                  <Button type="submit" variant="secondary">
                    Evaluate {build.label}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <Text as="p" size="200" variant="muted">
            No successful Builds with captured screenshots are available.
          </Text>
        )}
      </article>

      <article className="decision-model-panel__card" aria-labelledby="decision-model-findings">
        <Heading as="h3" size="4" id="decision-model-findings">
          Latest Build evaluation
        </Heading>
        {data.evaluations.length ? (
          data.evaluations.map((evaluation) => (
            <article key={evaluation.id} className="decision-model-panel__candidate">
              <div className="decision-model-panel__heading">
                <div>
                  <Heading as="h4" size="3">
                    Build {evaluation.buildNumber}
                  </Heading>
                  <Text as="p" size="200" variant="muted">
                    Evaluated {formatDate(evaluation.createdAt)} with{" "}
                    {evaluation.runtimeCandidateId}, generation {evaluation.generation}
                  </Text>
                </div>
                <a href={evaluation.prototypePath}>Open accepted Build</a>
              </div>
              {evaluation.findingsAvailable ? (
                evaluation.findings.length ? (
                  <ul className="decision-model-panel__findings">
                    {evaluation.findings.map((finding) => (
                      <li key={`${finding.learningId}:${finding.route}`}>
                        <Text as="p">
                          <strong>{finding.learningText ?? finding.learningId}</strong> on{" "}
                          <code>{finding.route}</code>
                        </Text>
                        {finding.learningText === null ? (
                          <Text as="p" size="200" variant="muted">
                            The accepted learning text was removed after this evaluation.
                          </Text>
                        ) : null}
                        <Text as="p" size="200">
                          {finding.views}
                        </Text>
                        <Text as="p">
                          Follows {finding.followsProbability}; breaks {finding.breaksProbability}.{" "}
                          {finding.explanation}
                        </Text>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Text as="p">The latest evaluation reported no learning findings.</Text>
                )
              ) : (
                <HubAlert
                  title="This legacy evaluation does not contain reviewable learning findings."
                  variant="warning"
                />
              )}
            </article>
          ))
        ) : (
          <Text as="p">No Build has been evaluated with the promoted model yet.</Text>
        )}
      </article>
    </section>
  )
}

function SettingsForm({
  data,
  authenticityToken,
}: {
  data: Extract<DecisionModelPanelData, { state: "available" }>
  authenticityToken: string
}) {
  const configuration = data.configuration
  return (
    <form action={data.settingsPath} method="post" className="decision-model-panel__form">
      <input type="hidden" name="authenticity_token" value={authenticityToken} />
      <FormControl id="decision-model-enabled">
        <FormControl.Label>Repository training</FormControl.Label>
        <Checkbox name="enabled" defaultChecked={configuration?.enabled ?? false} value="on" />
        <Text as="p" size="200" variant="muted">
          Opt this repository in. Disabling it pauses new jobs without changing the promoted model.
        </Text>
      </FormControl>
      <FormControl id="decision-model-backend" required>
        <FormControl.Label>Runtime backend</FormControl.Label>
        <TextInput name="backend" defaultValue={configuration?.backend ?? ""} required />
        <Text as="p" size="200" variant="muted">
          The backend key configured by the customer-run decision runtime.
        </Text>
      </FormControl>
      <div className="decision-model-panel__fields">
        <FormControl id="decision-model-updates" required>
          <FormControl.Label>Maximum updates per job</FormControl.Label>
          <TextInput
            name="maxUpdates"
            type="number"
            min={1}
            max={100000}
            defaultValue={configuration?.maxUpdates}
            required
          />
        </FormControl>
        <FormControl id="decision-model-seconds" required>
          <FormControl.Label>Maximum seconds per job</FormControl.Label>
          <TextInput
            name="maxSeconds"
            type="number"
            min={1}
            max={86400}
            defaultValue={configuration?.maxSeconds}
            required
          />
        </FormControl>
        <FormControl id="decision-model-budget" required>
          <FormControl.Label>Monthly training budget (credits)</FormControl.Label>
          <TextInput
            name="monthlyBudgetCredits"
            inputMode="decimal"
            pattern="(?:0|[1-9]\d*)(?:\.\d{1,9})?"
            defaultValue={configuration?.monthlyBudgetCredits ?? ""}
            required
          />
        </FormControl>
      </div>
      <div className="decision-model-panel__actions">
        <Button type="submit" variant="secondary">
          Save training settings
        </Button>
        {configuration ? (
          <Text as="span" size="200" variant="muted">
            Settings generation {configuration.generation}
          </Text>
        ) : null}
      </div>
    </form>
  )
}

function TrainingJobs({
  jobs,
  authenticityToken,
}: {
  jobs: DecisionTrainingJob[]
  authenticityToken: string
}) {
  if (!jobs.length) return <Text as="p">No decision-model training jobs yet.</Text>
  return (
    <div
      className="decision-model-panel__table"
      role="region"
      aria-label="Decision-model training history"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Requested</th>
            <th scope="col">State</th>
            <th scope="col">Pinned evidence</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>
                <time dateTime={job.createdAt}>{formatDate(job.createdAt)}</time>
              </td>
              <td>
                <strong>{job.stateLabel}</strong>
                {job.failure ? (
                  <span>
                    {" "}
                    — {job.failure} {job.failureKind === "retryable" ? "Retryable." : "Terminal."}
                  </span>
                ) : null}
              </td>
              <td>
                <code>{job.tasksetDigest.slice(0, 18)}…</code>
              </td>
              <td>
                {job.cancellable ? (
                  <form action={job.cancelPath} method="post">
                    <input type="hidden" name="authenticity_token" value={authenticityToken} />
                    <Button type="submit" variant="secondary">
                      Cancel training
                    </Button>
                  </form>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CandidateCard({
  candidate,
  allowPromotion,
  expectedGeneration,
  authenticityToken,
  confirming,
  rejecting,
  onConfirm,
  onCancel,
  onReject,
  onCancelReject,
}: {
  candidate: DecisionCandidate
  allowPromotion: boolean
  expectedGeneration: number
  authenticityToken: string
  confirming: boolean
  rejecting: boolean
  onConfirm: () => void
  onCancel: () => void
  onReject: () => void
  onCancelReject: () => void
}) {
  const promoteButton = useRef<HTMLButtonElement>(null)
  const rejectButton = useRef<HTMLButtonElement>(null)

  return (
    <article
      className="decision-model-panel__candidate"
      aria-labelledby={`candidate-${candidate.id}`}
    >
      <div className="decision-model-panel__heading">
        <div>
          <Heading as="h4" size="3" id={`candidate-${candidate.id}`}>
            Candidate {candidate.runtimeCandidateId}
          </Heading>
          <Text as="p" size="200" variant="muted">
            Finished {formatDate(candidate.createdAt)}
          </Text>
        </div>
        <span className="decision-model-panel__badge">
          {candidate.promoted
            ? "Promoted"
            : candidate.productionEligible
              ? "Runtime eligible"
              : allowPromotion
                ? "Development only"
                : "Not eligible"}
        </span>
      </div>
      <div
        className="decision-model-panel__comparison"
        role="region"
        aria-label={`Held-out comparison for ${candidate.runtimeCandidateId}`}
      >
        <dl className="decision-model-panel__facts">
          <div>
            <dt>Baseline held-out reward</dt>
            <dd>{candidate.baselineMeanReward}</dd>
          </div>
          <div>
            <dt>Candidate held-out reward</dt>
            <dd>{candidate.candidateMeanReward}</dd>
          </div>
          <div>
            <dt>Held-out reward change</dt>
            <dd>{candidate.meanRewardChange}</dd>
          </div>
          <div>
            <dt>Baseline calibration error</dt>
            <dd>{candidate.baselineCalibrationError}</dd>
          </div>
          <div>
            <dt>Candidate calibration error</dt>
            <dd>{candidate.candidateCalibrationError}</dd>
          </div>
          <div>
            <dt>Calibration error change</dt>
            <dd>{candidate.calibrationErrorChange}</dd>
          </div>
          <div>
            <dt>Elapsed time</dt>
            <dd>{candidate.duration}</dd>
          </div>
        </dl>
        {candidate.learningMetrics.length ? (
          <div
            className="decision-model-panel__table"
            role="region"
            aria-label="Per-learning gains"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Learning</th>
                  <th scope="col">Baseline</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {candidate.learningMetrics.map((metric) => (
                  <tr key={metric.learningId}>
                    <td>{metric.learningId}</td>
                    <td>{metric.baseline}</td>
                    <td>{metric.candidate}</td>
                    <td>
                      {metric.change} ({metric.direction})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Text as="p" size="200">
            Per-learning comparison was not reported.
          </Text>
        )}
        {candidate.usage.length ? (
          <ul>
            {candidate.usage.map((usage) => (
              <li key={usage}>{usage}</li>
            ))}
          </ul>
        ) : (
          <Text as="p" size="200">
            Training usage and cost were not reported.
          </Text>
        )}
      </div>
      <p className="decision-model-panel__digest">
        Pinned taskset <code>{candidate.tasksetDigest}</code>
      </p>
      {candidate.rejection ? (
        <HubAlert
          title={`Rejected ${formatDate(candidate.rejection.rejectedAt)}${
            candidate.rejection.reason ? `: ${candidate.rejection.reason}` : "."
          }`}
          variant="warning"
        />
      ) : confirming ? (
        <form
          action={candidate.promotePath}
          method="post"
          className="decision-model-panel__confirm"
        >
          <input type="hidden" name="authenticity_token" value={authenticityToken} />
          <input type="hidden" name="expectedGeneration" value={expectedGeneration} />
          <HubAlert
            title="Promote this reviewed candidate for future Build evaluations?"
            variant="warning"
          />
          <Text as="p" size="200">
            Hub will reject this decision if the promotion generation changed since this page
            loaded.
          </Text>
          <div className="decision-model-panel__actions">
            <Button type="submit" variant="primary" autoFocus>
              Confirm promotion
            </Button>
            <Button
              type="button"
              variant="subtle"
              onClick={() => {
                onCancel()
                window.requestAnimationFrame(() => promoteButton.current?.focus())
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : rejecting ? (
        <form action={candidate.rejectPath} method="post" className="decision-model-panel__confirm">
          <input type="hidden" name="authenticity_token" value={authenticityToken} />
          <FormControl id={`candidate-${candidate.id}-rejection`} required fullWidth>
            <FormControl.Label>Why reject this candidate?</FormControl.Label>
            <TextInput name="reason" maxLength={500} required autoFocus />
          </FormControl>
          <div className="decision-model-panel__actions">
            <Button type="submit" variant="danger">
              Confirm rejection
            </Button>
            <Button
              type="button"
              variant="subtle"
              onClick={() => {
                onCancelReject()
                window.requestAnimationFrame(() => rejectButton.current?.focus())
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="decision-model-panel__actions">
          {!candidate.promoted && allowPromotion ? (
            <Button ref={promoteButton} type="button" variant="primary" onClick={onConfirm}>
              Promote candidate
            </Button>
          ) : null}
          {!candidate.promoted ? (
            <Button ref={rejectButton} type="button" variant="secondary" onClick={onReject}>
              Reject candidate
            </Button>
          ) : null}
        </div>
      )}
    </article>
  )
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} seconds`
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`
  if (seconds % 60 === 0) return `${seconds / 60} minutes`
  return `${seconds} seconds`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
