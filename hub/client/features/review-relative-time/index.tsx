import { useSyncExternalStore } from "react"

const UNITS: Array<[number, string]> = [
  [31_536_000, "y"],
  [2_592_000, "mo"],
  [604_800, "w"],
  [86_400, "d"],
  [3_600, "h"],
  [60, "m"],
]

function subscribe(onChange: () => void) {
  const interval = window.setInterval(onChange, 60_000)
  return () => window.clearInterval(interval)
}
function currentMinute() {
  return Math.floor(Date.now() / 60_000) * 60_000
}
function serverMinute(): number | null {
  return null
}

/** Keeps the server-rendered date deterministic until the browser can calculate elapsed time. */
export function ReviewRelativeTime({
  value,
  showTitle = true,
}: {
  value: string
  showTitle?: boolean
}) {
  const timestamp = Date.parse(value)
  const fullDate = Number.isNaN(timestamp) ? value : new Date(timestamp).toUTCString()
  const now = useSyncExternalStore(subscribe, currentMinute, serverMinute)

  let label = fullDate
  if (now !== null && !Number.isNaN(timestamp)) {
    const elapsed = Math.round((now - timestamp) / 1_000)
    const unit = UNITS.find(([seconds]) => Math.abs(elapsed) >= seconds)
    label = unit
      ? `${elapsed < 0 ? "in " : ""}${Math.round(Math.abs(elapsed) / unit[0])}${unit[1]}${elapsed < 0 ? "" : " ago"}`
      : "just now"
  }

  return (
    <time dateTime={value} title={showTitle ? fullDate : undefined} aria-label={fullDate}>
      {label}
    </time>
  )
}
