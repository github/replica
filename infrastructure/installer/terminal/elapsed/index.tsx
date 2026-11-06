import { useEffect, useState } from "react"
import { Text } from "ink"

export function Elapsed({ started, animate }: { started: number; animate: boolean }) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!animate) return
    const timer = setInterval(() => setNow(performance.now()), 1_000)
    return () => clearInterval(timer)
  }, [animate])
  if (!animate) return null
  const seconds = Math.max(0, Math.floor((now - started) / 1_000))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor(seconds / 60) % 60
  const time = `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
  return <Text dimColor>Elapsed {time}</Text>
}
