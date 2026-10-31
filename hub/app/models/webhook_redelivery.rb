# == Schema Information
#
# Table name: webhook_redeliveries
# Database name: primary
#
#  id                          :integer          not null, primary key
#  attempts                    :integer          default(0), not null
#  credential_revision         :bigint           default(1), not null
#  due_at                      :datetime         not null
#  event                       :string           not null
#  expires_at                  :datetime         not null
#  failure_code                :string
#  first_delivered_at          :datetime         not null
#  lease_token                 :string
#  state                       :string           default("pending"), not null
#  created_at                  :datetime         not null
#  updated_at                  :datetime         not null
#  github_app_configuration_id :bigint           not null
#  github_app_id               :bigint           not null
#  github_attempt_id           :bigint
#  github_delivery_id          :string           not null
#  installation_id             :bigint
#
# Indexes
#
#  index_webhook_redeliveries_on_app_and_guid          (github_app_configuration_id,github_delivery_id) UNIQUE
#  index_webhook_redeliveries_on_github_delivery_id    (github_delivery_id)
#  index_webhook_redeliveries_on_state_and_due_at      (state,due_at)
#  index_webhook_redeliveries_on_state_and_updated_at  (state,updated_at)
#
# Check Constraints
#
#  webhook_redelivery_app           (github_app_configuration_id > 0 AND github_app_id > 0)
#  webhook_redelivery_attempt_id    (github_attempt_id IS NULL OR github_attempt_id > 0)
#  webhook_redelivery_attempts      (attempts BETWEEN 0 AND 12)
#  webhook_redelivery_event         (event IN ('push', 'workflow_run', 'installation', 'installation_repositories'))
#  webhook_redelivery_guid          (length(trim(github_delivery_id)) BETWEEN 1 AND 255)
#  webhook_redelivery_installation  (installation_id IS NULL OR installation_id > 0)
#  webhook_redelivery_revision      (credential_revision > 0)
#  webhook_redelivery_state         (state IN ('pending', 'requesting', 'waiting', 'succeeded', 'failed'))
#  webhook_redelivery_window        (expires_at > first_delivered_at)
#
# Persists bounded resend metadata, never webhook bodies or user credentials.
class WebhookRedelivery < ApplicationRecord
  WINDOW = 3.days
  MAXIMUM_ATTEMPTS = 12
  LEASE = 5.minutes
  ACTIVE_STATES = %w[pending requesting waiting].freeze
  STATES = (ACTIVE_STATES + %w[succeeded failed]).freeze

  validates :state, inclusion: { in: STATES }
  validates :github_delivery_id, presence: true, length: { maximum: 255 }
  validates :event, inclusion: { in: %w[push workflow_run installation installation_repositories] }
  validates :github_app_configuration_id, :github_app_id, numericality: { only_integer: true, greater_than: 0 }
  validates :attempts, numericality: { only_integer: true, in: 0..MAXIMUM_ATTEMPTS }

  class << self
    # A signed throttle receipt waits for GitHub's numeric attempt metadata.
    def record_throttle!(configuration:, delivery:, installation_id:)
      record_pending! \
        configuration:, guid: delivery.github_delivery_id, event: delivery.event,
        installation_id:, delivered_at: delivery.created_at
    end

    # A current App's failed remote attempt requests a new, normally verified delivery.
    def record_remote!(configuration:, metadata:)
      return if !GithubWebhook.supported_event?(event: metadata["event"], action: metadata["action"])
      return if !configuration.accepts_installation?(metadata["installation_id"])
      return if where(github_delivery_id: metadata["guid"]).where.not(github_app_configuration_id: configuration.id).exists?

      receipt = WebhookDelivery.find_by(github_delivery_id: metadata["guid"])
      return if receipt&.processed?

      existing = find_by(github_app_configuration_id: configuration.id, github_delivery_id: metadata["guid"])
      if receipt && receipt.event != metadata["event"]
        existing&.update!(state: "failed", failure_code: "identity_mismatch", lease_token: nil)
        return
      end
      status = metadata["status_code"]
      transient = status.nil? || status.zero? || status == 429 || status.between?(500, 599)
      return if status && status.between?(400, 499) && status != 429
      return if existing.nil? && !transient
      return if existing && !ACTIVE_STATES.include?(existing.state)

      record_pending! \
        configuration:, guid: metadata.fetch("guid"), event: metadata.fetch("event"),
        installation_id: metadata["installation_id"], delivered_at: Time.iso8601(metadata.fetch("delivered_at")),
        attempt_id: metadata.fetch("id"), reverified: true
    end

    # Success is recorded only by the signature-verified inbound processor.
    def complete!(configuration:, guid:)
      GithubAppConfiguration.with_credentials!(**configuration.credential_snapshot) do
        where(github_app_configuration_id: configuration.id, github_delivery_id: guid)
          .update_all(state: "succeeded", lease_token: nil, failure_code: nil, updated_at: Time.current)
      end
    end

    # Minute ticks report unresolved expiry without deleting retained history.
    def expire!
      expired = where(state: ACTIVE_STATES, expires_at: ..Time.current)
      if expired.update_all(state: "failed", failure_code: "window_expired", lease_token: nil, updated_at: Time.current).positive?
        SecurityAuditEvent.record!(action: "webhook_recovery.expire", outcome: "failed", actor: nil)
        Rails.logger.error("Webhook recovery window expired for unresolved deliveries")
      end
    end

    # Hourly retention uses small deletes rather than one long primary write lock.
    def clear_expired!
      where(state: %w[succeeded failed], updated_at: ...30.days.ago)
        .in_batches(of: 1_000).delete_all
      WebhookDelivery.where(created_at: ...7.days.ago).in_batches(of: 1_000).delete_all
      WebhookRecoveryCheckpoint.where.not(github_app_configuration_id: GithubAppConfiguration.current&.id)
        .where(updated_at: ...30.days.ago).in_batches(of: 1_000).delete_all
    end

    # Retains original delivery time across GitHub's differently numbered attempts.
    def record_pending!(configuration:, guid:, event:, installation_id:, delivered_at:, attempt_id: nil, reverified: false)
      return if !configuration.accepts_installation?(installation_id)

      GithubAppConfiguration.with_credentials!(**configuration.credential_snapshot) do
        if delivered_at + WINDOW <= Time.current
          where(github_app_configuration_id: configuration.id, github_delivery_id: guid, state: ACTIVE_STATES)
            .update_all(state: "failed", failure_code: "window_expired", lease_token: nil, updated_at: Time.current)
          return
        end

        entry = create_or_find_by! \
          github_app_configuration_id: configuration.id, github_delivery_id: guid do |record|
            record.assign_attributes \
              github_app_id: configuration.github_app_id, credential_revision: configuration.credential_revision,
              event:, installation_id:,
              first_delivered_at: delivered_at, expires_at: delivered_at + WINDOW, due_at: 1.minute.from_now
          end
        entry.with_lock do
          return entry if !ACTIVE_STATES.include?(entry.state)
          if entry.github_app_id != configuration.github_app_id ||
              entry.event != event ||
              entry.installation_id != installation_id
            entry.update!(state: "failed", failure_code: "identity_mismatch", lease_token: nil)
            return entry
          end

          first = [ entry.first_delivered_at, delivered_at ].min
          attributes = { first_delivered_at: first, expires_at: first + WINDOW }
          if entry.credential_revision != configuration.credential_revision
            return entry if !reverified

            attributes.merge! \
              credential_revision: configuration.credential_revision, state: "pending",
              lease_token: nil, failure_code: nil
          end
          attributes[:github_attempt_id] = attempt_id if attempt_id && (entry.lease_token.nil? || attributes.key?(:credential_revision))
          entry.update!(attributes)
        end
        entry
      end
    end
  end

  # Claims one resend, then calls GitHub without holding a database transaction.
  def redeliver!(configuration:)
    token = SecureRandom.uuid
    with_lock do
      return if !ACTIVE_STATES.include?(state) || due_at > Time.current || github_attempt_id.nil?
      return fail!("window_expired") if expires_at <= Time.current
      return fail!("attempts_exhausted") if attempts >= MAXIMUM_ATTEMPTS
      return fail!("app_changed") if !same_app?(configuration)
      return if !current_app?(configuration)

      return fail!("installation_changed") if stale_installation?(configuration)
      if WebhookDelivery.where(github_delivery_id:).where.not(processed_at: nil).exists?
        update!(state: "succeeded", lease_token: nil, failure_code: nil)
        return
      end

      update!(state: "requesting", attempts: attempts + 1, due_at: LEASE.from_now, lease_token: token)
    end
    return finish!(token, state: "failed", failure_code: "app_changed") if !current_app?(configuration)
    return finish!(token, state: "failed", failure_code: "installation_changed") if stale_installation?(configuration)

    configuration.github_client.webhook_deliveries.redeliver(github_attempt_id, token: configuration.tokens.app)
    finish!(token, state: "waiting", failure_code: nil, due_at: retry_at)
  rescue GithubAppConfiguration::Superseded
    finish!(token, state: "pending", failure_code: "credentials_changed")
  rescue GithubClient::Error => error
    Rails.logger.error("Webhook redelivery #{id} request failed: #{error.class}")
    code = error.is_a?(GithubClient::NotFound) || error.is_a?(GithubClient::Gone) ? "remote_unavailable" : "github_unavailable"
    finish!(token, state: "waiting", failure_code: code, due_at: retry_at)
  end

  private

  # App IDs alone cannot revive work from a removed local configuration.
  def current_app?(configuration)
    current = GithubAppConfiguration.uncached { GithubAppConfiguration.current }
    same_app?(configuration, current:) &&
      current.credential_revision == credential_revision &&
      configuration.credential_revision == current.credential_revision
  end

  # Reset or replacement cannot inherit the previous configuration's backlog.
  def same_app?(configuration, current: GithubAppConfiguration.uncached { GithubAppConfiguration.current })
    current && current.id == github_app_configuration_id && current.github_app_id == github_app_id &&
      configuration.id == current.id && configuration.github_app_id == current.github_app_id
  end

  # Installation events may restore an installation; repository events may not.
  def stale_installation?(configuration)
    current = GithubAppConfiguration.uncached { GithubAppConfiguration.current }
    if !same_app?(configuration, current:) || current.credential_revision != credential_revision ||
        configuration.credential_revision != current.credential_revision
      raise GithubAppConfiguration::Superseded, "GitHub App credentials changed; start again"
    end

    return true if current.pinned_installation? && !current.accepts_installation?(installation_id)

    return false if event.in?(%w[installation installation_repositories])

    installation_id.nil? || current.installation_state != "active" ||
      current.installation_id != installation_id
  end

  # Bounds resend pressure even when GitHub accepts a request but no receipt arrives.
  def retry_at
    [ 1.minute * (2**(attempts - 1)), 1.hour ].min.from_now
  end

  # The lease prevents stale workers from overwriting an inbound success.
  def finish!(token, **attributes)
    GithubAppConfiguration.with_credentials! \
      configuration_id: github_app_configuration_id, credential_revision: do
        self.class.where(id:, credential_revision:, state: "requesting", lease_token: token)
          .update_all(**attributes, lease_token: nil, updated_at: Time.current)
      end
  rescue GithubAppConfiguration::Superseded
    self.class.transaction do
      current = GithubAppConfiguration.uncached { GithubAppConfiguration.current }
      same_app = same_app?(current, current:)
      self.class.where(id:, credential_revision:, state: "requesting", lease_token: token)
        .update_all \
          state: same_app ? "pending" : "failed", failure_code: same_app ? "credentials_changed" : "app_changed",
          lease_token: nil, updated_at: Time.current
    end
    false
  end

  # Terminal failures remain available to the operator for 30 days.
  def fail!(code)
    update!(state: "failed", failure_code: code, lease_token: nil)
    Rails.logger.error("Webhook redelivery #{id} unresolved: #{code}")
  end
end
