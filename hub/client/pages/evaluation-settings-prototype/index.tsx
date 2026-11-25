import { useState, type SyntheticEvent } from "react"
import { ArrowLeftIcon } from "@primer/octicons-react"
import { Heading, Text, TextInput, Tooltip } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubIconButton } from "@components/hub-icon-button"
import { HubSwitch } from "@components/hub-switch"
import { HubToast } from "@components/hub-toast"
import { HubVisuallyHidden } from "@components/hub-visually-hidden"

import type { EvaluationSettingsPrototypeData } from "./types"
import "./styles.css"

const optInHint = "Turning this off stops future evaluations and keeps existing results."

function credits(value: number) {
  return `${value.toLocaleString()} ${value === 1 ? "credit" : "credits"}`
}

export function EvaluationSettingsPrototype({ data }: { data: EvaluationSettingsPrototypeData }) {
  const [budgetLimit, setBudgetLimit] = useState(data.budgetLimitCredits)
  const [budgetDraft, setBudgetDraft] = useState(String(data.budgetLimitCredits))
  const [budgetError, setBudgetError] = useState("")
  const [repositoryEnabled, setRepositoryEnabled] = useState(data.repositoryEnabled)
  const [notice, setNotice] = useState("")
  const remaining = Math.max(0, budgetLimit - data.usedCredits)
  const budgetReached = budgetLimit > 0 && remaining === 0
  const budgetNotSet = budgetLimit === 0
  const canEnableRepository = !budgetReached && !budgetNotSet

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
        {data.usedCredits.toLocaleString()} of {credits(budgetLimit)} used
      </Text>
      <meter
        aria-labelledby="evaluation-budget-usage"
        className={`evaluation-settings__meter${budgetReached ? " evaluation-settings__meter--full" : ""}`}
        max={budgetLimit}
        min={0}
        value={data.usedCredits}
      />
    </div>
  )

  // Saving on blur or Enter keeps the row free of a Save button. Unchanged values are
  // skipped so tabbing through the page does not show a confirmation.
  function saveBudget() {
    const nextBudget = Number(budgetDraft)
    if (nextBudget === budgetLimit) return
    if (budgetDraft === "" || !Number.isFinite(nextBudget) || nextBudget < data.usedCredits) {
      setBudgetError(`Set a limit of at least ${credits(data.usedCredits)}, already used.`)
      return
    }

    setBudgetLimit(nextBudget)
    setBudgetError("")
    setNotice("Hub evaluation budget saved.")
  }

  function setRepositoryOptIn(enabled: boolean) {
    if (enabled && !canEnableRepository) return
    setRepositoryEnabled(enabled)
    setNotice(
      enabled
        ? `Automated evaluations enabled for ${data.repositoryName}.`
        : `Automated evaluations paused for ${data.repositoryName}.`,
    )
  }

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
          {data.canManageHubBudget ? (
            <form
              className="evaluation-settings__row"
              onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
                event.preventDefault()
                saveBudget()
              }}
            >
              <label className="evaluation-settings__label" htmlFor="evaluation-budget">
                Shared Hub budget
              </label>
              <TextInput
                aria-describedby="evaluation-budget-usage"
                className="evaluation-settings__budget-input"
                id="evaluation-budget"
                min={data.usedCredits}
                name="budgetLimitCredits"
                onBlur={saveBudget}
                onChange={(event) => {
                  setBudgetDraft(event.target.value)
                  setBudgetError("")
                }}
                required
                size="small"
                step="any"
                type="number"
                value={budgetDraft}
              />
              <Text as="span" size="200" variant="muted">
                credits
              </Text>
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
          {budgetError ? <p role="alert">{budgetError}</p> : null}
        </section>

        <section
          aria-label={`Evaluations for ${data.repositoryName}`}
          className="evaluation-settings__section"
        >
          {budgetReached ? (
            <HubAlert
              title={
                repositoryEnabled
                  ? "Budget reached. Evaluations are paused until a Hub admin raises the limit."
                  : "Budget reached. A Hub admin must raise the limit to enable evaluations."
              }
              variant="warning"
            />
          ) : budgetNotSet ? (
            <HubAlert
              title="A Hub admin must set a budget before evaluations can be enabled."
              variant="info"
            />
          ) : null}
          {data.canManageRepositorySettings ? (
            <div className="evaluation-settings__row">
              <Text as="p" className="evaluation-settings__label" id="evaluation-repository-opt-in">
                Evaluate {data.repositoryName}
              </Text>
              <Tooltip direction="e" text={optInHint} type="description">
                <span className="evaluation-settings__switch">
                  <HubSwitch
                    aria-describedby="evaluation-repository-hint"
                    aria-labelledby="evaluation-repository-opt-in"
                    checked={repositoryEnabled}
                    disabled={!repositoryEnabled && !canEnableRepository}
                    onChange={setRepositoryOptIn}
                    size="small"
                  />
                </span>
              </Tooltip>
              <HubVisuallyHidden id="evaluation-repository-hint">{optInHint}</HubVisuallyHidden>
            </div>
          ) : (
            <Text as="p" size="200" variant="muted">
              Only a repository administrator can change this setting.
            </Text>
          )}
        </section>
        {notice ? <HubToast title={notice} /> : null}
      </div>
    </div>
  )
}
