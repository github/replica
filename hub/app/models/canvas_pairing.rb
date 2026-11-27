# == Schema Information
#
# Table name: canvas_pairings
# Database name: primary
#
#  id                     :integer          not null, primary key
#  approved_at            :datetime
#  consumed_at            :datetime
#  device_code_digest     :string           not null
#  expires_at             :datetime         not null
#  learnings_consented_at :datetime
#  refresh_token_digest   :string
#  user_code              :string           not null
#  created_at             :datetime         not null
#  updated_at             :datetime         not null
#  repository_id          :integer          not null
#  user_id                :integer
#
# Indexes
#
#  index_canvas_pairings_on_consumed_at         (consumed_at) WHERE consumed_at IS NOT NULL
#  index_canvas_pairings_on_device_code_digest  (device_code_digest) UNIQUE
#  index_canvas_pairings_on_expires_at          (expires_at)
#  index_canvas_pairings_on_repository_id       (repository_id)
#  index_canvas_pairings_on_user_code           (user_code) UNIQUE
#  index_canvas_pairings_on_user_id             (user_id)
#
# Foreign Keys
#
#  repository_id  (repository_id => repositories.id) ON DELETE => cascade
#  user_id        (user_id => users.id) ON DELETE => cascade
#
# Check Constraints
#
#  canvas_pairings_approval           ((approved_at IS NULL AND user_id IS NULL) OR (approved_at IS NOT NULL AND user_id IS NOT NULL))
#  canvas_pairings_consumption        (consumed_at IS NULL OR approved_at IS NOT NULL)
#  canvas_pairings_learnings_consent  (learnings_consented_at IS NULL OR approved_at IS NOT NULL)
#
# Holds a short-lived browser approval until the initiating extension consumes it.
class CanvasPairing < ApplicationRecord
  LIFETIME = 10.minutes
  LEARNINGS_CONSENT_VERSION = "1".freeze

  belongs_to :repository
  belongs_to :user, optional: true

  validates :device_code_digest, :user_code, :expires_at, presence: true
  validates :device_code_digest, :user_code, uniqueness: true
  after_create :audit_creation

  # Gives the extension a private polling proof and the user a separate short code.
  def self.start!(repository, renewable: false)
    device_code = SecureRandom.urlsafe_base64(32)
    refresh_token = "rr_#{SecureRandom.urlsafe_base64(32)}" if renewable
    pairing = create!(
      repository:,
      device_code_digest: Digest::SHA256.hexdigest(device_code),
      refresh_token_digest: refresh_token && Digest::SHA256.hexdigest(refresh_token),
      user_code: SecureRandom.hex(5).upcase,
      expires_at: LIFETIME.from_now
    )
    [ pairing, device_code, refresh_token ]
  end

  # Records an approval only while the request is pending. Only a form with the current learnings
  # disclosure can record consent; an older form still connects without learnings.
  def approve!(user, browser_session:, learnings_consent_version: nil)
    with_lock do
      raise ActiveRecord::RecordNotFound if !Session.where(id: browser_session&.id, user_id: user.id).exists?
      raise ActiveRecord::RecordNotFound if expires_at <= Time.current || approved_at || consumed_at

      now = Time.current
      update! \
        user:,
        approved_at: now,
        learnings_consented_at: learnings_consent_version == LEARNINGS_CONSENT_VERSION ? now : nil
      SecurityAuditEvent.record! \
        action: "canvas_pairing.approve", outcome: "succeeded", repository:, actor: user,
        context: (Current.security_audit_context || {}).merge(canvas_pairing_id: id)
      Analytics::Event.record! \
        repository:,
        name: "canvas_pairing_approved",
        source_key: "canvas_pairing/#{id}/approved",
        actor_id: Analytics.actor_id(user:),
        properties: {}
    end
  end

  # Issues a digest-only grant once; concurrent polls cannot consume it twice.
  def self.consume(device_code)
    return [ "expired", nil ] if !device_code.is_a?(String) ||
      !device_code.match?(/\A[A-Za-z0-9_-]{43}\z/)

    pairing = find_by(device_code_digest: Digest::SHA256.hexdigest(device_code))
    return [ "expired", nil ] if pairing.nil?
    generation = SessionRevocation.current.generation
    configuration = GithubAppConfiguration.current
    snapshot = configuration&.credential_snapshot || { configuration_id: nil, credential_revision: nil }
    if pairing.approved_at && !pairing.repository.authorization.authorized?(
      pairing.user, fresh: true, configuration:
    )
      SecurityAuditEvent.record! \
        action: "canvas_pairing.consume", outcome: "denied", repository: pairing.repository,
        actor: pairing.user,
        context: (Current.security_audit_context || {}).merge(canvas_pairing_id: pairing.id)
      return [ "denied", nil ]
    end

    SessionRevocation.with_generation!(generation) do
      if LocalDevelopment.enabled?
        issue_grant!(pairing)
      else
        GithubAppConfiguration.with_credentials!(**snapshot) { issue_grant!(pairing) }
      end
    end
  end

  # Applies the verified decision only inside the caller's two issuance barriers.
  def self.issue_grant!(pairing)
    pairing.with_lock do
      return [ "expired", nil, pairing ] if pairing.expires_at <= Time.current || pairing.consumed_at
      return [ "pending", nil ] if pairing.approved_at.nil?

      secret = "rp_#{SecureRandom.urlsafe_base64(32)}"
      grant = CanvasGrant.create!(
        user: pairing.user,
        repository: pairing.repository,
        token_digest: Digest::SHA256.hexdigest(secret),
        expires_at: CanvasGrant::TOKEN_LIFETIME.from_now,
        refresh_token_digest: pairing.refresh_token_digest,
        learnings_consented_at: pairing.learnings_consented_at,
        last_active_at: pairing.refresh_token_digest && pairing.approved_at,
        inactive_at: pairing.refresh_token_digest && pairing.approved_at + CanvasGrant::INACTIVITY_LIFETIME
      )
      pairing.update!(consumed_at: Time.current)
      SecurityAuditEvent.record! \
        action: "canvas_pairing.consume", outcome: "succeeded", repository: pairing.repository,
        actor: pairing.user,
        context: (Current.security_audit_context || {}).merge(
          canvas_pairing_id: pairing.id, canvas_grant_id: grant.id
        )
      [ "approved", { grant:, secret: } ]
    end
  end
  private_class_method :issue_grant!

  # Discards redeemed proofs and those past their redemption window.
  def self.clear_expired!
    where(expires_at: ..Time.current).or(where.not(consumed_at: nil)).delete_all
  end

  private

  # Records the anonymous initiating device without retaining its proof or short code.
  def audit_creation
    SecurityAuditEvent.record! \
      action: "canvas_pairing.create", outcome: "succeeded", repository:, actor: nil,
      context: (Current.security_audit_context || {}).merge(canvas_pairing_id: id)
  end
end
