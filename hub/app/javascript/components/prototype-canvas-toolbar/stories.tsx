import { createRef } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { Toolbar } from "."
import type { ChecksState } from "@utils/prototype-checks/types"

const checksState: ChecksState = {
  state: "ready",
  checks: ["TypeScript", "Lint", "Unit tests", "Accessibility", "Primer usage"].map(
    (name, index) => ({
      id: `check-${index}`,
      name,
      runner: "command",
      automatic: true,
      status: index < 3 ? "completed" : "not_run",
      outcome: index < 3 ? "pass" : null,
      summary: index < 3 ? "Command passed." : null,
      error: null,
      criteria: [{ id: "result", status: "pass", evidence: "Verified" }],
      findings: [],
    }),
  ),
}

const config = {
  name: "Prototype",
  prototypeUrl: "http://localhost:3000",
  token: "local-token",
}

const meta = {
  title: "Components/Prototype canvas/Toolbar",
  component: Toolbar,
  args: {
    config,
    prototypeName: "Prototype",
    onPublish: () => undefined,
    onShare: () => undefined,
    shareButtonRef: createRef<HTMLButtonElement>(),
    onBuildDetails: () => undefined,
    onHub: () => undefined,
    onChecks: () => undefined,
    checksState,
    hubOpen: false,
    publishButtonRef: createRef<HTMLButtonElement>(),
    titleButtonRef: createRef<HTMLButtonElement>(),
    publishing: false,
    state: {
      name: "Prototype",
      stats: {
        branch: "prototype/welcome",
        repository: "github/prototype",
        commitSha: "a".repeat(40),
        workingTree: "clean",
        urlHost: "localhost:3000",
      },
      publishStatus: { state: "not_published", detail: "No Replica workflow run was found." },
    },
  },
} satisfies Meta<typeof Toolbar>

export default meta
type Story = StoryObj<typeof meta>

export const NotPublished: Story = {}

export const ChecksRunning: Story = {
  args: {
    checksState: {
      ...checksState,
      checks: checksState.checks.map((check, index) =>
        index < 3 ? check : { ...check, status: "running", outcome: null },
      ),
    },
  },
}

export const ChecksFailed: Story = {
  args: {
    checksState: {
      ...checksState,
      checks: checksState.checks.map((check, index) =>
        index < 3
          ? check
          : {
              ...check,
              status: "completed",
              outcome: "fail",
              summary: "Issues found.",
              criteria: [{ id: "result", status: "fail", evidence: "Issue found" }],
            },
      ),
    },
  },
}

export const ChecksWarning: Story = {
  args: {
    checksState: {
      ...checksState,
      checks: checksState.checks.map((check, index) =>
        index < 3 ? check : { ...check, status: "execution_error", outcome: null },
      ),
    },
  },
}

export const ChecksPassed: Story = {
  args: {
    checksState: {
      ...checksState,
      checks: checksState.checks.map((check) => ({
        ...check,
        status: "completed",
        outcome: "pass",
        summary: "Command passed.",
      })),
    },
  },
}

export const ChecksUnconfigured: Story = {
  args: { checksState: { ...checksState, state: "unconfigured", checks: [] } },
}

export const ChecksStatusCounters: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: "1rem" }}>
      {(
        [
          ["Pending", {}],
          ["Running", ChecksRunning.args],
          ["Failed", ChecksFailed.args],
          ["Needs verification", ChecksWarning.args],
          ["Passed", ChecksPassed.args],
        ] as const
      ).map(([label, overrides]) => (
        <section key={label} aria-label={label}>
          <Toolbar {...args} {...overrides} />
        </section>
      ))}
    </div>
  ),
}

export const Untitled: Story = {
  args: { prototypeName: undefined },
}

export const Requested: Story = {
  args: {
    state: {
      ...meta.args.state,
      publishStatus: {
        state: "requested",
        detail: "Copilot has the request and will continue in chat.",
      },
    },
  },
}

export const InProgress: Story = {
  args: {
    state: {
      ...meta.args.state,
      publishStatus: { state: "in_progress", detail: "Replica workflow is in progress." },
    },
  },
}

export const Published: Story = {
  args: {
    state: {
      ...meta.args.state,
      publishStatus: {
        state: "published",
        detail: "The latest Replica workflow completed successfully.",
      },
    },
  },
}

export const Failed: Story = {
  args: {
    state: {
      ...meta.args.state,
      publishStatus: {
        state: "failed",
        detail: "The latest Replica workflow finished with failure.",
      },
    },
  },
}

export const Unavailable: Story = {
  args: { state: null },
}
