# == Schema Information
#
# Table name: copilot_connections
# Database name: primary
#
#  id            :integer          not null, primary key
#  refused_at    :datetime
#  singleton_key :integer          default(1), not null
#  token_digest  :string           not null
#  verified_at   :datetime         not null
#  created_at    :datetime         not null
#  updated_at    :datetime         not null
#  user_id       :integer          not null
#
# Indexes
#
#  index_copilot_connections_on_singleton_key  (singleton_key) UNIQUE
#  index_copilot_connections_on_user_id        (user_id)
#
# Foreign Keys
#
#  user_id  (user_id => users.id) ON DELETE => cascade
#
# Check Constraints
#
#  copilot_connections_singleton     (singleton_key = 1)
#  copilot_connections_token_digest  (length(token_digest) = 64 AND token_digest NOT GLOB '*[^0-9a-f]*')
#
# Records that a Hub administrator connected Copilot, which turns on Learnings for this Hub, and
# what Copilot last said about the credential Hub uses.
#
# Hub keeps no Copilot credential. The operator chooses who Copilot bills with
# REPLICA_COPILOT_BILLING. By default Hub uses REPLICA_COPILOT_TOKEN, a fine-grained personal access
# token whose only permission is Copilot requests, and Copilot counts the usage toward the token
# owner's plan. With organization billing, Hub's GitHub App creates a new one-hour token for each
# Copilot request, which can make only Copilot requests, and Copilot bills the organization that
# installed the App. Hub passes either token only to replica-learning.
#
# The connection keeps the SHA-256 digest of the credential: the operator's token, or for
# organization billing the App installation that creates tokens. A refusal applies only to the
# credential Copilot refused. A replaced token starts fresh, but Hub bills an organization only after
# an administrator connects Copilot for that App installation. The connection ends when an
# administrator disconnects it or when the person who connected it stops being a Hub administrator.
class CopilotConnection < ApplicationRecord
  # The Copilot check that connecting starts usually takes about a second.
  CHECK_TIME = 20.seconds

  # Copilot refused the credential, or Hub has none, so Hub cannot make Copilot requests.
  class Refused < StandardError; end
  # GitHub will not create Copilot tokens for Hub's GitHub App, because the installation has not
  # granted the App's Copilot Requests organization permission.
  class PermissionMissing < Refused; end
  class ChangeDenied < StandardError
    attr_reader :reason

    # Exposes only a fixed policy reason, never a token or Copilot response.
    def initialize(reason)
      @reason = reason
      super(reason.to_s)
    end
  end

  belongs_to :user

  validates :token_digest, :verified_at, presence: true
  validates :singleton_key, inclusion: { in: [ 1 ] }

  class << self
    # The connection Hub uses, when an administrator connected one.
    def current
      find_by(singleton_key: 1)
    end

    # Whether Copilot bills the organization that installed Hub's GitHub App, as the operator chose
    # with REPLICA_COPILOT_BILLING, instead of the owner of the operator's token.
    def organization_billing?
      Rails.configuration.x.copilot_billing == "organization"
    end

    # The Copilot token the operator gave Hub in REPLICA_COPILOT_TOKEN, or nil. Organization billing
    # ignores it.
    def token
      Rails.configuration.x.copilot_token.presence if !organization_billing?
    end

    # The organization Copilot bills, when the operator chose organization billing and Hub's GitHub
    # App has an active installation on an organization, or nil.
    def organization
      configuration = GithubAppConfiguration.current
      configuration.owner_login if organization_billing? && configuration&.organization_installation?
    end

    # What Hub makes Copilot requests with, or nil when it has nothing: the operator's token, or the
    # organization installation of Hub's GitHub App, which creates a token for each request.
    def credential
      return token if !organization_billing?

      configuration = GithubAppConfiguration.current
      configuration.copilot_credential if configuration&.organization_installation?
    end

    # A credential's SHA-256 digest, which tells credentials apart without keeping them.
    def digest(credential)
      Digest::SHA256.hexdigest(credential)
    end

    # Connects Copilot, or checks it again, for a current Hub administrator with fresh GitHub
    # proof, once Copilot answers with the configured credential. Raises Refused when Copilot
    # rejects it, and records the refusal on an existing connection. Connecting again clears an
    # earlier refusal and names the administrator who connected. A disconnect or replacement while
    # Copilot answers cancels this check rather than restoring the earlier enablement.
    def connect!(actor:, browser_session:)
      live_actor, = authorized!(actor:, browser_session:)
      credential = self.credential
      raise ChangeDenied, :no_token if credential.nil?

      earlier, generation = uncached do
        transaction { [ current, CopilotConnectionState.current.generation ] }
      end
      begin
        check!(copilot_token(credential))
      rescue Refused
        earlier&.refuse!(credential:)
        raise
      end
      uncached do
        transaction do
          live_actor, live_session = authorized!(actor: live_actor, browser_session:)
          if current&.id != earlier&.id || CopilotConnectionState.current.generation != generation
            raise ChangeDenied, :connection_changed
          end
          raise ChangeDenied, :connection_changed if self.credential != credential

          where(singleton_key: 1).delete_all
          connection = create! \
            user: live_actor,
            token_digest: digest(credential),
            verified_at: Time.current
          CopilotConnectionState.advance!
          SecurityAuditEvent.record! \
            action: "copilot_connection.connect",
            outcome: "succeeded",
            actor: live_actor,
            context: audit_context(live_session.id)
          connection
        end
      end
    end

    # Disconnects Copilot for a current Hub administrator with fresh GitHub proof. The operator's
    # token, or the App's Copilot permission, stays as it is.
    def disconnect!(actor:, browser_session:)
      uncached do
        transaction do
          live_actor, live_session = authorized!(actor:, browser_session:)
          connection = current
          raise ChangeDenied, :not_connected if connection.nil?

          connection.destroy!
          CopilotConnectionState.advance!
          SecurityAuditEvent.record! \
            action: "copilot_connection.disconnect",
            outcome: "succeeded",
            actor: live_actor,
            context: audit_context(live_session.id)
        end
      end
    end

    # The token for one Copilot request with a credential: the operator's token itself, or a new
    # token from Hub's GitHub App that can only make Copilot requests. Raises PermissionMissing when
    # GitHub will not create one, and Learning::Error when GitHub cannot be reached.
    def copilot_token(credential)
      return credential if !organization_billing?

      configuration = GithubAppConfiguration.current
      if configuration.nil? || configuration.copilot_credential != credential
        raise GithubAppConfiguration::Superseded, "GitHub App installation changed; start again"
      end

      configuration.tokens.copilot(snapshot: configuration.copilot_snapshot)
    rescue GithubAppConfiguration::Tokens::CopilotPermissionMissing
      raise PermissionMissing, "Hub's GitHub App does not have the Copilot Requests organization permission."
    rescue GithubAppConfiguration::Superseded, GithubClient::Error => error
      raise Learning::Error.new("GitHub did not create a Copilot token for Hub's GitHub App: #{error.message}",
        code: "unavailable")
    end

    private

    # Asks Copilot to answer with the token, without labeling anything, or raises Refused.
    def check!(token)
      Learning::Command.new(timeout: CHECK_TIME).call("copilot", "status", copilot_token: token)
    rescue Learning::Error => error
      raise Refused, error.message if error.code == "unauthorized"

      raise
    end

    # The current Hub administrator, and their browser Session with fresh GitHub proof, or an error.
    # Reads bypass the request cache, so another request's committed role or Session change counts.
    def authorized!(actor:, browser_session:)
      uncached do
        live_actor = User.where.not(github_id: nil).find_by(id: actor.id, hub_admin: true)
        raise ChangeDenied, :not_authorized if live_actor.nil?

        live_session = Session.find_by(id: browser_session&.id, user_id: live_actor.id)
        raise ChangeDenied, :not_authorized if live_session.nil?
        raise FreshAuthorization::Invalid if !FreshAuthorization.fresh?(live_session)

        [ live_actor, live_session ]
      end
    end

    # Request context with the browser Session that acted, for the security audit.
    def audit_context(session_id)
      (Current.security_audit_context || {}).merge(session_id:)
    end
  end

  # Whether Hub may make Copilot requests now: it has a credential, an administrator confirmed who
  # Copilot bills, Copilot has not refused that credential, and the person who connected Copilot is
  # still a Hub administrator.
  def usable?
    self.class.credential.present? && confirmed? && !refused? &&
      User.where(id: user_id, hub_admin: true).exists?
  end

  # Whether an administrator confirmed who Copilot bills. The operator may replace a token without a
  # new confirmation, but Hub bills an organization only after an administrator connects Copilot for
  # that App installation, so turning on organization billing never moves an existing connection to
  # the organization's bill.
  def confirmed?
    return true if !self.class.organization_billing?

    credential = self.class.credential
    credential.present? && token_digest == self.class.digest(credential)
  end

  # Whether Copilot refused the credential Hub has now. A refusal of an earlier one does not count.
  def refused?
    credential = self.class.credential
    refused_at.present? && credential.present? && token_digest == self.class.digest(credential)
  end

  # The token for one Copilot request, or Refused when Hub cannot use Copilot. Hub reads the
  # connection again first, so an instance loaded earlier never hands out a token after an
  # administrator disconnects Copilot or Copilot refuses the credential. With organization billing,
  # each call creates a new token.
  def access_token!
    reload
    credential = self.class.credential
    if credential.nil?
      raise Refused, self.class.organization_billing? ?
        "Hub's GitHub App has no active installation on an organization, which organization billing needs." :
        "Hub has no Copilot token. Set REPLICA_COPILOT_TOKEN and restart Hub."
    end
    raise Refused, "Copilot refused this credential on #{refused_at.to_date}." if refused?
    raise Refused, "A Hub administrator must connect Copilot again before Hub bills the organization." if !confirmed?
    raise Refused, "#{user.login} is no longer a Hub administrator." if !usable?

    token = self.class.copilot_token(credential)
    reload
    if self.class.credential != credential || refused? || !confirmed? ||
        !User.where(id: user_id, hub_admin: true).exists?
      raise Refused, "The Copilot connection changed while Hub created a token."
    end

    token
  rescue ActiveRecord::RecordNotFound
    raise Refused, "An administrator disconnected Copilot."
  end

  # Records that Copilot refused a credential, so Hub stops using it until an administrator checks
  # it again or the operator replaces it. Results that this worker can identify as superseded are
  # ignored; token replacement still requires the non-overlapping deployment in docs/copilot.md.
  # Returns whether it recorded a new refusal.
  def refuse!(credential: self.class.credential)
    with_current_credential(credential) do |digest|
      next false if refused_at && token_digest == digest

      update!(refused_at: Time.current, token_digest: digest)
      SecurityAuditEvent.record!(action: "copilot_connection.use", outcome: "failed", actor: nil)
      true
    end
  end

  # Records that Copilot answered with a still-current credential. A request already in flight
  # cannot clear that credential's refusal; only an administrator's explicit recheck can. Nor can it
  # confirm organization billing for a connection made with another credential. Returns whether
  # saved.
  def verified!(credential: self.class.credential)
    with_current_credential(credential) do |digest|
      next false if refused_at && token_digest == digest
      next false if self.class.organization_billing? && token_digest != digest

      update!(verified_at: Time.current, refused_at: nil, token_digest: digest)
      true
    end
  end

  private

  # Serializes a result with disconnect and other results. A replaced credential may replace the
  # state this request read, but cannot overwrite a different credential's intervening result. A
  # digest does not order configurations across processes; rolling token replacement is not
  # supported.
  def with_current_credential(credential)
    return false if credential.blank?

    previous_digest = token_digest_in_database
    transaction do
      reload
      digest = self.class.digest(credential)
      next false if self.class.credential != credential || (token_digest != previous_digest && token_digest != digest)

      yield digest
    end
  rescue ActiveRecord::RecordNotFound
    false
  end
end
