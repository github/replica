import type { CopilotConnectionSnapshot } from "../types.ts"

export async function readCopilotConnectionSnapshot({
  getConnection,
  getState,
}: {
  getConnection: () => Promise<{ id: string } | null>
  getState: () => Promise<{ generation: bigint } | null>
}): Promise<CopilotConnectionSnapshot> {
  const state = await getState()
  if (!state) throw new Error("The Copilot connection state is unavailable.")
  const connection = await getConnection()
  return { connectionId: connection?.id ?? null, generation: state.generation }
}
