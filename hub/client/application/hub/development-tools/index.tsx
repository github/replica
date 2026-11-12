import { lazy, Suspense } from "react"

const Tools =
  import.meta.env.DEV && import.meta.env.MODE === "mock"
    ? lazy(() => import("../mocks/mock-toolbar"))
    : null

export function DevelopmentTools() {
  return Tools ? (
    <Suspense fallback={null}>
      <Tools />
    </Suspense>
  ) : null
}
