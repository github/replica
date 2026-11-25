# == Schema Information
#
# Table name: notification_deliveries
# Database name: primary
#
#  id                       :integer          not null, primary key
#  attempts                 :integer          default(0), not null
#  delivered_at             :datetime
#  due_at                   :datetime         not null
#  enqueue_claim_expires_at :datetime
#  failure_code             :string
#  lease_token              :string
#  provider_key             :string           not null
#  state                    :string           default("pending"), not null
#  created_at               :datetime         not null
#  updated_at               :datetime         not null
#  notification_id          :integer          not null
#
# Indexes
#
#  index_notification_deliveries_on_notification_id   (notification_id) UNIQUE
#  index_notification_deliveries_on_state_and_due_at  (state,due_at)
#
# Foreign Keys
#
#  notification_id  (notification_id => notifications.id) ON DELETE => cascade
#
# Check Constraints
#
#  notification_deliveries_attempts  (attempts >= 0)
#  notification_deliveries_state     (state IN ('pending', 'delivering', 'retryable', 'succeeded', 'failed', 'canceled'))
#
# Persists external delivery independently of Inbox read state and the job database.
class NotificationDelivery < ApplicationRecord
  MAXIMUM_ATTEMPTS = 8
  MAXIMUM_MESSAGES = 25
  LEASE = 5.minutes
  ENQUEUE_CLAIM = 15.minutes
  DUE_STATES = %w[pending delivering retryable].freeze
  FAILURE_CODES = %w[
    transport_timeout rate_limited service_unavailable authentication_failed
    recipient_unavailable invalid_payload eligibility_unavailable authorization_unavailable
  ].freeze

  class_attribute :provider, default: nil

  class Failure < StandardError
    attr_reader :code, :retryable

    # Only fixed codes may cross the adapter boundary, never upstream response text.
    def initialize(code:, retryable:)
      raise ArgumentError, "Unknown notification delivery failure code" if !FAILURE_CODES.include?(code.to_s)

      @code = code.to_s
      @retryable = retryable == true
      super(@code)
    end
  end

  belongs_to :notification
  validates :notification_id, uniqueness: true
  validates :state, inclusion: { in: DUE_STATES + %w[succeeded failed canceled] }

  performs :deliver!, queue_as: :default do
    self.enqueue_after_transaction_commit = true
    discard_on ActiveJob::DeserializationError
  end

  # Standard installations have no adapter and perform no external delivery.
  def self.configured?
    provider.present?
  end

  # Commits only new eligible activity with its Inbox notification in one transaction.
  def self.record!(notification)
    return if !NotificationSetting.enabled?

    recipient = notification.recipient
    prototype = notification.review_comment.prototype
    return if NotificationPreference.where(recipient:, enabled: false).exists? ||
      NotificationMute.exists?(recipient:, prototype:)

    attributes = { notification:, due_at: Time.current.beginning_of_hour + 1.hour }
    begin
      key = provider.key
    rescue Failure => error
      Rails.logger.warn("Notification delivery configuration failed: #{error.code}")
      return create!(**attributes, provider_key: "unavailable", state: "failed", failure_code: error.code)
    end
    create!(**attributes, provider_key: key)
  end

  # Excludes live leases and claims, including work already handed to a queue.
  def self.due
    where(state: DUE_STATES, due_at: ..Time.current)
      .where("notification_deliveries.enqueue_claim_expires_at IS NULL OR notification_deliveries.enqueue_claim_expires_at <= ?", Time.current)
  end

  # Recovers queue gaps, and never forwards an old destination's backlog to a new one.
  def self.recover!
    if !NotificationSetting.enabled?
      cancel!(Notification.all)
      return
    end

    where(state: DUE_STATES).where.not(provider_key: provider.key)
      .update_all(state: "canceled", lease_token: nil, updated_at: Time.current)
    ids = due.joins(:notification).group("notifications.recipient_id").pluck("MIN(notification_deliveries.id)")
    where(id: ids).find_each(&:enqueue)
  end

  # Cancels unsent work immediately, including a worker still preparing a digest.
  def self.cancel!(notifications)
    where(notification_id: notifications.select(:id), state: DUE_STATES)
      .update_all(state: "canceled", lease_token: nil, enqueue_claim_expires_at: nil, updated_at: Time.current)
  end

  # Retains sanitized delivery outcomes for the same bounded period as operational history.
  def self.clear_expired!
    where(created_at: ...90.days.ago).in_batches.delete_all
  end

  # Queue failure leaves durable due work for the next recovery pass.
  def enqueue
    expires_at = ENQUEUE_CLAIM.from_now
    claimed = self.class.due.where(id:).update_all(enqueue_claim_expires_at: expires_at)
    return if claimed.zero?

    job = deliver_later!
    Rails.logger.error("Notification delivery #{id} enqueue was rejected") if !job
  rescue ActiveJob::EnqueueError, SolidQueue::Job::EnqueueError => error
    Rails.logger.error("Notification delivery #{id} enqueue failed: #{error.class}")
  ensure
    if claimed&.positive? && !job
      self.class.where(id:, enqueue_claim_expires_at: expires_at).update_all(enqueue_claim_expires_at: nil)
    end
  end

  # Claims a bounded recipient batch, then authorizes and sends outside database locks.
  def deliver!
    token = SecureRandom.uuid
    batch = claim!(token)
    return if batch.empty?

    identity = notification.recipient
    configuration = GithubAppConfiguration.current
    raise Failure.new(code: :authorization_unavailable, retryable: true) if configuration.nil?

    profile = configuration.github_client.repositories.mention_profile \
      identity.login, token: configuration.tokens.installation, github_id: identity.github_id
    if profile.nil?
      finish!(token, state: "canceled", failure_code: "recipient_unavailable")
      return
    end
    raise GithubClient::InvalidResponse, "GitHub returned a different notification recipient" if
      profile[:github_id] != identity.github_id

    identity = GithubIdentity.record!(profile)
    recipient = { github_id: identity.github_id, login: identity.login }
    if !self.class.provider.eligible?(recipient:)
      finish!(token, state: "canceled", failure_code: "recipient_unavailable")
      return
    end

    visible_ids = Notification.visible_to(identity).pluck(:id)
    batch = leased(token).where(id: batch.map(&:id), notification_id: visible_ids)
      .includes(notification: { review_comment: { prototype: :repository } }).select { sendable?(_1) }
    active_ids = batch.map(&:id)
    leased(token).where.not(id: active_ids).update_all(state: "canceled", lease_token: nil, updated_at: Time.current)
    return if batch.empty?

    messages = batch.map { message_for(_1.notification) }
    return if leased(token).where(id: active_ids).count != active_ids.length ||
      !batch.all? { sendable?(_1) }

    self.class.provider.deliver! \
      recipient:, messages:,
      preferences_url: "#{Rails.configuration.x.hub_origin.delete_suffix('/')}#{Rails.application.routes.url_helpers.notification_settings_path}"
    finish!(token, state: "succeeded", delivered_at: Time.current, failure_code: nil)
  rescue GithubClient::Error
    fail_batch!(token, code: "authorization_unavailable", retryable: true)
  rescue Failure => error
    fail_batch!(token, code: error.code, retryable: error.retryable)
  end

  private

  # Serializes recipient claims while letting unrelated recipients send independently.
  def claim!(token)
    return [] if !NotificationSetting.enabled?

    recipient = notification.recipient
    key = self.class.provider.key
    ids = []
    recipient.with_lock do
      self.class.where(id:).update_all(enqueue_claim_expires_at: nil)
      candidates = self.class.due.joins(:notification)
        .where(notifications: { recipient_id: recipient.id }, provider_key: key)
      candidates.where(attempts: MAXIMUM_ATTEMPTS..)
        .update_all(state: "failed", failure_code: "attempts_exhausted", lease_token: nil, updated_at: Time.current)
      ids = candidates.where(attempts: ...MAXIMUM_ATTEMPTS).order(:id).limit(MAXIMUM_MESSAGES).pluck(:id)
      self.class.where(id: ids).update_all \
        state: "delivering", lease_token: token, due_at: LEASE.from_now,
        attempts: Arel.sql("attempts + 1"), enqueue_claim_expires_at: nil, updated_at: Time.current
    end
    self.class.where(id: ids).includes(notification: { review_comment: :prototype }).to_a
  end

  # Checks current preference and source state without retaining message text in the outbox.
  def sendable?(delivery)
    return false if !NotificationSetting.enabled? || delivery.provider_key != self.class.provider.key ||
      delivery.state != "delivering"

    activity = delivery.notification
    comment = activity.review_comment
    return false if comment.nil? || comment.deleted_at || comment.root&.deleted_at ||
      comment.prototype.repository.reload.installation_state != "active"

    !NotificationPreference.where(recipient_id: activity.recipient_id, enabled: false).exists? &&
      !NotificationMute.exists?(recipient_id: activity.recipient_id, prototype_id: comment.prototype_id)
  end

  # Builds only the fixed, authorized adapter contract, with bounded review text.
  def message_for(activity)
    comment = activity.review_comment
    prototype = comment.prototype
    path = Rails.application.routes.url_helpers.repository_prototype_path \
      prototype.repository.route_id, prototype, comment: comment.id, notification: activity.id
    {
      id: activity.id, kind: activity.kind, actor_login: activity.actor.login,
      repository: prototype.repository.name_with_owner,
      prototype: prototype.name.presence || prototype.branch_name,
      excerpt: comment.body.to_s.truncate(240), occurred_at: activity.created_at.iso8601(6),
      url: "#{Rails.configuration.x.hub_origin.delete_suffix('/')}#{path}"
    }
  end

  # A stale worker cannot overwrite cancellation or a newer delivery attempt.
  def leased(token)
    self.class.where(state: "delivering", lease_token: token)
  end

  # Finishes only the current claim without changing Inbox read state.
  def finish!(token, **attributes)
    leased(token).update_all(**attributes, lease_token: nil, updated_at: Time.current)
  end

  # Bounds transient retries without logging an upstream error or a digest payload.
  def fail_batch!(token, code:, retryable:)
    Rails.logger.warn("Notification delivery failed: #{code}")
    leased(token).find_each do |delivery|
      retrying = retryable && delivery.attempts < MAXIMUM_ATTEMPTS
      leased(token).where(id: delivery.id).update_all \
        state: retrying ? "retryable" : "failed", failure_code: code, lease_token: nil,
        due_at: [ 30.seconds * (2**(delivery.attempts - 1)), 6.hours ].min.from_now, updated_at: Time.current
    end
  end
end
