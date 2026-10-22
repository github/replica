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
  it("submits the opaque continuation once even when React repeats effects or rerenders", () => {
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
    const view = (
      <StrictMode>
        <ThemeProvider>
          <FreshAuthorizationsShowView />
        </ThemeProvider>
      </StrictMode>
    )
    const { rerender } = render(view)
    rerender(
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

  it("waits for the person to start a verification-only challenge", () => {
    vi.mocked(usePageData).mockReturnValue({
      productName: "Replica Hub",
      pageTitle: "Fresh authorization",
      heading: "Verify your GitHub account",
      description: "Verify the same GitHub account.",
      submitLabel: "Verify with GitHub",
      submitPath: "/authorization/example",
      authenticityToken: "csrf-token",
    })
    const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {})
    render(
      <ThemeProvider>
        <FreshAuthorizationsShowView />
      </ThemeProvider>,
    )
    expect(submit).not.toHaveBeenCalled()
  })
})
