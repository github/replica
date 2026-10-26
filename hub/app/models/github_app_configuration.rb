# == Schema Information
#
# Table name: github_app_configurations
# Database name: primary
#
#  id                             :integer          not null, primary key
#  app_slug                       :string           not null
#  client_secret                  :text             not null
#  credential_revision            :bigint           default(1), not null
#  installation_account_login     :string
#  installation_account_type      :string
#  installation_checked_at        :datetime
#  installation_policy            :string           default("owner"), not null
#  installation_state             :string           default("not_installed"), not null
#  installed_at                   :datetime
#  lock_version                   :integer          default(0), not null
#  owner_login                    :string           not null
#  owner_type                     :string           not null
#  previous_webhook_secret        :text
#  private_key                    :text             not null
#  singleton_key                  :integer          default(1), not null
#  suspended_at                   :datetime
#  webhook_request_expires_at     :datetime
#  webhook_request_token          :string
#  webhook_rotation_state         :string           default("idle"), not null
#  webhook_secret                 :text             not null
#  webhook_secret_rotated_at      :datetime
#  created_at                     :datetime         not null
#  updated_at                     :datetime         not null
#  client_id                      :string           not null
#  github_app_id                  :bigint           not null
#  installation_account_github_id :bigint
#  installation_id                :bigint
#  owner_github_id                :bigint           not null
#
# Indexes
#
#  index_github_app_configurations_on_singleton_key  (singleton_key) UNIQUE
#
# Check Constraints
#
#  github_app_configurations_installation_account      ((installation_id IS NULL AND installation_account_github_id IS NULL) OR (installation_id IS NOT NULL AND installation_account_github_id IS NOT NULL AND installation_account_github_id > 0))
#  github_app_configurations_installation_identity     ((installation_state = 'not_installed' AND installation_id IS NULL) OR (installation_state <> 'not_installed' AND installation_id IS NOT NULL))
#  github_app_configurations_installation_policy       (installation_policy IN ('owner', 'pinned'))
#  github_app_configurations_installation_state        (installation_state IN ('not_installed', 'active', 'suspended', 'removed'))
#  github_app_configurations_owner_type                (owner_type IN ('Organization', 'User'))
#  github_app_configurations_pinned_installation       (installation_policy <> 'pinned' OR (installation_id IS NOT NULL AND installation_account_github_id IS NOT NULL AND installation_account_type IN ('Organization', 'User') AND installation_account_type IS NOT NULL AND installation_account_login IS NOT NULL AND length(trim(installation_account_login)) > 0))
#  github_app_configurations_positive_app_id           (github_app_id > 0)
#  github_app_configurations_positive_installation_id  (installation_id IS NULL OR installation_id > 0)
#  github_app_configurations_positive_owner_id         (owner_github_id > 0)
#  github_app_configurations_revision                  (credential_revision > 0 AND lock_version >= 0)
#  github_app_configurations_singleton                 (singleton_key = 1)
#  github_app_configurations_webhook_request           ((webhook_request_token IS NULL AND webhook_request_expires_at IS NULL) OR (webhook_rotation_state = 'pending' AND webhook_request_token IS NOT NULL AND webhook_request_expires_at IS NOT NULL))
#  github_app_configurations_webhook_rotation          ((webhook_rotation_state = 'idle' AND previous_webhook_secret IS NULL) OR (webhook_rotation_state IN ('pending', 'confirmed') AND previous_webhook_secret IS NOT NULL))
#
class GithubAppConfiguration < ApplicationRecord
  class Superseded < StandardError; end

  INSTALLATION_STATES = %w[not_installed active suspended removed].freeze
  INSTALLATION_POLICIES = %w[owner pinned].freeze
  OWNER_TYPES = %w[Organization User].freeze

  encrypts :client_secret
  encrypts :private_key
  encrypts :previous_webhook_secret
  encrypts :webhook_secret

  validates \
    :app_slug, :client_id, :client_secret, :owner_login, :private_key,
    :webhook_secret, presence: true
  validates :github_app_id, :owner_github_id, numericality: { only_integer: true, greater_than: 0 }
  validates :installation_id, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :installation_account_github_id, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :installation_state, inclusion: { in: INSTALLATION_STATES }
  validates :installation_policy, inclusion: { in: INSTALLATION_POLICIES }
  validates :installation_account_type, inclusion: { in: OWNER_TYPES }, allow_nil: true
  validates :owner_type, inclusion: { in: OWNER_TYPES }
  validates :singleton_key, inclusion: { in: [ 1 ] }, uniqueness: true
  validate :installation_identity_matches_state
  validate :pinned_installation_identity

  has_object :administration
  has_object :build_discovery
  has_object :diagnostics
  has_object :installation
  has_object :oauth
  has_object :ownership
  has_object :repositories
  has_object :recovery
  has_object :rotator
  has_object :tokens
  after_create :audit_setup

  performs :synchronize_repositories!, queue_as: :default do
    discard_on ActiveJob::DeserializationError, Superseded, ActiveRecord::StaleObjectError
  end
  performs :discover_builds!, queue_as: :default do
    discard_on ActiveJob::DeserializationError, Superseded, ActiveRecord::StaleObjectError
  end

  class << self
    # Reports whether Hub has saved a GitHub App configuration.
    def configured?
      return false if LocalDevelopment.enabled?

      exists?(singleton_key: 1)
    end

    # Returns the single GitHub App configuration for this Hub.
    def current
      return if LocalDevelopment.enabled?

      find_by(singleton_key: 1)
    end

    # Saves the credentials returned when GitHub creates the App.
    def install!(credentials)
      raise LocalDevelopment::Error, "GitHub App setup is disabled in local mode" if LocalDevelopment.enabled?

      create!(credentials.merge(singleton_key: 1))
    end

    # Rechecks the App revision uncached before local authorization writes.
    def with_credentials!(configuration_id:, credential_revision:)
      transaction do
        valid = !LocalDevelopment.enabled? && configuration_id.is_a?(Integer) &&
          credential_revision.is_a?(Integer) &&
          uncached { exists?(id: configuration_id, credential_revision:) }
        raise Superseded, "GitHub App credentials changed; start again" if !valid

        yield
      end
    end
  end

  # Carries only nonsecret configuration identity across GitHub network work.
  def credential_snapshot
    { configuration_id: id, credential_revision: }
  end

  # Binds GitHub results to the owner and installation that requested them.
  def installation_snapshot
    credential_snapshot.merge \
      github_app_id:, owner_github_id:, owner_type:, installation_policy:, installation_id:,
      installation_account_github_id:, installation_account_type:, installation_state:
  end

  # Pinned connections never discover or adopt another account's installation.
  def pinned_installation?
    installation_policy == "pinned"
  end

  # Filters installation metadata before receipts, quotas, or recovery work are recorded.
  def accepts_installation?(candidate_id)
    !pinned_installation? || (candidate_id.is_a?(Integer) && candidate_id == installation_id)
  end

  # Refreshes the installation and its repositories from GitHub.
  def synchronize_repositories!
    return if LocalDevelopment.enabled?

    ownership.refresh!
    installation.synchronize!
  end

  # Rejects old installation results in the transaction that would persist them.
  def with_installation!(snapshot: installation_snapshot)
    credentials = snapshot.slice(:configuration_id, :credential_revision)
    identity = snapshot.except(:configuration_id, :credential_revision)
    self.class.with_credentials!(**credentials) do
      valid = self.class.uncached { self.class.where(id: snapshot.fetch(:configuration_id), **identity).exists? }
      raise Superseded, "GitHub App installation changed; start again" if !valid

      yield
    end
  end

  # Polls GitHub for current prototype branch heads.
  def discover_builds!(repository = nil)
    return if LocalDevelopment.enabled?

    build_discovery.poll!(repository)
  end

  # Returns the shared transport for GitHub HTTP requests.
  def github_client
    @github_client ||= GithubClient.new
  end

  private

  # Records persisted setup without retaining the credentials GitHub returned.
  def audit_setup
    context = (Current.security_audit_context || {}).merge(github_app_configuration_id: id)
    context[:source] = "bootstrap" if pinned_installation?
    SecurityAuditEvent.record! \
      action: pinned_installation? ? "github_app_setup.import" : "github_app_setup.exchange", outcome: "succeeded",
      context:
  end

  # Keeps the installation ID consistent with the installation status.
  def installation_identity_matches_state
    valid = installation_state == "not_installed" ? installation_id.nil? : installation_id.present?
    errors.add(:installation_id, "does not match installation state") if !valid
    valid_account = installation_id.nil? ? installation_account_github_id.nil? : installation_account_github_id.present?
    errors.add(:installation_account_github_id, "does not match installation") if !valid_account
  end

  # The imported connection retains its immutable identity even after removal.
  def pinned_installation_identity
    return if !pinned_installation? && installation_policy_in_database != "pinned"

    if installation_id.blank? || installation_account_github_id.blank? ||
        installation_account_login.blank? || !OWNER_TYPES.include?(installation_account_type)
      errors.add(:installation_id, "requires a verified installation account")
    end
    if persisted? && %w[
      installation_policy github_app_id client_id installation_id
      installation_account_github_id installation_account_type
    ].any? { will_save_change_to_attribute?(_1) }
      errors.add(:installation_id, "cannot replace a pinned connection")
    end
  end
end
