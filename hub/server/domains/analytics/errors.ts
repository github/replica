export class AnalyticsSettingsError extends Error {
  constructor(
    readonly status: 404 | 409 | 422 | 503,
    message: string,
  ) {
    super(message)
  }
}
