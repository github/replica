import type { JobQueue } from "../types.ts"

const jobStates = ["waiting", "prioritized"] as const
const pageSize = 100

export async function reprioritizeJobs(queue: JobQueue, input: { name: string; priority: number }) {
  for (const state of jobStates) {
    const matches: Awaited<ReturnType<JobQueue["getJobs"]>> = []
    for (let start = 0; ; start += pageSize) {
      const jobs = await queue.getJobs(state, start, start + pageSize - 1, true)
      matches.push(...jobs.filter((job) => job.name === input.name))
      if (jobs.length < pageSize) break
    }
    for (const job of matches) {
      if (job.priority !== input.priority) {
        await job.changePriority({ priority: input.priority })
      }
    }
  }
}
