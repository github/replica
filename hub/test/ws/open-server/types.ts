import type { RealtimeOptions } from "../../../server/integrations/ws/types"

export type Options = Omit<RealtimeOptions<string>, "server" | "path" | "logger"> & {
  logger?: RealtimeOptions<unknown>["logger"]
}
