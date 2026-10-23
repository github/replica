# == Schema Information
#
# Table name: repositories
# Database name: primary
#
#  id                 :integer          not null, primary key
#  default_branch     :string           not null
#  installation_state :string           default("active"), not null
#  local_identity     :string
#  local_path         :string
#  name_with_owner    :string           not null
#  removed_at         :datetime
#  synchronized_at    :datetime         not null
#  created_at         :datetime         not null
#  updated_at         :datetime         not null
#  github_id          :bigint
#
# Indexes
#
#  index_active_repositories_on_local_path        (local_path) UNIQUE WHERE installation_state = 'active'
#  index_repositories_on_github_id                (github_id) UNIQUE
#  index_repositories_on_local_path_and_identity  (local_path,local_identity) UNIQUE
#
# Check Constraints
#
#  repositories_default_branch_present  (length(trim(default_branch)) > 0)
#  repositories_installation_state      (installation_state IN ('active', 'removed'))
#  repositories_local_identity          (local_identity IS NULL OR local_path IS NOT NULL)
#  repositories_name_present            (length(trim(name_with_owner)) > 0)
#  repositories_removal_state           ((installation_state = 'active' AND removed_at IS NULL) OR (installation_state = 'removed' AND removed_at IS NOT NULL))
#  repositories_source_identity         ((github_id IS NOT NULL AND github_id > 0 AND local_path IS NULL) OR (github_id IS NULL AND local_path IS NOT NULL AND length(trim(local_path)) > 0))
#
class Repository < ApplicationRecord
  INSTALLATION_STATES = %w[active removed].freeze
  RESERVED_BRANCHES = %w[replica/install-workflow].freeze

  scope :active, -> { where(installation_state: "active") }

  has_many :prototypes
  has_many :share_link_creator_revocations, dependent: :delete_all
  has_many :analytics_events, class_name: "Analytics::Event", dependent: :restrict_with_exception
  has_many :analytics_destinations, class_name: "Analytics::Destination", dependent: :destroy

  validates :github_id, numericality: { only_integer: true, greater_than: 0 },
    uniqueness: true, allow_nil: true
  validates :local_path, uniqueness: { conditions: -> { where(installation_state: "active") } },
    if: -> { installation_state == "active" }, allow_nil: true
  validates :local_identity, uniqueness: { scope: :local_path }, allow_nil: true
  validate :source_identity
  validates :name_with_owner, :default_branch, :synchronized_at, presence: true
  validates :installation_state, inclusion: { in: INSTALLATION_STATES }
  validate :github_id_is_unchanged, on: :update
  validate :local_identity_is_unchanged, on: :update
  validate :removed_at_matches_state
  after_update :retain_replica_build_owners, if: :saved_change_to_default_branch?

  has_object :authorization
  has_object :build_discoveries
  has_object :branch_presence
  has_object :local_discovery
  has_object :prototype_candidates
  has_object :prototype_listing
  has_object :workflow_installation
  has_object :workflow_run_discoveries

  # Returns the repository owner's current login.
  def owner_login
    name_with_owner.split("/", 2).first
  end

  # Uses the database identity for local URLs without inventing a GitHub ID.
  def route_id
    github_id || id
  end

  # Loads only the source type permitted in this runtime.
  def self.find_by_route_id!(value)
    if LocalDevelopment.enabled?
      active.where(github_id: nil).find(value)
    else
      active.find_by!(github_id: value)
    end
  end

  # Reports whether this repository is backed by an on-disk Git checkout.
  def local?
    local_path.present?
  end

  # Reports whether one branch represents a reviewable prototype.
  def prototype_branch?(branch_name)
    branch_name != default_branch && !RESERVED_BRANCHES.include?(branch_name)
  end

  # Discovers Builds for the default branch too, but never installation branches.
  def build_branch?(branch_name)
    !RESERVED_BRANCHES.include?(branch_name)
  end

  # Keeps internal default-branch Build owners out of every prototype entry point.
  def reviewable_prototypes
    prototypes.where(replica: false)
      .where.not(branch_name: [ default_branch, *RESERVED_BRANCHES ])
  end

  # Returns the Build owner for the current default, not an earlier default branch.
  def replica_build_owner
    return unless build_branch?(default_branch)

    prototypes.active.find_by(branch_name: default_branch)
  end

  # Returns the owner and repository name used by GitHub API routes.
  def github_path
    name_with_owner.split("/", 2).map { CGI.escapeURIComponent(_1) }.join("/")
  end

  private

  # A default rename must not expose either branch's retained Builds as a prototype.
  def retain_replica_build_owners
    saved_change_to_default_branch.each do |branch_name|
      next unless build_branch?(branch_name)

      prototypes.where(branch_name:).update_all(replica: true, registered_at: nil)
      prototype = prototypes.active.find_or_create_by!(branch_name:) { |owner| owner.replica = true }
      prototype.with_lock do
        prototype.update!(replica: true, registered_at: nil)
      end
    end
  end

  # Keeps the durable repository identity from changing after a rename.
  def github_id_is_unchanged
    errors.add(:github_id, "cannot change") if will_save_change_to_github_id?
    errors.add(:local_path, "cannot change") if will_save_change_to_local_path?
  end

  # A changed checkout must get a new record, not inherit its predecessor's reviews.
  def local_identity_is_unchanged
    if local_identity_in_database.present? && will_save_change_to_local_identity?
      errors.add(:local_identity, "cannot change")
    end
  end

  # Keeps local paths out of the production source model.
  def source_identity
    if local?
      errors.add(:local_path, "requires local development mode") if !LocalDevelopment.enabled?
      errors.add(:github_id, "must be empty") if github_id.present?
      if local_identity.blank? && (new_record? || will_save_change_to_local_identity?)
        errors.add(:local_identity, "is required")
      end
      if LocalDevelopment.enabled? && (new_record? || will_save_change_to_local_path?) &&
          !LocalDevelopment.repository_available?(local_path)
        errors.add(:local_path, "must name a repository within the configured directory")
      end
    else
      errors.add(:github_id, "is required") if github_id.nil?
      errors.add(:local_identity, "must be empty") if local_identity.present?
    end
  end

  # Keeps removal timestamps consistent with installation status.
  def removed_at_matches_state
    valid = installation_state == "removed" ? removed_at.present? : removed_at.nil?
    errors.add(:removed_at, "does not match installation state") if !valid
  end
end
