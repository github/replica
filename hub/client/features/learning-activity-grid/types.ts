/** One day in the activity grid. Past days without a run use the "none" state. */
export interface LearningActivityDay {
  date: string
  runState: "none" | "succeeded" | "failed"
  startedAt: string | null
  /** Who started the day's last run, such as "@mona", when Hub knows. */
  startedBy: string | null
  commentsAnalyzed: number
  commentsTagged: number
  suggestions: number
}
