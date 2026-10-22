import { ThemeProvider } from "@primer/react-brand"
import { render } from "@testing-library/react"
import { StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"

import { usePageData } from "@hooks/use-page-data"

import FreshAuthorizationsShowView from "../../../views/fresh_authorizations/show"

vi.mock("@hooks/use-page-data", () => ({ usePageData: vi.fn() }))
vi.mock("@hooks/use-workspace-inbox", () => ({
  useWorkspaceInbox: (data: unknown) => data,
}))

describe("FreshAuthorizationsShowView()", () => {
  it("automatically submits the continuation once with its protected form fields", () => {
    vi.mocked(usePageData).mockReturnValue({
      productName: "Replica Hub",
      pageTitle: "Continue action",
      heading: "GitHub account verified",
      description: "Continuing your action.",
      submitLabel: "Continue",
      submitPath: "/github_app/credentials",
      authenticityToken: "csrf-token",
      continuation: { id: "opaque-authorization-id", method: "patch" },
    })
    const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {})
    render(
      <StrictMode>
        <ThemeProvider>
          <FreshAuthorizationsShowView />
        </ThemeProvider>
      </StrictMode>,
    )
    expect(submit).toHaveBeenCalledTimes(1)
    const form = submit.mock.instances[0] as HTMLFormElement
    expect(form).toHaveAttribute("action", "/github_app/credentials")
    expect(Object.fromEntries(new FormData(form).entries())).toEqual({
      authenticity_token: "csrf-token",
      authorization_continuation_id: "opaque-authorization-id",
      _method: "patch",
    })
  })
})
