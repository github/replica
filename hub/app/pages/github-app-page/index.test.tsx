import { ThemeProvider } from "@primer/react-brand"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { hubAdministrationData } from "@/storybook/fixtures/hub-administration"

import { GithubAppPage } from "."
import { ResetWithoutBootstrap, WebhookStart } from "./stories"
import type { GithubAppPageData } from "./types"

const data = {
  ...hubAdministrationData,
  pageTitle: "GitHub App",
  configurationId: 123,
  version: 4,
  identity: "App 123",
  installation: "active",
  verification: "Verify with GitHub, then confirm again.",
  paragraphs: [],
  links: [],
  busyLabel: null,
  form: {
    action: "/github_app/credentials",
    method: "patch",
    submitLabel: "Save",
    confirmLabel: "Confirm replacement",
    disabled: false,
    credentials: {
      secretLabel: "New client secret",
      keyLabel: "New private key",
      limits: "4 KiB secret; 16 KiB key",
    },
  },
} satisfies GithubAppPageData

describe("GithubAppPage()", () => {
  it("shows the idle webhook confirmation without starting a rotation", () => {
    render(
      <ThemeProvider>
        <GithubAppPage data={WebhookStart.args!.data!} />
      </ThemeProvider>,
    )
    const button = screen.getByRole("button", { name: "Start webhook rotation" })
    expect(button).not.toBeDisabled()
    expect(button.closest("form")?.querySelector('[name="operation"]')).toHaveValue("start")
    expect(screen.getByRole("checkbox")).not.toBeChecked()
    expect(screen.queryByLabelText(/New client secret/)).not.toBeInTheDocument()
  })

  it("shows why resetting is blocked without a deployment bootstrap secret", () => {
    render(
      <ThemeProvider>
        <GithubAppPage data={ResetWithoutBootstrap.args!.data!} />
      </ThemeProvider>,
    )
    expect(screen.getByText(/bootstrap secret is not configured/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Delete local App configuration" })).toBeDisabled()
    expect(screen.getByRole("checkbox")).toBeDisabled()
  })

  it("submits empty write-only credentials with deliberate confirmation and a version", () => {
    render(
      <ThemeProvider>
        <GithubAppPage data={data} />
      </ThemeProvider>,
    )
    const secret = screen.getByLabelText(/New client secret/)
    expect(secret).toHaveAttribute("type", "password")
    expect(secret).toHaveValue("")
    expect(screen.getByLabelText("New private key")).toHaveAttribute("type", "file")
    expect(screen.getByRole("checkbox")).toBeRequired()
    expect(screen.getByRole("checkbox")).not.toBeChecked()
    const form = screen.getByRole("button", { name: "Save" }).closest("form")
    expect(form).toHaveAttribute("enctype", "multipart/form-data")
    expect(form?.querySelector('[name="configuration_id"]')).toHaveValue("123")
    expect(form?.querySelector('[name="expected_version"]')).toHaveValue("4")
    expect(form?.querySelector('[name="authenticity_token"]')).toHaveValue("storybook-token")
    expect(form?.querySelector('[name="_method"]')).toHaveValue("patch")
  })

  it("requires the exact reset phrase without suggesting saved secret values", () => {
    render(
      <ThemeProvider>
        <GithubAppPage
          data={{
            ...data,
            form: {
              action: "/github_app",
              method: "delete",
              submitLabel: "Reset",
              confirmLabel: "Confirm sign-out",
              confirmationPhraseLabel: "Type the reset phrase",
              disabled: false,
            },
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByLabelText(/Type the reset phrase/)).toHaveAttribute(
      "pattern",
      "delete local GitHub App configuration",
    )
    expect(screen.getByLabelText(/Type the reset phrase/)).toBeRequired()
    expect(screen.queryByLabelText(/New client secret/)).not.toBeInTheDocument()
  })

  it("blocks credential inputs and submission while a webhook update is active", () => {
    render(
      <ThemeProvider>
        <GithubAppPage data={{ ...data, form: { ...data.form, disabled: true } }} />
      </ThemeProvider>,
    )
    expect(screen.getByLabelText(/New client secret/)).toBeDisabled()
    expect(screen.getByLabelText("New private key")).toBeDisabled()
    expect(screen.getByRole("checkbox")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })
})
