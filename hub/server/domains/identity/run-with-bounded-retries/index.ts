import type { RunWithBoundedRetriesInput } from "./types.ts"

export async function runWithBoundedRetries<Result>(
  operation: (attempt: number) => Promise<Result>,
  options: RunWithBoundedRetriesInput,
): Promise<Result> {
  if (
    !Number.isSafeInteger(options.maxAttempts) ||
    options.maxAttempts < 1 ||
    options.maxAttempts > 5
  ) {
    throw new Error("Transaction retry attempts must be between 1 and 5.")
  }
  if (
    !Number.isSafeInteger(options.baseDelayMs) ||
    options.baseDelayMs < 0 ||
    !Number.isSafeInteger(options.maxDelayMs) ||
    options.maxDelayMs < options.baseDelayMs ||
    options.maxDelayMs > 30_000
  ) {
    throw new Error("Transaction retry delays must be bounded between 0 and 30000 milliseconds.")
  }

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      if (attempt === options.maxAttempts || !options.shouldRetry(error)) throw error
      const delay = Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs)
      await options.sleep(delay)
    }
  }
  throw new Error("Transaction retry loop ended without a result.")
}
