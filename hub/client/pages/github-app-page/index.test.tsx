import { ThemeProvider } from "@primer/react-brand"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { hubAdministrationData } from "@/storybook/fixtures/hub-administration"

import { GithubAppPage } from "."
import stories from "./stories"
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
  it("keeps the legacy design reference free of credential and configuration forms", () => {
    render(
      <ThemeProvider>
        <GithubAppPage data={stories.args.data} />
      </ThemeProvider>,
    )
    expect(screen.getByText(/Design reference only/)).toBeVisible()
    expect(screen.queryByRole("button", { name: "Start webhook rotation" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Delete local App configuration" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/New client secret/)).not.toBeInTheDocument()
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
