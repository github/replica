import { cleanup, render } from "ink-testing-library"
import { afterEach, expect, it } from "vitest"

import { Progress } from "./index.tsx"

afterEach(cleanup)

function state(frame: string, label: string) {
  const marker = frame.match(new RegExp(`(\\S+)\\s+${label}(?:\\s|$)`, "i"))?.[1]
  expect(marker, `A non-color state indicator must accompany ${label}`).toBeDefined()
  return marker
}

it("distinguishes completed, current, upcoming, and blocked stages without relying on color", () => {
  const terminal = render(<Progress phase="configure" />)
  const current = terminal.lastFrame()!
  const completed = state(current, "Checks")
  const active = state(current, "Configure")
  const upcoming = state(current, "Review")

  expect(state(current, "Cloud")).toBe(completed)
  expect(new Set([completed, active, upcoming]).size).toBe(3)

  terminal.rerender(<Progress phase="configure" blocked />)
  const blocked = terminal.lastFrame()!
  expect(state(blocked, "Configure")).not.toBe(active)
  expect(state(blocked, "Configure")).not.toBe(completed)
  expect(state(blocked, "Checks")).toBe(completed)
  expect(state(blocked, "Review")).toBe(upcoming)
})

it("excludes unrequested deployment stages from configure-only progress and completion", () => {
  const terminal = render(<Progress phase="configure" configureOnly />)

  for (const phase of ["Provision", "Release", "Verify"]) {
    expect(terminal.lastFrame()).not.toContain(phase)
  }
  const completeState = state(terminal.lastFrame()!, "Checks")

  terminal.rerender(<Progress phase="review" configureOnly complete />)
  const completed = terminal.lastFrame()!
  for (const phase of ["Cloud", "Checks", "Configure", "Review"]) {
    expect(state(completed, phase)).toBe(completeState)
  }
  expect(completed).not.toMatch(/Provision|Release|Verify/)
})

it("keeps the active stage and actual route position available in compact mode", () => {
  const terminal = render(<Progress phase="configure" configureOnly compact />)

  expect(terminal.lastFrame()).toMatch(/configure/i)
  expect(terminal.lastFrame()).toMatch(/3\s*\/\s*4/)
  expect(terminal.lastFrame()).not.toMatch(/Provision|Release|Verify/)

  terminal.rerender(<Progress phase="configure" configureOnly compact blocked />)
  expect(terminal.lastFrame()).toMatch(/configure/i)
  expect(terminal.lastFrame()).toMatch(/blocked|waiting|paused|recovery/i)
})
