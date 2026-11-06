import type { InstallerUI } from "../types.ts"

export async function promptForRecovery(
  ui: InstallerUI,
  {
    error,
    question,
    message,
    actions,
    details = message,
  }: {
    error: Error
    question: string
    message: string
    actions: { label: string; value: string }[]
    details?: string
  },
): Promise<string> {
  if (!ui.select) throw error
  while (true) {
    const headline = error.message.split("\n", 1)[0]?.slice(0, 180) || "The step failed."
    const summary = `${headline}\n${message}`
    if (ui.notice) ui.notice("error", summary)
    else ui.status(summary)
    const choice = await ui.select(question, [
      ...actions,
      { label: "Show full error details", value: "details" },
      { label: "Exit and keep saved progress", value: "exit" },
    ])
    if (choice === "details") {
      await ui.wait(
        `${error.message}\n\n${details}\nScroll to inspect the output, then press Enter to return to recovery choices. This does not retry the step.`,
      )
      continue
    }
    if (choice === "exit") throw error
    const action = actions.find(({ value }) => value === choice)
    if (!action) throw new Error("Choose a supported step recovery action.")
    return action.value
  }
}
