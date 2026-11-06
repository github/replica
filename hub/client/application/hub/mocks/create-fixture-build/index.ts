import {
  buildCountVariation,
  minimumBuildCount,
  originalWelcomeBuildCount,
  screenshotsUrl,
} from "./constants"
import type { FixtureBuild } from "./types"

const fixtureStartTime = Date.parse("2026-10-28T15:00:00Z")
const millisecondsPerMinute = 60_000
const buildIntervalMinutes = 120
const prototypeIntervalMinutes = 45
const failedBuildInterval = 13
const supersededBuildInterval = 9
const buildStartDelayMs = 10_000
const minimumBuildDurationMs = 45_000
const buildDurationVariation = 5
const buildDurationStepMs = 12_000
const commitPrototypeMultiplier = 1000
const latestBuildStates = [
  "successful",
  "successful",
  "failed",
  "queued",
  "running",
  "superseded",
] as const
const views = ["overview", "search", "activity", "settings", "planning", "welcome"] as const

export function createFixtureBuild(
  prototypeId: number,
  number: number,
  authorLogin: string,
  name: string,
): FixtureBuild {
  const created =
    fixtureStartTime +
    (prototypeId === 1
      ? (number - originalWelcomeBuildCount) * buildIntervalMinutes
      : prototypeId * prototypeIntervalMinutes + number * buildIntervalMinutes) *
      millisecondsPerMinute
  const isLatest =
    prototypeId !== 1 && number === minimumBuildCount + (prototypeId % buildCountVariation)
  const state = isLatest
    ? latestBuildStates[prototypeId % latestBuildStates.length]!
    : number % failedBuildInterval === 0
      ? "failed"
      : number % supersededBuildInterval === 0
        ? "superseded"
        : "successful"
  const view = views[prototypeId % views.length]!
  return {
    number,
    repositoryId: 2001,
    prototypeId,
    state,
    commitSha: (prototypeId * commitPrototypeMultiplier + number).toString(16).padStart(40, "0"),
    commitAuthorLogin: authorLogin,
    createdAt: new Date(created).toISOString(),
    startedAt: state === "queued" ? null : new Date(created + buildStartDelayMs).toISOString(),
    finishedAt:
      state === "queued" || state === "running"
        ? null
        : new Date(
            created +
              minimumBuildDurationMs +
              (number % buildDurationVariation) * buildDurationStepMs,
          ).toISOString(),
    previewUrl:
      state === "successful"
        ? `/previews/index.html?prototype=${encodeURIComponent(name)}&build=${number}`
        : null,
    desktopScreenshotUrl: state === "successful" ? `${screenshotsUrl}#${view}` : null,
    narrowScreenshotUrl: state === "successful" ? `${screenshotsUrl}#${view}-narrow` : null,
    failureSummary:
      state === "failed"
        ? "Type checking failed: the form submit handler needs an event type."
        : null,
  }
}
