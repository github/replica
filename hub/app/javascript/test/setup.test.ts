import { describe, expect, it } from "vitest"

const initialLocation = window.location.href
const initialHistoryState: unknown = window.history.state

describe("frontend test setup", () => {
  it.each(["first case", "second case"])(
    "gives the %s clean storage, navigation, selection and document body",
    () => {
      expect(window.localStorage.length).toBe(0)
      expect(window.sessionStorage.length).toBe(0)
      expect(window.location.href).toBe(initialLocation)
      expect(window.history.state).toEqual(initialHistoryState)
      expect(window.getSelection()?.rangeCount).toBe(0)
      expect(document.body.childNodes.length).toBe(0)
      expect(document.body.hasAttribute("style")).toBe(false)

      window.localStorage.setItem("replica-setup-test", "contaminated")
      window.sessionStorage.setItem("replica-setup-test", "contaminated")
      window.history.replaceState(
        { replicaSetupTest: "contaminated" },
        "",
        "/setup-contamination?dirty=1#selection",
      )
      const leftover = document.createElement("p")
      leftover.textContent = "Selected content from another case"
      document.body.append(leftover)
      document.body.style.overflow = "hidden"
      const range = document.createRange()
      range.selectNodeContents(leftover)
      window.getSelection()?.addRange(range)
    },
  )
})
