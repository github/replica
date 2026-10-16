import { targets } from "../fixtures"
import type { Route } from "../types"

type Props = {
  route: Route
}

export function ImprovementPreview({ route }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 960 560"
      className="improvement-demo__scene"
      role="group"
      aria-label={`Sample prototype ${route}`}
      fontFamily="system-ui, sans-serif"
    >
      <rect width="960" height="560" fill="#f8fafc" />
      {targets
        .filter((target) => target.route === route)
        .map((target) => (
          <g key={target.id} data-improvement-target={target.id}>
            <rect
              {...target.rect}
              rx="10"
              fill={
                target.id.includes("heading")
                  ? "#f8fafc"
                  : target.id === "new-project" || target.id === "save-settings"
                    ? "#155d3d"
                    : "#ffffff"
              }
              stroke={target.id.includes("heading") ? "none" : "#dce3e9"}
            />
            {target.id.includes("heading") ? (
              <>
                <text x="40" y="67" fill="#172b24" fontSize="28" fontWeight="650">
                  {route === "/projects" ? "Your projects" : "Workspace settings"}
                </text>
                <text x="40" y="99" fill="#596b65" fontSize="15">
                  {route === "/projects"
                    ? "A home for your team's next great idea."
                    : "Make this space work for your team."}
                </text>
              </>
            ) : target.id === "new-project" || target.id === "save-settings" ? (
              <text
                x={target.rect.x + target.rect.width / 2}
                y={target.rect.y + 26}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="14"
                fontWeight="600"
              >
                {target.id === "new-project" ? "+ Create project" : "Save settings"}
              </text>
            ) : target.id === "activity" ? (
              <>
                <text x="64" y="179" fill="#596b65" fontSize="13">
                  THIS WEEK
                </text>
                <text x="64" y="214" fill="#172b24" fontSize="23" fontWeight="600">
                  12 prototypes
                </text>
                <text x="348" y="179" fill="#596b65" fontSize="13">
                  IN REVIEW
                </text>
                <text x="348" y="214" fill="#172b24" fontSize="23" fontWeight="600">
                  4 conversations
                </text>
                <text x="642" y="179" fill="#596b65" fontSize="13">
                  YOUR TEAM
                </text>
                <text x="642" y="214" fill="#172b24" fontSize="23" fontWeight="600">
                  Making things happen
                </text>
              </>
            ) : target.id.includes("card") ? (
              <>
                <rect
                  x={target.rect.x + 16}
                  y="301"
                  width="388"
                  height="100"
                  rx="6"
                  fill={target.id === "welcome-card" ? "#e3efe9" : "#eee9f7"}
                />
                <rect
                  x={target.rect.x + 40}
                  y="323"
                  width="100"
                  height="10"
                  rx="4"
                  fill="#ffffff"
                />
                <rect x={target.rect.x + 40} y="345" width="196" height="6" rx="3" fill="#ffffff" />
                <rect x={target.rect.x + 40} y="363" width="156" height="6" rx="3" fill="#ffffff" />
                <text x={target.rect.x + 24} y="437" fill="#172b24" fontSize="18" fontWeight="600">
                  {target.id === "welcome-card" ? "Welcome experience" : "A better onboarding"}
                </text>
                <text x={target.rect.x + 24} y="463" fill="#596b65" fontSize="13">
                  {target.id === "welcome-card" ? "prototype/welcome" : "prototype/onboarding"}
                </text>
                <circle cx={target.rect.x + 30} cy="490" r="5" fill="#2a7954" />
                <text x={target.rect.x + 44} y="495" fill="#596b65" fontSize="12">
                  Updated today · The Octocat
                </text>
              </>
            ) : target.id === "workspace-name" ? (
              <>
                <text x="64" y="184" fill="#172b24" fontSize="17" fontWeight="600">
                  Workspace name
                </text>
                <text x="64" y="209" fill="#596b65" fontSize="13">
                  This is how your workspace appears to your team.
                </text>
                <rect
                  x="64"
                  y="230"
                  width="600"
                  height="38"
                  rx="6"
                  fill="#f8fafc"
                  stroke="#dce3e9"
                />
                <text x="78" y="255" fill="#172b24" fontSize="14">
                  Octocat's workspace
                </text>
              </>
            ) : (
              <>
                <text x="64" y="351" fill="#172b24" fontSize="17" fontWeight="600">
                  Notifications
                </text>
                <text x="64" y="385" fill="#596b65" fontSize="14">
                  Keep me in the loop
                </text>
                <rect x="824" y="366" width="48" height="26" rx="13" fill="#155d3d" />
                <circle cx="857" cy="379" r="9" fill="#ffffff" />
              </>
            )}
          </g>
        ))}
    </svg>
  )
}
