import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { GithubAppSecretGuide } from "."

describe("GithubAppSecretGuide()", () => {
  it("shows GitHub values in the deployed Terraform runtime maps", () => {
    render(<GithubAppSecretGuide target="key-vault" onTargetChange={vi.fn()} />)

    const terraform = screen.getByLabelText("Terraform variables").textContent ?? ""
    const environment =
      terraform.match(/^[ \t]*runtime_environment_variables[ \t]*=[ \t]*\{([^{}]*)\}/m)?.[1] ?? ""
    const secrets =
      terraform.match(/^[ \t]*runtime_secret_references\s*=\s*\{((?:[^{}]|\{[^{}]*\})*)\}/m)?.[1] ??
      ""
    const publicSettings = ["GITHUB_APP_ID", "GITHUB_CLIENT_ID", "GITHUB_APP_INSTALLATION_ID"]
    const secretSettings = [
      "GITHUB_CLIENT_SECRET",
      "GITHUB_APP_PRIVATE_KEY_BASE64",
      "GITHUB_WEBHOOK_SECRET",
    ]

    for (const name of publicSettings) {
      expect(environment).toMatch(
        new RegExp(`^[ \\t]*"?${name}"?[ \\t]*=[ \\t]*"[^"\\r\\n]+"`, "m"),
      )
    }
    expect(environment).toMatch(/^[ \t]*"?GITHUB_PROVIDER_REVISION"?[ \t]*=[ \t]*"1"/m)

    const secretIds = []
    for (const name of secretSettings) {
      const reference =
        secrets.match(new RegExp(`^[ \\t]*"?${name}"?[ \\t]*=[ \\t]*\\{([^{}]*)\\}`, "m"))?.[1] ??
        ""
      expect(reference).toMatch(/\bkey_vault_id"?\s*=\s*"[^"]+"/)
      const secretId = reference.match(/\bsecret_id"?\s*=\s*"([^"]+)"/)?.[1] ?? ""
      expect(secretId).toMatch(
        /^https:\/\/[a-z0-9-]{1,24}\.vault\.azure\.net\/secrets\/[a-z0-9-]{1,127}\/(?:[a-f0-9]{32}|[a-z0-9_-]*version)$/i,
      )
      secretIds.push(secretId)
      expect(environment).not.toMatch(new RegExp(`^[ \\t]*"?${name}"?[ \\t]*=`, "m"))
    }
    expect(new Set(secretIds).size).toBe(3)

    for (const name of [
      "runtime_environment_variables",
      "runtime_secret_references",
      ...publicSettings,
      "GITHUB_PROVIDER_REVISION",
      ...secretSettings,
    ]) {
      expect(terraform.match(new RegExp(`^[ \\t]*"?${name}"?[ \\t]*=`, "gm")) ?? []).toHaveLength(1)
    }
    for (const name of [
      "hub_application_origin",
      "github_app_id",
      "github_client_id",
      "github_app_installation_id",
      "github_provider_revision",
      "HUB_APPLICATION_ORIGIN",
      "HUB_AUTHENTICATION_ENCRYPTION_KEY",
      "HUB_BOOTSTRAP_SECRET",
    ]) {
      expect(terraform).not.toMatch(new RegExp(`^[ \\t]*"?${name}"?[ \\t]*=`, "m"))
    }
  })

  it("tells operators to merge the GitHub values with existing runtime settings", () => {
    const { container } = render(
      <GithubAppSecretGuide target="key-vault" onTargetChange={vi.fn()} />,
    )

    const guidance = Array.from(container.querySelectorAll("p, li, pre"), (element) =>
      element.textContent?.trim(),
    )
    for (const name of ["runtime_environment_variables", "runtime_secret_references"]) {
      const mapGuidance = guidance.filter((text) => text?.includes(name)).join(" ")
      expect(mapGuidance).toMatch(/\b(?:existing|already configured)\b/i)
      expect(mapGuidance).toMatch(/\b(?:merge|add|update|keep|preserv\w*|extend)\b/i)
    }
  })

  it("advances the current GitHub provider revision when rotating a secret", () => {
    render(<GithubAppSecretGuide target="key-vault" onTargetChange={vi.fn()} />)

    const rotation = within(screen.getByRole("list")).getByText(
      (_, element) =>
        element?.tagName === "LI" && /\bGITHUB_PROVIDER_REVISION\b/.test(element.textContent ?? ""),
    )
    expect(rotation).toHaveTextContent(/\b(?:existing|current|previous|prior|last)\b/i)
    expect(rotation).toHaveTextContent(/\b(?:increase|increment|next|plus)\b/i)
    expect(rotation).toHaveTextContent(
      /\b(?:(?:by|plus)\s+(?:one|1)|one\s+step|next|consecutive(?:ly)?|sequential(?:ly)?)\b/i,
    )
  })
})
