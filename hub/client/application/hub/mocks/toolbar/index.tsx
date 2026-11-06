import { useEffect, useState, useSyncExternalStore } from "react"
import { useLocation, useNavigate, useRevalidator } from "react-router"

import { mockProfiles, mockScenarios } from "../contracts/constants"
import type { MockProfile, MockScenario } from "../contracts/types"
import { mockDiagnostics } from "../diagnostics"

import "./styles.css"

const profiles: Record<MockProfile, string> = {
  owner: "Owner - Octocat",
  reader: "Read-only - Mona",
  admin: "Administrator - Octocat",
  "signed-out": "Signed out",
}

const scenarios: Record<MockScenario, string> = {
  normal: "Normal",
  loading: "Slow response",
  empty: "Empty",
  forbidden: "Forbidden",
  "server-error": "Server error",
  "invalid-response": "Invalid response",
  "save-error": "Save error",
}

const destinations = [
  ["Repositories", "/repositories"],
  ["Prototype and reviews", "/repositories/2001/prototypes/1?build=3"],
  ["Build history", "/repositories/2001/prototypes/1/builds"],
  ["Create a prototype", "/repositories/2001/new"],
  ["Manage prototypes", "/repositories/2001/prototypes/manage"],
  ["Share links", "/repositories/2001/prototypes/1/share-links"],
  ["Shared preview", "/shared/demo-active"],
  ["Welcome", "/welcome"],
  ["Inbox", "/notifications"],
  ["Analytics", "/repositories/2001/analytics"],
  ["Learnings", "/repositories/2001/learnings"],
  ["Canvas connections", "/settings/canvas"],
  ["Approve a canvas connection", "/settings/canvas/approve"],
  ["Copilot", "/settings/copilot"],
  ["GitHub App", "/settings/github"],
  ["GitHub App setup", "/settings/github/setup"],
  ["GitHub App registration", "/settings/github/register"],
  ["GitHub App installation", "/settings/github/installed"],
  ["Replace App credentials", "/settings/github?change=credentials"],
  ["Webhook secret rotation", "/settings/github?change=rotation"],
  ["Reset App configuration", "/settings/github?change=reset"],
  ["Hub administrators", "/settings/admins"],
  ["Administrator enrollment", "/settings/enroll"],
  ["Public sharing", "/settings/sharing"],
  ["Security audit", "/settings/audit"],
  ["Sessions", "/settings/sessions"],
] as const

export default function MockToolbar() {
  const state = useSyncExternalStore(
    mockDiagnostics.subscribe,
    mockDiagnostics.getSnapshot,
    mockDiagnostics.getSnapshot,
  )
  const navigate = useNavigate()
  const location = useLocation()
  const revalidator = useRevalidator()
  const [expanded, setExpanded] = useState(true)
  useEffect(() => {
    function reportClientIssue(event: Event) {
      if (event instanceof CustomEvent && typeof event.detail === "string") {
        mockDiagnostics.report(event.detail)
      }
    }
    window.addEventListener("replica:client-issue", reportClientIssue)
    return () => window.removeEventListener("replica:client-issue", reportClientIssue)
  }, [])

  return (
    <aside className="hub-test-toolbar" aria-label="Frontend test controls">
      <button
        type="button"
        className="hub-test-toolbar__toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        Test data {expanded ? "\u2212" : "+"}
      </button>
      {expanded ? (
        <div className="hub-test-toolbar__content">
          <p>
            Local data only. Do not enter real credentials. No external accounts, Builds, or
            settings are changed.
          </p>
          <div className="hub-test-toolbar__controls">
            <label>
              Persona
              <select
                value={state.profile}
                onChange={(event) => {
                  const profile = mockProfiles.find((item) => item === event.currentTarget.value)
                  if (!profile) return
                  mockDiagnostics.selectProfile(profile)
                  window.location.assign(profile === "signed-out" ? "/sign-in" : "/")
                }}
              >
                {mockProfiles.map((profile) => (
                  <option value={profile} key={profile}>
                    {profiles[profile]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              API scenario
              <select
                value={state.scenario}
                onChange={(event) => {
                  const scenario = mockScenarios.find((item) => item === event.currentTarget.value)
                  if (!scenario) return
                  mockDiagnostics.selectScenario(scenario)
                  const search = new URLSearchParams(location.search)
                  search.delete("page")
                  search.delete("mockScenario")
                  const target = `${location.pathname}${search.size ? `?${search}` : ""}${location.hash}`
                  if (target !== `${location.pathname}${location.search}${location.hash}`) {
                    void navigate(target)
                  } else {
                    void revalidator.revalidate()
                  }
                }}
              >
                {mockScenarios.map((scenario) => (
                  <option value={scenario} key={scenario}>
                    {scenarios[scenario]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Open page
              <select
                value=""
                onChange={(event) => {
                  if (event.currentTarget.value) void navigate(event.currentTarget.value)
                }}
              >
                <option value="" disabled>
                  Choose a page
                </option>
                {destinations.map(([label, path]) => (
                  <option key={path} value={path}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => window.location.reload()}>
              Reset data
            </button>
          </div>
          {state.messages.length ? (
            <div className="hub-test-toolbar__diagnostics" role="status" aria-live="polite">
              <ul>
                {state.messages.map(({ id, message }) => (
                  <li key={id}>{message}</li>
                ))}
              </ul>
              <button type="button" onClick={mockDiagnostics.clear}>
                Clear messages
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}
