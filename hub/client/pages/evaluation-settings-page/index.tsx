import { ArrowLeftIcon } from "@primer/octicons-react"
import { Button, Heading, Text, TextInput } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubIconButton } from "@components/hub-icon-button"
import { HubSwitch } from "@components/hub-switch"

import type { EvaluationSettingsChange, EvaluationSettingsPageData } from "./types"
import "./styles.css"

// Budgets keep up to nine decimal places, so small limits must not round to zero.
function amount(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 9 })
}

function credits(value: string) {
  const number = Number(value)
  return `${amount(number)} ${number === 1 ? "credit" : "credits"}`
}

/**
 * Lets Hub administrators set the shared evaluation budget and repository administrators
 * choose whether Hub evaluates this repository and may analyze agent screenshots.
 */
export function EvaluationSettingsPage({
  busy,
  data,
  onChange,
}: {
  busy: boolean
  data: EvaluationSettingsPageData
  onChange: (change: EvaluationSettingsChange) => void
}) {
  const { budget, evaluations } = data
  const limit = Number(budget.limitCredits)
  const used = Number(budget.usedCredits)
  const budgetNotSet = limit === 0
  const budgetReached = !budgetNotSet && used >= limit

  // A bar shows how much of the shared budget is gone at a glance; the label keeps
  // the exact numbers for anyone who needs them.
  const usage = budgetNotSet ? (
    <Text
      as="p"
      className="evaluation-settings__usage"
      id="evaluation-budget-usage"
      variant="muted"
    >
      Not set
    </Text>
  ) : (
    <div className="evaluation-settings__usage">
      <Text as="span" id="evaluation-budget-usage" size="200" variant="muted">
        {amount(used)} of {credits(budget.limitCredits)} used
      </Text>
      <meter
        aria-labelledby="evaluation-budget-usage"
        className={`evaluation-settings__meter${budgetReached ? " evaluation-settings__meter--full" : ""}`}
        max={limit}
        min={0}
        value={used}
      />
    </div>
  )

  return (
    <div className="evaluation-settings-page">
      <header className="repository-page-header evaluation-settings__page-header">
        <HubIconButton
          as="a"
          aria-label="Back to learnings"
          href={data.learningsPath}
          icon={ArrowLeftIcon}
          variant="invisible"
        />
        <Heading as="h1" size="6">
          Automated evaluations
        </Heading>
      </header>
      <div className="evaluation-settings">
        <Text as="p" className="evaluation-settings__intro">
          When enabled, Hub checks whether your learnings are helping and suggests updates when
          needed.
        </Text>

        <section aria-label="Shared Hub budget" className="evaluation-settings__section">
          {budget.editable ? (
            <form className="evaluation-settings__row" method="post">
              <label className="evaluation-settings__label" htmlFor="evaluation-budget">
                Shared Hub budget
              </label>
              <TextInput
                aria-describedby="evaluation-budget-usage"
                className="evaluation-settings__budget-input"
                defaultValue={budget.limitCredits}
                id="evaluation-budget"
                inputMode="decimal"
                name="monthlyBudgetCredits"
                required
                size="small"
              />
              <Text as="span" size="200" variant="muted">
                credits per month
              </Text>
              <Button disabled={busy} size="small" type="submit">
                Save
              </Button>
              {usage}
            </form>
          ) : (
            <div className="evaluation-settings__row">
              <Text as="p" className="evaluation-settings__label">
                Shared Hub budget
              </Text>
              {usage}
            </div>
          )}
        </section>

        <section
          aria-label={`Evaluations for ${data.repositoryName}`}
          className="evaluation-settings__section"
        >
          {budgetReached ? (
            <HubAlert
              title="Budget reached. Evaluations pause until a Hub admin raises the limit."
              variant="warning"
            />
          ) : budgetNotSet ? (
            <HubAlert title="Evaluations start once a Hub admin sets a budget." variant="info" />
          ) : null}
          <div className="evaluation-settings__row">
            <Text as="p" className="evaluation-settings__label" id="evaluation-repository">
              Evaluate {data.repositoryName}
            </Text>
            <HubSwitch
              aria-labelledby="evaluation-repository"
              checked={evaluations.enabled}
              disabled={busy || !evaluations.editable}
              onChange={(enabled) => onChange({ enabled })}
              size="small"
            />
          </div>
          <div className="evaluation-settings__row">
            <Text as="p" className="evaluation-settings__label" id="evaluation-screenshots">
              Allow screenshots
            </Text>
            <HubSwitch
              aria-describedby="evaluation-screenshots-hint"
              aria-labelledby="evaluation-screenshots"
              checked={evaluations.screenshotsAllowed}
              disabled={busy || !evaluations.editable || !evaluations.enabled}
              onChange={(screenshots) => onChange({ screenshots })}
              size="small"
            />
            <Text as="p" id="evaluation-screenshots-hint" size="200" variant="muted">
              Agents may capture screenshots for Hub to analyze. Turning this off deletes the ones
              Hub keeps.
            </Text>
          </div>
          {evaluations.screenshotsRecord ? (
            <Text as="p" size="200" variant="muted">
              {evaluations.screenshotsRecord}
            </Text>
          ) : null}
          {evaluations.editable ? null : (
            <Text as="p" size="200" variant="muted">
              Only a repository administrator can change these settings.
            </Text>
          )}
        </section>
      </div>
    </div>
  )
}
