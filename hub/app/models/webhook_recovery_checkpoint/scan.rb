# Walks GitHub's metadata with bounded pages, resend requests, and durable progress.
class WebhookRecoveryCheckpoint::Scan < ActiveRecord::AssociatedObject
  MAXIMUM_PAGES_PER_JOB = 10
  MAXIMUM_PAGES_PER_SCAN = 5_000
  MAXIMUM_REDELIVERIES_PER_JOB = 30
  class PageLimitReached < GithubClient::InvalidResponse; end

  # Authenticates the current App before scanning or asking for any redelivery.
  def call(token:)
    verified = false
    configuration = current_configuration
    return record.finish!(token, failure_code: "app_changed", lease_token: nil, due_at: 1.hour.from_now) if configuration.nil?
    return if !record.renew!(token)

    app = configuration.github_client.apps.get(token: configuration.tokens.app)
    raise GithubClient::InvalidResponse, "GitHub App identity does not match" if
      !app.is_a?(Hash) || !app["id"].is_a?(Integer) || app["id"] != configuration.github_app_id
    verified = true

    start_scan!(token, configuration) if record.scan_started_at.nil?
    MAXIMUM_PAGES_PER_JOB.times do
      return if !record.renew!(token) || current_configuration.nil?

      page = configuration.github_client.webhook_deliveries.page(token: configuration.tokens.app, cursor: record.cursor)
      GithubAppConfiguration.with_credentials!(**configuration.credential_snapshot) do
        return if !record.renew!(token)

        page.deliveries.each do |metadata|
          next if !configuration.accepts_installation?(metadata["installation_id"])

          WebhookRedelivery.record_remote!(configuration:, metadata:)
        end
      end
      pages = record.pages + 1
      done = page.cursor.nil? || previously_covered?(page)
      if pages >= MAXIMUM_PAGES_PER_SCAN && !done
        raise PageLimitReached, "Webhook recovery page bound exhausted"
      end

      attributes = if done
        { cursor: nil, pages: 0, scan_started_at: nil,
          last_completed_scan_started_at: record.scan_started_at,
          last_completed_credential_revision: record.credential_revision, last_completed_at: Time.current }
      else
        { cursor: page.cursor, pages: }
      end
      return if !record.finish!(token, **attributes)

      record.reload
      break if done
    end
    return if !redeliver_due!(configuration, token)

    record.finish!(token, failures: 0, failure_code: nil, lease_token: nil, due_at: 1.minute.from_now)
  rescue GithubAppConfiguration::Superseded
    record.finish!(token, failure_code: "credentials_changed", lease_token: nil, due_at: 1.hour.from_now)
  rescue GithubClient::Error => error
    Rails.logger.error("Webhook recovery #{record.id} scan failed: #{error.class}")
    failures = record.failures + 1
    code = if error.is_a?(PageLimitReached)
      "scan_limit"
    elsif error.is_a?(GithubClient::InvalidResponse)
      "invalid_response"
    else
      "github_unavailable"
    end
    # Previously validated attempt IDs can progress despite a failed metadata page.
    redeliver_due!(configuration, token) if verified
    if error.is_a?(PageLimitReached)
      record.finish! \
        token, cursor: nil, pages: 0, scan_started_at: nil,
        gap_started_at: record.last_completed_scan_started_at || record.created_at, gap_ended_at: Time.current
      SecurityAuditEvent.record!(action: "webhook_recovery.gap", outcome: "failed", actor: nil)
    end
    record.finish! \
      token, failures:, failure_code: code, lease_token: nil,
      due_at: [ 1.minute * (2**[ failures - 1, 6 ].min), 1.hour ].min.from_now
  end

  private

  # A saved job from a removed or replaced App cannot send an authenticated request.
  def current_configuration
    configuration = GithubAppConfiguration.current
    configuration if configuration && configuration.id == record.github_app_configuration_id &&
      configuration.github_app_id == record.github_app_id &&
      configuration.credential_revision == record.credential_revision
  end

  # Records unrecoverable gaps instead of resetting the checkpoint silently.
  def start_scan!(token, configuration)
    previous = record.last_completed_scan_started_at || configuration.created_at
    attributes = { scan_started_at: Time.current }
    if previous < WebhookRedelivery::WINDOW.ago
      attributes.merge!(gap_started_at: previous, gap_ended_at: WebhookRedelivery::WINDOW.ago)
    end
    return if !record.finish!(token, **attributes)

    if attributes[:gap_started_at]
      SecurityAuditEvent.record!(action: "webhook_recovery.gap", outcome: "failed", actor: nil)
      Rails.logger.error("Webhook recovery #{record.id} has a gap outside GitHub's recovery window")
    end
    record.reload
  end

  # Follow GitHub's date boundary, but process mixed pages in full before stopping.
  def previously_covered?(page)
    return false if record.last_completed_credential_revision != record.credential_revision

    boundary = record.last_completed_scan_started_at
    boundary && page.deliveries.any? &&
      page.deliveries.all? { Time.iso8601(_1.fetch("delivered_at")) < boundary }
  end

  # A small resend allowance leaves the inbound budget available for live work.
  def due_redeliveries(configuration)
    WebhookRedelivery.where(github_app_configuration_id: configuration.id, credential_revision: configuration.credential_revision)
      .where(state: WebhookRedelivery::ACTIVE_STATES)
      .where(due_at: ..Time.current).where.not(github_attempt_id: nil)
      .order(:due_at, :id).limit(MAXIMUM_REDELIVERIES_PER_JOB)
  end

  # Metadata failures do not stall already validated, bounded resend work.
  def redeliver_due!(configuration, token)
    due_redeliveries(configuration).each do |entry|
      return false if !record.renew!(token) || current_configuration.nil?

      entry.redeliver!(configuration:)
    end
    true
  end
end
