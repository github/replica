import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { DecisionModelPanel } from "."
import type { DecisionModelPanelData } from "./types"

const tasksetDigest = `sha256:${"b".repeat(64)}`

function available(): Extract<DecisionModelPanelData, { state: "available" }> {
  return {
    state: "available",
    settingsPath: "/repositories/2001/learnings/decision-model/settings",
    trainingPath: "/repositories/2001/learnings/decision-model/training",
    rollbackPath: "/repositories/2001/learnings/decision-model/rollback",
    configuration: {
      enabled: true,
      generation: 3,
      backend: "fixture",
      maxUpdates: 8,
      maxSeconds: 300,
      monthlyBudgetCredits: "10",
    },
    readiness: {
      runtime: "Hub can prepare and submit a bounded training job.",
      evidence:
        "3 prototypes, 8 Builds, 12 pages, 48 screenshots, 6 questions, and 96 samples are covered.",
      latestTasksetDigest: tasksetDigest,
      warnings: [],
      blockedReasons: [],
    },
    trainingAvailable: true,
    activeJob: null,
    jobs: [],
    candidates: [
      {
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        runtimeCandidateId: "fixture-candidate-2",
        createdAt: "2026-11-11T18:04:30Z",
        productionEligible: true,
        tasksetDigest,
        baselineMeanReward: "0.55",
        candidateMeanReward: "0.73",
        meanRewardChange: "+0.18 (improved)",
        baselineCalibrationError: "0.2",
        candidateCalibrationError: "0.17",
        calibrationErrorChange: "-0.03 (improved)",
        learningMetrics: [
          {
            learningId: "learning-1",
            baseline: "50%",
            candidate: "75%",
            change: "+25%",
            direction: "gain",
          },
        ],
        duration: "4 minutes 30 seconds",
        usage: ["fixture-runtime: 3.5 credits, $1.25"],
        rejection: null,
        promoted: false,
        promotePath:
          "/repositories/2001/learnings/decision-model/candidates/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/promote",
        rejectPath:
          "/repositories/2001/learnings/decision-model/candidates/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/reject",
      },
    ],
    promotion: {
      candidateId: "ffffffff-1111-4222-8333-444444444444",
      runtimeCandidateId: "fixture-candidate-1",
      generation: 2,
      operation: "promote",
      rollbackAvailable: true,
    },
    evaluationBuilds: [
      {
        id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
        number: 42,
        label: "Settings — Build 42",
        evaluationPath:
          "/repositories/2001/learnings/decision-model/builds/bbbbbbbb-cccc-4ddd-8eee-ffffffffffff/evaluate",
      },
    ],
    evaluations: [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        buildNumber: 42,
        prototypePath: "/repositories/2001/prototypes/1?build=3",
        runtimeCandidateId: "fixture-candidate-1",
        generation: 2,
        createdAt: "2026-11-12T20:00:00Z",
        findingsAvailable: true,
        findings: [
          {
            learningId: "learning-1",
            learningText: null,
            route: "/settings/profile",
            views: "desktop viewport, dark theme",
            followsProbability: "82%",
            breaksProbability: "18%",
            explanation: "The accepted learning text was removed.",
          },
        ],
      },
    ],
    deletions: [
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        state: "pending",
        summary: "2 pending runtime deletion items; 0 failures.",
        failure: null,
      },
    ],
  }
}

function renderPanel(data: DecisionModelPanelData) {
  return render(
    <ThemeProvider>
      <DecisionModelPanel data={data} authenticityToken="csrf-token" />
    </ThemeProvider>,
  )
}

