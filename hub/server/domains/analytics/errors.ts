export class AnalyticsSettingsError extends Error {
  readonly status: 404 | 409 | 422 | 503

  constructor(status: AnalyticsSettingsError["status"], message: string) {
    super(message)
    this.status = status
  }
}
