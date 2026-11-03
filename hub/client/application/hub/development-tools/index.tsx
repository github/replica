import { lazy, Suspense } from "react"

const Tools =
  import.meta.env.DEV && import.meta.env.MODE === "mock"
    ? lazy(() => import("../mocks/toolbar"))
    : null

export function DevelopmentTools() {
  return Tools ? (
    <Suspense fallback={null}>
      <Tools />
    </Suspense>
  ) : null
}
