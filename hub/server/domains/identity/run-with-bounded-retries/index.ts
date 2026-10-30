const maxAttempts = 3
const baseDelayMs = 5
const maxDelayMs = 20

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

export async function runWithBoundedRetries<Result>(
  operation: (attempt: number) => Promise<Result>,
  shouldRetry: (error: unknown) => boolean,
): Promise<Result> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      if (attempt === maxAttempts || !shouldRetry(error)) throw error
      await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs))
    }
  }
  throw new Error("Transaction retry loop ended without a result.")
}
