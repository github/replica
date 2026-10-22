import { configureStore } from "@reduxjs/toolkit"
import { act, render, screen } from "@testing-library/react"
import { Provider } from "react-redux"
import { describe, expect, it, vi } from "vitest"

import { navigationRequest } from "@application/navigation-request"

import RepositoriesShowView from "../../../views/repositories/show"

const state = vi.hoisted(() => ({
  data: {
    managePrototypesPath: "/repositories/1/prototypes/manage",
  },
}))

vi.mock("@hooks/use-page-data", () => ({
  usePageData: () => state.data,
}))
vi.mock("@hooks/use-prototype-listing", () => ({
  usePrototypeListing: () => ({}),
}))
vi.mock("@pages/repositories-show-page", () => ({
  RepositoriesShowPage: ({ managingPrototypes }: { managingPrototypes: boolean }) => (
    <output>{managingPrototypes ? "Managing prototypes" : "Idle"}</output>
  ),
}))

describe("RepositoriesShowView()", () => {
  it("clears the loading state when its navigation request finishes", () => {
    const store = configureStore({
      reducer: { navigationRequest: navigationRequest.reducer },
    })
    render(
      <Provider store={store}>
        <RepositoriesShowView />
      </Provider>,
    )
    expect(screen.getByText("Idle")).toBeInTheDocument()

    act(() => {
      store.dispatch(
        navigationRequest.actions.started({
          id: 1,
          path: state.data.managePrototypesPath,
        }),
      )
    })
    expect(screen.getByText("Managing prototypes")).toBeInTheDocument()

    act(() => {
      store.dispatch(navigationRequest.actions.finished({ id: 1 }))
    })
    expect(screen.getByText("Idle")).toBeInTheDocument()
  })
})
