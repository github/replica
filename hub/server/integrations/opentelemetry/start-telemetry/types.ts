import type { Logger } from "pino"

export type TelemetryLogger = Pick<Logger, "error" | "warn">

export type TelemetryRuntime = {
  shutdown(): Promise<void>
}
