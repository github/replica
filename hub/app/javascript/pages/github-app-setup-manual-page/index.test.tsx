import { render, screen } from "@testing-library/react"
import { describe, it } from "vitest"

import { GithubAppSetupManualPage } from "./index"
import type { GithubAppSetupManualPageData } from "./types"

describe("GithubAppSetupManualPage()", () => {
  it("posts a bootstrap-protected multipart form with explicit confirmation and an uploaded private key", () => {
    const data: GithubAppSetupManualPageData = {
      authenticityToken: "csrf-token",
      confirmLabel: "Connect only this installation",
      description: "Connect an existing GitHub App.",
      fields: [
        { name: "app_id", label: "App ID", hint: "From App settings", secret: false },
        { name: "client_id", label: "Client ID", hint: "From App settings", secret: false },
        { name: "client_secret", label: "Client secret", hint: "Keep private", secret: true },
        { name: "webhook_secret", label: "Webhook secret", hint: "Keep private", secret: true },
        {
          name: "installation_id",
          label: "Installation ID",
          hint: "Selected installation",
          secret: false,
        },
      ],
      heading: "Connect an existing App",
      instructions: [{ title: "Register the App", body: "Use these settings on GitHub." }],
      keyHint: "Upload the PEM file",
      keyLabel: "Private key",
      pageTitle: "Connect App",
      permissions: [{ label: "Contents", value: "Read and write" }],
      productName: "Replica Hub",
      settings: [{ label: "Callback URL", value: "https://hub.example.com/auth/github/callback" }],
      submitLabel: "Connect App",
      submitPath: "/setup/manual",
    }
    const { container, rerender } = render(<GithubAppSetupManualPage data={data} />)
    const form = container.querySelector("form")

    expect(form).toHaveAttribute("action", "/setup/manual")
    expect(form).toHaveAttribute("method", "post")
    expect(form).toHaveAttribute("enctype", "multipart/form-data")
    expect(container.querySelector("input[name=authenticity_token]")).toHaveValue("csrf-token")
    expect(screen.getByLabelText(/Private key/)).toHaveAttribute("type", "file")
    expect(screen.getByLabelText(/Private key/)).toBeRequired()
    expect(screen.getByLabelText("Private key")).toHaveAccessibleName("Private key")
    expect(screen.getByLabelText("Private key")).toHaveAccessibleDescription("Upload the PEM file")
    expect(
      screen.getByRole("checkbox", { name: "Connect only this installation" }),
    ).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Connect only this installation" })).toBeRequired()
    expect(
      screen.getByRole("checkbox", { name: "Connect only this installation" }),
    ).toHaveAttribute("value", "1")
    for (const label of [
      "App ID",
      "Client ID",
      "Client secret",
      "Webhook secret",
      "Installation ID",
    ]) {
      expect(screen.getByLabelText(new RegExp(label))).toBeRequired()
    }

    rerender(
      <GithubAppSetupManualPage
        data={{ ...data, error: "GitHub could not verify the connection." }}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("GitHub could not verify the connection.")
    for (const label of ["Client secret", "Webhook secret"]) {
      expect(screen.getByLabelText(new RegExp(label))).toHaveAttribute("type", "password")
      expect(screen.getByLabelText(new RegExp(label))).toHaveAttribute(
        "autocomplete",
        "new-password",
      )
      expect(screen.getByLabelText(new RegExp(label))).toHaveValue("")
    }
    expect(screen.getByLabelText(/Private key/)).toHaveValue("")
  })
})
