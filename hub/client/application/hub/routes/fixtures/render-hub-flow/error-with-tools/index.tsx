import { ErrorBoundary } from "@application/hub/root"
import MockToolbar from "@application/hub/mocks/mock-toolbar"

export function ErrorWithTools() {
  return (
    <>
      <MockToolbar />
      <ErrorBoundary />
    </>
  )
}
