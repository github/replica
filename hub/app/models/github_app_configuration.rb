# == Schema Information
#
# Table name: github_app_configurations
# Database name: primary
#
#  id                         :integer          not null, primary key
#  app_slug                   :string           not null
#  client_secret              :text             not null
#  credential_revision        :bigint           default(1), not null
#  installation_checked_at    :datetime
#  installation_state         :string           default("not_installed"), not null
#  installed_at               :datetime
#  lock_version               :integer          default(0), not null
#  owner_login                :string           not null
#  owner_type                 :string           not null
#  previous_webhook_secret    :text
#  private_key                :text             not null
#  singleton_key              :integer          default(1), not null
#  suspended_at               :datetime
#  webhook_request_expires_at :datetime
#  webhook_request_token      :string
#  webhook_rotation_state     :string           default("idle"), not null
#  webhook_secret             :text             not null
#  webhook_secret_rotated_at  :datetime
#  created_at                 :datetime         not null
#  updated_at                 :datetime         not null
#  client_id                  :string           not null
#  github_app_id              :bigint           not null
#  installation_id            :bigint
#  owner_github_id            :bigint           not null
#
# Indexes
#
#  index_github_app_configurations_on_singleton_key  (singleton_key) UNIQUE
#
# Check Constraints
#
#  github_app_configurations_installation_identity     ((installation_state = 'not_installed' AND installation_id IS NULL) OR (installation_state <> 'not_installed' AND installation_id IS NOT NULL))
#  github_app_configurations_installation_state        (installation_state IN ('not_installed', 'active', 'suspended', 'removed'))
#  github_app_configurations_owner_type                (owner_type IN ('Organization', 'User'))
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
  validates :installation_state, inclusion: { in: INSTALLATION_STATES }
  validates :owner_type, inclusion: { in: OWNER_TYPES }
  validates :singleton_key, inclusion: { in: [ 1 ] }, uniqueness: true
  validate :installation_identity_matches_state

  has_object :administration
  has_object :build_discovery
  has_object :diagnostics
  has_object :installation
  has_object :oauth
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

    # Rechecks the exact organization installation that a Copilot billing decision used.
    def with_copilot_installation!(snapshot)
      transaction do
        attributes = copilot_installation_attributes(snapshot)
        valid = !LocalDevelopment.enabled? && attributes &&
          uncached { where(attributes).exists? }
        raise Superseded, "GitHub App installation changed; start again" if !valid

        yield
      end
    end

    private

    # Converts one trusted in-process snapshot into the exact active organization installation query.
    def copilot_installation_attributes(snapshot)
      return if !snapshot.is_a?(Hash) || snapshot[:owner_type] != "Organization" ||
        snapshot[:installation_state] != "active"

      attributes = {
        id: snapshot.fetch(:configuration_id),
        credential_revision: snapshot.fetch(:credential_revision),
        lock_version: snapshot.fetch(:lock_version),
        github_app_id: snapshot.fetch(:github_app_id),
        client_id: snapshot.fetch(:client_id),
        installation_id: snapshot.fetch(:installation_id),
        installation_state: snapshot.fetch(:installation_state),
        owner_github_id: snapshot.fetch(:owner_github_id),
        owner_type: snapshot.fetch(:owner_type)
      }
      return if attributes.values.any?(&:nil?)

      attributes
    rescue KeyError
      nil
    end
  end

  # Carries only nonsecret configuration identity across GitHub network work.
  def credential_snapshot
    { configuration_id: id, credential_revision: }
  end

  # Carries the exact nonsecret App and organization installation identity used for Copilot billing.
  def copilot_snapshot
    {
      configuration_id: id,
      credential_revision:,
      lock_version:,
      github_app_id:,
      client_id:,
      installation_id:,
      installation_state:,
      owner_github_id:,
      owner_type:
    }
  end

  # Identifies one exact App credential revision and organization installation without storing a secret.
  def copilot_credential
    JSON.generate(copilot_snapshot.except(:lock_version))
  end

  # Whether the App has an active installation on an organization, the only kind of installation
  # whose own tokens Copilot accepts and bills.
  def organization_installation?
    owner_type == "Organization" && installation_state == "active"
  end

  # Refreshes the installation and its repositories from GitHub.
  def synchronize_repositories!
    return if LocalDevelopment.enabled?

    return repositories.remove_all! if installation_id.nil?

    installation.reconcile!(installation_id)
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
    SecurityAuditEvent.record! \
      action: "github_app_setup.exchange", outcome: "succeeded",
      context: (Current.security_audit_context || {}).merge(github_app_configuration_id: id)
  end

  # Keeps the installation ID consistent with the installation status.
  def installation_identity_matches_state
    valid = installation_state == "not_installed" ? installation_id.nil? : installation_id.present?
    errors.add(:installation_id, "does not match installation state") if !valid
  end
end
