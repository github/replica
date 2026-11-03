# == Schema Information
#
# Table name: fresh_authorizations
# Database name: primary
#
#  id                 :integer          not null, primary key
#  consumed_at        :datetime
#  continued_at       :datetime
#  credential_type    :string           not null
#  expires_at         :datetime         not null
#  oauth_state_digest :string
#  pending_action     :text
#  purpose            :string           not null
#  return_to          :string           not null
#  verified_at        :datetime
#  created_at         :datetime         not null
#  updated_at         :datetime         not null
#  credential_id      :bigint           not null
#  github_id          :bigint           not null
#  public_id          :string           not null
#  repository_id      :integer
#  user_id            :integer          not null
#
# Indexes
#
#  idx_on_credential_type_credential_id_835b090260  (credential_type,credential_id)
#  index_fresh_authorizations_on_expires_at         (expires_at)
#  index_fresh_authorizations_on_public_id          (public_id) UNIQUE
#  index_fresh_authorizations_on_repository_id      (repository_id)
#  index_fresh_authorizations_on_user_id            (user_id)
#
# Foreign Keys
#
#  repository_id  (repository_id => repositories.id) ON DELETE => nullify
#  user_id        (user_id => users.id) ON DELETE => cascade
#
# Check Constraints
#
#  fresh_authorizations_continuation  (continued_at IS NULL OR (verified_at IS NOT NULL AND pending_action IS NULL))
#  fresh_authorizations_identity      (credential_type IN ('Session', 'CanvasGrant') AND credential_id > 0 AND github_id > 0)
#  fresh_authorizations_purpose       (purpose IN ('never_expiring_share', 'analytics_destination', 'hub_admin_management', 'sharing_settings', 'session_revocation', 'github_app_reset', 'github_app_credentials', 'github_app_webhook', 'github_app_finish_webhook', 'copilot_connection', 'copilot_disconnection'))
#  fresh_authorizations_verification  (verified_at IS NULL OR consumed_at IS NOT NULL)
#
# Renews only the credential that requested a one-use GitHub identity check.
class FreshAuthorization < ApplicationRecord
  FRESHNESS = 5.minutes
  LIFETIME = 15.minutes
  PURPOSES = %w[
    never_expiring_share analytics_destination hub_admin_management sharing_settings
    session_revocation github_app_reset github_app_credentials github_app_webhook
    github_app_finish_webhook copilot_connection copilot_disconnection
  ].freeze
  ADMIN_PURPOSES = %w[
    hub_admin_management sharing_settings session_revocation github_app_reset github_app_credentials github_app_webhook
    github_app_finish_webhook copilot_connection copilot_disconnection
  ].freeze

  class Invalid < StandardError; end

  belongs_to :user
  belongs_to :repository, optional: true
  has_object :continuation
  encrypts :pending_action
  serialize :pending_action, coder: JSON
  attr_readonly :public_id, :user_id, :github_id, :credential_type, :credential_id,
    :purpose, :return_to, :expires_at, :repository_id
  validates :public_id, :github_id, :credential_id, :expires_at, presence: true
  validates :credential_type, inclusion: { in: %w[Session CanvasGrant] }
  validates :purpose, inclusion: { in: PURPOSES }
  validates :return_to, format: { with: %r{\A/(?!/)[^\x00-\x20\\]*\z} }

  # Reads Hub's timestamp from a live credential, never a caller or user-wide field.
  def self.fresh?(credential)
    live = live_credential(credential)
    return false if live.nil? || live.user.local?

    now = Time.current
    timestamp = live.fresh_authorized_at
    timestamp.present? && timestamp <= now && timestamp > now - FRESHNESS
  end

  # Requires an existing Session or active access grant before creating a challenge.
  def self.start!(credential:, purpose:, return_to: "/", pending_action: nil)
    transaction do
      live = live_credential(credential)
      raise Invalid, "The initiating credential is no longer active." if live.nil? || live.user.local?
      if ADMIN_PURPOSES.include?(purpose.to_s) && (!live.is_a?(Session) || !live.user.hub_admin?)
        raise Invalid, "Hub administrator authorization is required."
      end

      challenge = create! \
        public_id: SecureRandom.uuid, user: live.user, github_id: live.user.github_id,
        repository: live.is_a?(CanvasGrant) ? live.repository : nil,
        credential_type: live.class.name, credential_id: live.id, purpose:, return_to:,
        expires_at: LIFETIME.from_now, pending_action: pending_action
      challenge.audit!("succeeded", action: "fresh_authorization.request")
      challenge
    end
  end

  # Rechecks the persisted scope so deleted sessions and revoked grants cannot revive.
  def self.live_credential(credential)
    case credential
    when Session
      Session.includes(:user).find_by(id: credential.id)
    when CanvasGrant
      CanvasGrant.authenticated.includes(:user).find_by(id: credential.id)
    end
  end

  # Resolves only the credential kind Hub saved when it created this challenge.
  def credential
    scope = credential_type == "Session" ? Session : CanvasGrant.authenticated
    scope.includes(:user).find_by(id: credential_id, user_id:)
  end

  # Browser challenges stay in their initiating Session; canvas uses GitHub identity.
  def available_to?(browser_session)
    consumed_at.nil? && expires_at > Time.current && credential.present? && authorized_scope? &&
      (credential_type == "CanvasGrant" || browser_session&.id == credential_id)
  end

  # Binds the challenge to the existing registered callback's state and PKCE flow.
  def bind_oauth!(state, browser_session:)
    with_lock do
      raise Invalid, "This authorization request is no longer available." if !available_to?(browser_session) ||
        oauth_state_digest.present?

      update!(oauth_state_digest: Digest::SHA256.hexdigest(state))
    end
  end

  # Claims the callback before network work; concurrent callbacks cannot both succeed.
  def claim!(state:, browser_session:)
    with_lock do
      matches = oauth_state_digest.present? && ActiveSupport::SecurityUtils.secure_compare(
        oauth_state_digest, Digest::SHA256.hexdigest(state.to_s)
      )
      raise Invalid, "This authorization request expired or was already used." if !matches ||
        !available_to?(browser_session)

      update!(consumed_at: Time.current)
    end
  end

  # Changes freshness only after GitHub proves the same identity and the scope is live.
  def verify!(profile)
    with_lock do
      live = credential
      valid_identity = profile.is_a?(Hash) && profile["id"].is_a?(Integer) &&
        profile["id"] == github_id && profile["login"].is_a?(String) && profile["login"].present?
      raise Invalid, "GitHub must verify the same account that requested this action." if !valid_identity ||
        consumed_at.nil? || verified_at || expires_at <= Time.current || live.nil? || !authorized_scope?

      live.with_lock do
        now = Time.current
        raise Invalid, "This authorization request expired." if expires_at <= now

        raise Invalid, "The initiating credential is no longer active." if
          self.class.live_credential(live).nil? || live.user.github_id != github_id

        live.update!(fresh_authorized_at: now)
        update!(verified_at: now)
        audit!("succeeded")
      end
    end
  end

  # Ends a cancelled request without renewing any credential.
  def cancel!(browser_session:)
    with_lock do
      raise Invalid, "This authorization request is no longer available." if
        !available_to?(browser_session) && !continuation.available_to?(browser_session)

      update!(consumed_at: consumed_at || Time.current, pending_action: nil)
      audit!("denied")
    end
  end

  # Keeps callback events attributed to the initiating credential, not another browser.
  def audit!(outcome, action: "fresh_authorization.verify")
    context = (Current.security_audit_context || {}).except(:session_id, :canvas_grant_id)
    canvas = credential_type == "CanvasGrant"
    context = context.merge(source: canvas ? "canvas" : "browser")
    context[canvas ? :canvas_grant_id : :session_id] = credential_id
    Current.set(session: nil, canvas_grant: nil) do
      SecurityAuditEvent.record! \
        action:, outcome:, actor: user,
        repository:, context:
    end
  end

  # Removes short-lived challenges separately from retained audit records.
  def self.clear_expired!
    where(expires_at: ..Time.current).delete_all
  end

  private

  # Role loss during an OAuth request cannot renew an administrator's proof.
  def authorized_scope?
    return true if !ADMIN_PURPOSES.include?(purpose)

    credential_type == "Session" && User.where(id: user_id, hub_admin: true)
      .where.not(github_id: nil).exists?
  end
end