describe("DecisionModelPanel()", () => {
  it("explains runtime setup and separate administrator authority without exposing controls", () => {
    renderPanel({
      state: "not-configured",
      message: "Decision-model training is not configured for this Hub.",
      setupGuidance: "Configure the customer-run decision runtime.",
    })
    expect(screen.getByText(/not configured for this Hub/)).toBeVisible()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()

    renderPanel({
      state: "repository-learning-only",
      message: "Decision-model training requires separate Hub administrator authority.",
    })
    expect(screen.getByText(/separate Hub administrator authority/)).toBeVisible()

    renderPanel({
      state: "unavailable",
      message: "Decision-model training is temporarily unavailable.",
      setupGuidance: "Existing accepted learnings remain available to agents.",
    })
    expect(screen.getByText(/temporarily unavailable/)).toBeVisible()
  })

  it("exposes bounded settings and confirms the exact observed generation before training", () => {
    renderPanel(available())
    expect(screen.getByRole("checkbox", { name: "Repository training" })).toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "Start training" }))
    const confirm = screen.getByRole("button", { name: "Queue this training job" })
    const form = confirm.closest("form")
    expect(
      (form?.querySelector('[name="idempotencyKey"]') as HTMLInputElement | null)?.value,
    ).toMatch(/^hub-ui-/)
    expect(form?.querySelector('[name="expectedConfigurationGeneration"]')).toHaveValue("3")
    expect(confirm).toHaveFocus()
    expect(screen.getByText(/capped at 8 updates, 5 minutes, and 10 credits/)).toBeVisible()
    expect(
      screen.getByText(
        "The next click queues this job. It does not promote the resulting candidate.",
      ),
    ).toBeVisible()
  })

  it.each(["queued", "submitting", "submitted", "running"] as const)(
    "allows %s training to be cancelled",
    (state) => {
      const data = available()
      const job = {
        id: "11111111-2222-4333-8444-555555555555",
        state,
        stateLabel: state,
        createdAt: "2026-11-12T16:00:00Z",
        finishedAt: null,
        tasksetDigest,
        failure: null,
        failureKind: null,
        cancelPath:
          "/repositories/2001/learnings/decision-model/training/11111111-2222-4333-8444-555555555555/cancel",
        cancellable: true,
      }
      renderPanel({ ...data, trainingAvailable: false, activeJob: job, jobs: [job] })
      expect(screen.getByRole("button", { name: "Cancel training" })).toBeVisible()
    },
  )

  it("labels retryable and terminal failures separately", () => {
    const data = available()
    renderPanel({
      ...data,
      jobs: [
        {
          id: "11111111-2222-4333-8444-555555555555",
          state: "failed",
          stateLabel: "Failed",
          createdAt: "2026-11-13T16:00:00Z",
          finishedAt: "2026-11-13T16:05:00Z",
          tasksetDigest,
          failure: "Training stopped with runtime unavailable.",
          failureKind: "retryable",
          cancelPath: "",
          cancellable: false,
        },
        {
          id: "22222222-3333-4444-8555-666666666666",
          state: "failed",
          stateLabel: "Failed",
          createdAt: "2026-11-12T16:00:00Z",
          finishedAt: "2026-11-12T16:01:00Z",
          tasksetDigest,
          failure: "Training stopped with taskset drift.",
          failureKind: "terminal",
          cancelPath: "",
          cancellable: false,
        },
      ],
    })
    const history = screen.getByRole("region", { name: "Decision-model training history" })
    expect(within(history).getByText(/runtime unavailable.*Retryable/)).toBeVisible()
    expect(within(history).getByText(/taskset drift.*Terminal/)).toBeVisible()
  })

  it("shows blockers only for a blocked preflight", () => {
    const data = available()
    renderPanel({
      ...data,
      trainingAvailable: false,
      readiness: {
        ...data.readiness,
        runtime: "Training is blocked until evidence requirements are resolved.",
        blockedReasons: ["insufficient test tasks (4)"],
        warnings: ["Three screenshots lack repeatable review outcomes. (3)"],
      },
    })
    expect(screen.getByText(/insufficient test tasks/)).toBeVisible()
    expect(screen.queryByRole("button", { name: "Start training" })).not.toBeInTheDocument()
  })

  it("shows privacy-safe findings and runtime deletion status", () => {
    renderPanel(available())
    const comparison = screen.getByRole("region", {
      name: "Held-out comparison for fixture-candidate-2",
    })
    expect(within(comparison).getByText("+0.18 (improved)")).toBeVisible()
    expect(within(comparison).getByRole("region", { name: "Per-learning gains" })).toHaveAttribute(
      "tabindex",
      "0",
    )
    expect(
      screen.getByText("The accepted learning text was removed after this evaluation."),
    ).toBeVisible()
    expect(screen.getByText("Deletion pending")).toBeVisible()
    expect(screen.getByText("2 pending runtime deletion items; 0 failures.")).toBeVisible()
  })

  it("allows explicit fixture promotion without relaxing non-fixture eligibility", () => {
    const fixture = available()
    const ineligibleCandidate = { ...fixture.candidates[0]!, productionEligible: false }
    const { rerender } = renderPanel({ ...fixture, candidates: [ineligibleCandidate] })
    const fixtureCandidate = screen.getByRole("article", {
      name: "Candidate fixture-candidate-2",
    })

    expect(within(fixtureCandidate).getByText("Development only")).toBeVisible()
    expect(
      within(fixtureCandidate).getByRole("button", { name: "Promote candidate" }),
    ).toBeVisible()

    rerender(
      <ThemeProvider>
        <DecisionModelPanel
          data={{
            ...fixture,
            configuration: { ...fixture.configuration!, backend: "customer-runtime" },
            candidates: [ineligibleCandidate],
          }}
          authenticityToken="csrf-token"
        />
      </ThemeProvider>,
    )
    const customerRuntimeCandidate = screen.getByRole("article", {
      name: "Candidate fixture-candidate-2",
    })
    expect(within(customerRuntimeCandidate).getByText("Not eligible")).toBeVisible()
    expect(
      within(customerRuntimeCandidate).queryByRole("button", { name: "Promote candidate" }),
    ).not.toBeInTheDocument()
  })

  it("offers an eligible successful Build for evaluation through a form action", () => {
    renderPanel(available())

    const evaluate = screen.getByRole("button", { name: "Evaluate Settings — Build 42" })
    const form = evaluate.closest("form")
    expect(form).toHaveAttribute(
      "action",
      "/repositories/2001/learnings/decision-model/builds/bbbbbbbb-cccc-4ddd-8eee-ffffffffffff/evaluate",
    )
    expect(form).toHaveAttribute("method", "post")
    expect(form?.querySelector('[name="authenticity_token"]')).toHaveValue("csrf-token")
  })

  it.each([
    {
      label: "no promoted model",
      change: (data: ReturnType<typeof available>) => ({ ...data, promotion: null }),
    },
    {
      label: "no eligible successful Builds",
      change: (data: ReturnType<typeof available>) => ({ ...data, evaluationBuilds: [] }),
    },
  ])("does not offer Build evaluation with $label", ({ change }) => {
    renderPanel(change(available()))

    expect(
      screen.queryByRole("button", { name: /^Evaluate .+ — Build \d+$/ }),
    ).not.toBeInTheDocument()
  })

  it("restores focus when promotion and rejection confirmations are cancelled", async () => {
    renderPanel(available())
    const promote = screen.getByRole("button", { name: "Promote candidate" })
    fireEvent.click(promote)
    expect(screen.getByRole("button", { name: "Confirm promotion" })).toHaveFocus()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Promote candidate" })).toHaveFocus(),
    )

    const reject = screen.getByRole("button", { name: "Reject candidate" })
    fireEvent.click(reject)
    expect(screen.getByRole("textbox", { name: "Why reject this candidate?" })).toHaveFocus()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reject candidate" })).toHaveFocus(),
    )
  })

  it("resets confirmations and idempotency after successful action revalidation", () => {
    const data = available()
    const { rerender } = render(
      <ThemeProvider>
        <DecisionModelPanel key="repository-2001:0" data={data} authenticityToken="csrf-token" />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Start training" }))
    const firstKey = (
      screen
        .getByRole("button", { name: "Queue this training job" })
        .closest("form")
        ?.querySelector('[name="idempotencyKey"]') as HTMLInputElement
    ).value

    rerender(
      <ThemeProvider>
        <DecisionModelPanel key="repository-2001:1" data={data} authenticityToken="csrf-token" />
      </ThemeProvider>,
    )

    expect(screen.queryByRole("button", { name: "Queue this training job" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Start training" }))
    const secondKey = (
      screen
        .getByRole("button", { name: "Queue this training job" })
        .closest("form")
        ?.querySelector('[name="idempotencyKey"]') as HTMLInputElement
    ).value
    expect(secondKey).not.toBe(firstKey)
  })

  it("shows a persisted rejection without fixing the localized date", () => {
    const data = available()
    renderPanel({
      ...data,
      candidates: data.candidates.map((candidate) => ({
        ...candidate,
        rejection: {
          rejectedAt: "2026-11-12T20:30:00Z",
          reason: "The held-out regression is not acceptable.",
        },
      })),
    })
    expect(screen.getByText(/Rejected .*held-out regression is not acceptable/)).toBeVisible()
    expect(screen.queryByRole("button", { name: "Promote candidate" })).not.toBeInTheDocument()
  })

  it("does not offer rejection or promotion for the current promoted candidate", () => {
    const data = available()
    const candidate = { ...data.candidates[0]!, promoted: true }
    renderPanel({
      ...data,
      candidates: [candidate],
      promotion: {
        ...data.promotion!,
        candidateId: candidate.id,
        runtimeCandidateId: candidate.runtimeCandidateId,
      },
    })
    expect(screen.queryByRole("button", { name: "Promote candidate" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reject candidate" })).not.toBeInTheDocument()
  })
})
