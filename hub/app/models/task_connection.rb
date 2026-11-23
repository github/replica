# == Schema Information
#
# Table name: task_connections
# Database name: primary
#
#  id                  :integer          not null, primary key
#  approval_expires_at :datetime         not null
#  approved_at         :datetime
#  branch_name         :string           not null
#  consumed_at         :datetime
#  device_code_digest  :string
#  expires_at          :datetime
#  revoked_at          :datetime
#  token_digest        :string
#  user_code           :string           not null
#  created_at          :datetime         not null
#  updated_at          :datetime         not null
#  approving_user_id   :integer
#  repository_id       :integer          not null
#
# Indexes
#
#  index_task_connections_on_approving_user_id   (approving_user_id)
#  index_task_connections_on_device_code_digest  (device_code_digest) UNIQUE
#  index_task_connections_on_repository_id       (repository_id)
#  index_task_connections_on_token_digest        (token_digest) UNIQUE
#  index_task_connections_on_user_code           (user_code) UNIQUE
#  task_connections_registration_identity        (id,repository_id,branch_name) UNIQUE
#
# Foreign Keys
#
#  approving_user_id  (approving_user_id => users.id) ON DELETE => restrict
#  repository_id      (repository_id => repositories.id) ON DELETE => restrict
#
# Check Constraints
#
#  task_connections_approval     ((approved_at IS NULL AND approving_user_id IS NULL AND expires_at IS NULL) OR (approved_at IS NOT NULL AND approving_user_id IS NOT NULL AND expires_at IS NOT NULL AND julianday(expires_at) = julianday(approved_at) + 1))
#  task_connections_branch       (length(trim(branch_name)) BETWEEN 1 AND 255)
#  task_connections_consumption  ((consumed_at IS NULL AND token_digest IS NULL) OR (approved_at IS NOT NULL AND consumed_at IS NOT NULL AND token_digest IS NOT NULL AND device_code_digest IS NULL))
#
# Keeps branch-scoped task consent and workload attribution after credentials expire.
class TaskConnection < ApplicationRecord
  APPROVAL_LIFETIME = 10.minutes
  LIFETIME = 24.hours
  DEVICE_PATTERN = /\A[A-Za-z0-9_-]{43}\z/
  TOKEN_PATTERN = /\Art_[A-Za-z0-9_-]{43}\z/

  class Unauthorized < StandardError; end
  class Forbidden < StandardError; end

  belongs_to :repository
  belongs_to :approving_user, class_name: "User", optional: true

  attr_readonly :repository_id, :branch_name, :user_code, :approval_expires_at
  validates :branch_name, presence: true, length: { maximum: 255 }
  validates :user_code, :approval_expires_at, presence: true
  validate :approval_is_unchanged, on: :update

  scope :live, -> { where(revoked_at: nil).where.not(consumed_at: nil).where("expires_at > ?", Time.current) }
  scope :displayable, -> {
    where(revoked_at: nil).where.not(approved_at: nil).where("expires_at > ?", Time.current)
      .where("consumed_at IS NOT NULL OR approval_expires_at > ?", Time.current)
  }

  # Creates distinct public comparison and private redemption proofs.
  def self.start!(repository, branch_name:)
    raise Forbidden if repository.local? || repository.installation_state != "active" ||
      !branch_name.is_a?(String) || !repository.prototype_branch?(branch_name)

    generation = SessionRevocation.current.generation
    device_code = SecureRandom.urlsafe_base64(32)
    connection = SessionRevocation.with_generation!(generation) do
      request = create! \
        repository:, branch_name:,
        device_code_digest: Digest::SHA256.hexdigest(device_code),
        user_code: SecureRandom.hex(5).upcase,
        approval_expires_at: APPROVAL_LIFETIME.from_now
      request.audit!("request", actor: nil)
      request
    end
    [ connection, device_code ]
  end

  # Returns a credential only while its fixed, persisted grant is live.
  def self.authenticate(secret)
    return if !secret.is_a?(String) || !secret.match?(TOKEN_PATTERN)

    live.find_by(token_digest: Digest::SHA256.hexdigest(secret))
  end

  # Consumes approval once; a lost response requires explicit revocation and approval again.
  def self.consume(device_code)
    return [ "expired", nil ] if !device_code.is_a?(String) || !device_code.match?(DEVICE_PATTERN)

    connection = find_by(device_code_digest: Digest::SHA256.hexdigest(device_code))
    return [ "expired", nil ] if connection.nil?
    return [ "pending", nil ] if connection.pending?
    return [ "expired", nil ] if connection.approved_at.nil?

    credentials = connection.with_publication_authorization!(consumed: false) do |live_connection|
      raise Unauthorized if live_connection.consumed_at || live_connection.approval_expires_at <= Time.current

      secret = "rt_#{SecureRandom.urlsafe_base64(32)}"
      live_connection.update! \
        token_digest: Digest::SHA256.hexdigest(secret),
        device_code_digest: nil,
        consumed_at: Time.current
      live_connection.audit!("consume")
      live_connection.credentials.merge(accessToken: secret)
    end
    [ "approved", credentials ]
  rescue Unauthorized, SessionRevocation::Superseded, GithubAppConfiguration::Superseded
    [ "expired", nil ]
  rescue Forbidden
    [ "denied", nil ]
  end

  # A GET or an already approved request cannot authorize another connection.
  def pending?
    approved_at.nil? && revoked_at.nil? && consumed_at.nil? && approval_expires_at > Time.current
  end

  # Binds one current writer's explicit confirmation to the fixed branch and deadline.
  def approve!(user, browser_session:)
    authorize_user!(user) do
      raise Unauthorized if !pending? ||
        !Session.where(id: browser_session&.id, user_id: user.id).exists?

      now = Time.current.change(usec: 0)
      update!(approving_user: user, approved_at: now, expires_at: now + LIFETIME)
      audit!("approve", actor: user)
    end
  end

  # Serializes publication and revocation without holding locks during GitHub requests.
  def with_publication_authorization!(consumed: true, configuration: nil, installation: nil)
    original_user_id = approving_user_id
    raise Unauthorized if approved_at.nil? || approving_user.nil? || (consumed && consumed_at.nil?)

    authorize_user!(approving_user, configuration:, installation:) do
      raise Unauthorized if approving_user_id != original_user_id || approved_at.nil? ||
        revoked_at || expires_at.nil? || expires_at <= Time.current || (consumed && consumed_at.nil?)

      yield self
    end
  end

  # Both owner revocation and task disconnect use the publication lock order.
  def revoke!(actor: nil, pending_only: false)
    repository.with_lock do
      with_lock do
        raise Unauthorized if pending_only && !pending?

        if revoked_at.nil?
          update!(revoked_at: Time.current, device_code_digest: nil)
          audit!("revoke", actor:)
        end
      end
    end
  end

  # Credentials are never included in metadata, URLs or browser page data.
  def credentials
    {
      id:, connectionId: id, repositoryId: repository.route_id,
      repository: repository.name_with_owner, branch: branch_name,
      approvedAt: approved_at&.iso8601, expiresAt: expires_at&.iso8601
    }
  end

  # Retains approved identities for registration history, clearing only expired private proofs.
  def self.clear_expired!
    where(approved_at: nil).where("approval_expires_at <= ?", Time.current).delete_all
    where("approval_expires_at <= ?", Time.current).where.not(device_code_digest: nil)
      .update_all(device_code_digest: nil)
  end

  # The approving person is not implicitly the actor of later task requests.
  def audit!(operation, actor: nil)
    SecurityAuditEvent.record! \
      action: "task_connection.#{operation}", outcome: "succeeded", repository:, actor:,
      context: (Current.security_audit_context || {}).merge(task_connection_id: id)
  end

  private

  # Existing App and deployment barriers invalidate authorization delayed across a cutoff.
  def authorize_user!(user, configuration: nil, installation: nil)
    generation = SessionRevocation.current.generation
    configuration ||= GithubAppConfiguration.current
    raise Forbidden if repository.local? || configuration.nil?

    snapshot = installation || configuration.installation_snapshot
    raise Forbidden if !repository.authorization.authorized?(user, minimum: :write, fresh: true, configuration:)

    SessionRevocation.with_generation!(generation) do
      configuration.with_installation!(snapshot:) do
        repository.with_lock do
          with_lock do
            raise Forbidden if repository.installation_state != "active" ||
              !repository.prototype_branch?(branch_name)

            yield
          end
        end
      end
    end
  end

  # Consent cannot be reassigned, extended or moved to another branch.
  def approval_is_unchanged
    return if approved_at_in_database.nil?

    if will_save_change_to_approving_user_id? || will_save_change_to_approved_at? || will_save_change_to_expires_at?
      errors.add(:base, "Task approval cannot be reassigned or extended.")
    end
  end
end
