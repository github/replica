export interface TransactionRetryOptions {
  baseDelayMs: number
  maxAttempts: number
  maxDelayMs: number
  sleep(delayMs: number): Promise<void>
}

export interface RunWithBoundedRetriesInput extends TransactionRetryOptions {
  shouldRetry(error: unknown): boolean
}
