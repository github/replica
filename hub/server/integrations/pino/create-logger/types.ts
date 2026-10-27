import type { DestinationStream, LevelWithSilent } from "pino"

export interface LoggerOptions {
  level?: LevelWithSilent
  destination?: DestinationStream
}
