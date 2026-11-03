let ready: Promise<void> | undefined

export async function bootstrapHubApi(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.MODE !== "mock") return

  const startup = (ready ??= import("../mocks/browser").then(({ startMockApi }) => startMockApi()))
  try {
    await startup
  } catch (error) {
    if (ready === startup) ready = undefined
    throw error
  }
}
