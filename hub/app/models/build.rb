# == Schema Information
#
# Table name: builds
# Database name: primary
#
#  id                          :integer          not null, primary key
#  artifact_bytes              :bigint
#  artifact_prefix             :string
#  commit_author_avatar_url    :string(2048)
#  commit_author_checked_at    :datetime
#  commit_author_login         :string
#  commit_author_name          :string
#  commit_author_requested_at  :datetime
#  commit_sha                  :string           not null
#  failure_summary             :string
#  finished_at                 :datetime
#  github_workflow_run_attempt :integer
#  local_package_completed_at  :datetime
#  number                      :integer          not null
#  previous_commit_sha         :string
#  start_page_checked_at       :datetime
#  started_at                  :datetime
#  state                       :string           default("queued"), not null
#  workflow_completed_at       :datetime
#  workflow_created_at         :datetime
#  workflow_url                :string(2048)
#  created_at                  :datetime         not null
#  updated_at                  :datetime         not null
#  commit_author_github_id     :bigint
#  github_artifact_id          :bigint
#  github_workflow_run_id      :bigint
#  prototype_id                :integer          not null
#
# Indexes
#
#  index_builds_on_artifact_prefix              (artifact_prefix) UNIQUE WHERE artifact_prefix IS NOT NULL
#  index_builds_on_github_artifact_id           (github_artifact_id) UNIQUE WHERE github_artifact_id IS NOT NULL
#  index_builds_on_github_workflow_run          (github_workflow_run_id,github_workflow_run_attempt) UNIQUE WHERE github_workflow_run_id IS NOT NULL
#  index_builds_on_id_and_prototype_id          (id,prototype_id) UNIQUE
#  index_builds_on_prototype_and_chronology     (prototype_id, COALESCE(workflow_created_at, created_at) DESC, number DESC)
#  index_builds_on_prototype_id                 (prototype_id)
#  index_builds_on_prototype_id_and_commit_sha  (prototype_id,commit_sha) UNIQUE
#  index_builds_on_prototype_id_and_number      (prototype_id,number) UNIQUE
#
# Foreign Keys
#
#  prototype_id  (prototype_id => prototypes.id)
#
# Check Constraints
#
#  builds_artifact_bytes          (artifact_bytes IS NULL OR artifact_bytes > 0)
#  builds_artifact_prefix         (artifact_prefix IS NULL OR artifact_prefix = 'builds/' || id)
#  builds_commit_author_identity  (CASE WHEN commit_author_name IS NULL THEN commit_author_github_id IS NULL AND commit_author_login IS NULL AND commit_author_avatar_url IS NULL WHEN commit_author_github_id IS NULL THEN commit_author_login IS NULL AND commit_author_avatar_url IS NULL ELSE commit_author_github_id > 0 AND commit_author_login IS NOT NULL AND length(trim(commit_author_login)) BETWEEN 1 AND 255 AND (commit_author_avatar_url IS NULL OR length(CAST(commit_author_avatar_url AS BLOB)) BETWEEN 1 AND 2048) END)
#  builds_commit_author_name      (commit_author_name IS NULL OR length(trim(commit_author_name)) BETWEEN 1 AND 255)
#  builds_commit_sha              (length(commit_sha) = 40 AND commit_sha NOT GLOB '*[^0-9a-f]*')
#  builds_distinct_commit_shas    (previous_commit_sha IS NULL OR previous_commit_sha <> commit_sha)
#  builds_failure_summary         (failure_summary IS NULL OR (state = 'failed' AND length(CAST(failure_summary AS BLOB)) BETWEEN 1 AND 1000))
#  builds_github_artifact         (github_artifact_id IS NULL OR (github_artifact_id > 0 AND workflow_completed_at IS NOT NULL))
#  builds_positive_number         (number > 0)
#  builds_previous_commit_sha     (previous_commit_sha IS NULL OR (length(previous_commit_sha) = 40 AND previous_commit_sha NOT GLOB '*[^0-9a-f]*'))
#  builds_publication             ((state = 'successful' AND artifact_prefix IS NOT NULL AND artifact_bytes IS NOT NULL AND failure_summary IS NULL AND ((workflow_completed_at IS NOT NULL AND github_artifact_id IS NOT NULL AND local_package_completed_at IS NULL) OR (workflow_completed_at IS NULL AND github_artifact_id IS NULL AND local_package_completed_at IS NOT NULL))) OR (state <> 'successful' AND artifact_prefix IS NULL AND artifact_bytes IS NULL AND local_package_completed_at IS NULL))
#  builds_state                   (state IN ('queued', 'running', 'failed', 'superseded', 'successful'))
#  builds_state_timestamps        ((state = 'queued' AND started_at IS NULL AND finished_at IS NULL) OR (state = 'running' AND started_at IS NOT NULL AND finished_at IS NULL) OR (state = 'superseded' AND started_at IS NULL AND finished_at IS NOT NULL) OR (state IN ('failed', 'successful') AND started_at IS NOT NULL AND finished_at IS NOT NULL))
#  builds_workflow_completion     (workflow_completed_at IS NULL OR (github_workflow_run_id IS NOT NULL AND state IN ('running', 'failed', 'successful')))
#  builds_workflow_creation       (workflow_created_at IS NULL OR github_workflow_run_id IS NOT NULL)
#  builds_workflow_identity       (CASE WHEN github_workflow_run_id IS NULL THEN github_workflow_run_attempt IS NULL AND workflow_url IS NULL ELSE github_workflow_run_id > 0 AND github_workflow_run_attempt > 0 AND COALESCE(length(trim(workflow_url)) BETWEEN 1 AND 2048, 0) END)
#
class Build < ApplicationRecord
  STATES = %w[queued running failed superseded successful].freeze
  COMMIT_SHA_FORMAT = /\A[0-9a-f]{40}\z/
  scope :chronological, -> do
    order(Arel.sql("COALESCE(workflow_created_at, created_at) DESC"), number: :desc)
  end
  scope :awaiting_import, -> do
    where(state: "running").where.not(workflow_completed_at: nil)
  end
  belongs_to :prototype
  after_update :record_analytics_publication, if: -> { saved_change_to_state? && state == "successful" }
  has_many :webhook_deliveries, dependent: :nullify
  has_many :review_comments, dependent: :restrict_with_exception
  has_many :improvement_comments, dependent: :restrict_with_exception
  has_many :share_links, dependent: :restrict_with_exception

  has_object :package_import
  has_object :local_package
  has_object :commit_author
  has_object :start_page_import
  has_object :workflow_run
  has_object :templates

  performs :import_package!, queue_as: :builds do
    self.enqueue_after_transaction_commit = true
    limits_concurrency key: ->(build) { build }, duration: 24.hours
    retry_on GithubClient::Error,
      wait: :polynomially_longer, attempts: 5
    retry_on ArtifactStore::TemporaryError, IOError, SystemCallError,
      wait: :polynomially_longer, attempts: 5
  end
  performs :record_commit_author!, queue_as: :default do
    self.enqueue_after_transaction_commit = true
    limits_concurrency key: ->(build) { build }, duration: 5.minutes
    retry_on GithubClient::Error,
      wait: :polynomially_longer, attempts: 5
  end
  performs :import_start_page!, queue_as: :default do
    self.enqueue_after_transaction_commit = true
    limits_concurrency key: ->(build) { build }, duration: 5.minutes
    retry_on GithubClient::Error, LocalDevelopment::Error,
      wait: :polynomially_longer, attempts: 5
  end
  performs :build_local_package!, queue_as: :builds do
    self.enqueue_after_transaction_commit = true
    limits_concurrency key: ->(build) { build }, duration: 24.hours
  end

  validates :number, numericality: { only_integer: true, greater_than: 0 },
    uniqueness: { scope: :prototype_id }
  validates :commit_sha, format: { with: COMMIT_SHA_FORMAT },
    uniqueness: { scope: :prototype_id }
  validates :commit_author_name, length: { in: 1..255 }, allow_nil: true
  validates :commit_author_github_id,
    numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :commit_author_login, length: { in: 1..255 }, allow_nil: true
  validates :commit_author_avatar_url, length: { maximum: 2048 }, allow_nil: true
  validates :previous_commit_sha, format: { with: COMMIT_SHA_FORMAT }, allow_nil: true
  validates :github_workflow_run_id, :github_workflow_run_attempt,
    numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :workflow_url, length: { in: 1..2048 }, allow_nil: true
  validates :failure_summary, length: { in: 1..1000 }, allow_nil: true
  validates :github_artifact_id, numericality: { only_integer: true, greater_than: 0 },
    uniqueness: true, allow_nil: true
  validates :artifact_prefix, format: { with: /\Abuilds\/\d+\z/ }, uniqueness: true, allow_nil: true
  validates :artifact_bytes, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :state, inclusion: { in: STATES }
  validate :identity_is_unchanged, on: :update
  validate :workflow_identity_is_unchanged, on: :update
  validate :import_identity_is_unchanged, on: :update
  validate :successful_publication_is_unchanged, on: :update
  validate :previous_commit_sha_cannot_be_replaced, on: :update
  validate :commit_shas_are_distinct
  validate :commit_author_identity_is_complete
  validate :commit_author_is_unchanged, on: :update
  validate :workflow_identity_is_complete
  validate -> { workflow_run.validate_url }
  validate :workflow_creation_matches_identity
  validate :workflow_completion_matches_identity
  validate :github_artifact_matches_completion
  validate :artifact_prefix_matches_build
  validate :failure_summary_matches_state
  validate :timestamps_match_state
  validate :publication_matches_state

  # Downloads and retains this Build's completed Actions package.
  def import_package!
    package_import.download!
  end

  # Fetches and saves the author of this Build's exact commit from GitHub.
  def record_commit_author!
    commit_author.fetch!
  end

  # Imports the repository's initial route independently of Build publication.
  def import_start_page!
    start_page_import.fetch!
  end

  # Builds an exact local commit with the shared action's package contract.
  def build_local_package!
    local_package.create!
  end

  # Returns GitHub's workflow creation time or the time Hub first found the Build.
  def chronological_at
    workflow_created_at || created_at
  end

  # Returns the retained screenshot path for one size, template, and color scheme.
  def screenshot_path(size, template_id: "default", theme: nil)
    directory = template_id == "default" ? "screenshots" : "screenshots/templates/#{template_id}"
    path = "#{artifact_prefix}/#{directory}/#{size}"
    theme == "dark" ? "#{path}-dark.png" : "#{path}.png"
  end

  # Returns Builds before one captured chronological cursor.
  def self.chronologically_before(time:, number:)
    where(
      "COALESCE(workflow_created_at, created_at) < :time OR " \
        "(COALESCE(workflow_created_at, created_at) = :time AND number < :number)",
      time:,
      number:
    )
  end

  # Returns the chronologically latest Build from each Prototype in this relation.
  def self.latest_by_prototype
    ranked = select(
      "builds.*, ROW_NUMBER() OVER (" \
        "PARTITION BY prototype_id " \
        "ORDER BY COALESCE(workflow_created_at, created_at) DESC, number DESC" \
        ") AS chronological_position"
    )
    from(ranked, :builds).where(chronological_position: 1)
  end

  private

  # Records publication only after the Build's files have been retained.
  def record_analytics_publication
    prototype.record_publication!(self)
  end

  # Keeps an exact build attached to its original branch commit and number.
  def identity_is_unchanged
    %i[prototype_id number commit_sha].each do |attribute|
      errors.add(attribute, "cannot change") if public_send("will_save_change_to_#{attribute}?")
    end
  end

  # Allows missing commit author details to be filled once but never replaced.
  def commit_author_is_unchanged
    %i[
      commit_author_name commit_author_github_id commit_author_login commit_author_avatar_url
      commit_author_checked_at commit_author_requested_at
    ].each do |attribute|
      changed = public_send("will_save_change_to_#{attribute}?")
      errors.add(attribute, "cannot change") if changed && attribute_in_database(attribute).present?
    end
  end

  # Requires a complete GitHub account identity when an account is present.
  def commit_author_identity_is_complete
    account = [ commit_author_github_id, commit_author_login ]
    author_missing = commit_author_name.nil? && account.all?(&:nil?) && commit_author_avatar_url.nil?
    name_only = commit_author_name.present? && account.all?(&:nil?) && commit_author_avatar_url.nil?
    return if author_missing || name_only

    errors.add(:base, "commit author identity is incomplete") if commit_author_name.blank? || account.any?(&:blank?)
  end

  # Keeps the first authenticated workflow run attached to this Build.
  def workflow_identity_is_unchanged
    %i[
      github_workflow_run_id github_workflow_run_attempt workflow_url workflow_created_at
    ].each do |attribute|
      errors.add(attribute, "cannot change") if public_send("will_save_change_to_#{attribute}?") && attribute_in_database(attribute).present?
    end
  end

  # Keeps workflow completion and its selected GitHub artifact write-once.
  def import_identity_is_unchanged
    %i[workflow_completed_at github_artifact_id].each do |attribute|
      changed = public_send("will_save_change_to_#{attribute}?")
      errors.add(attribute, "cannot change") if changed && attribute_in_database(attribute).present?
    end
  end

  # Keeps retained files and their byte count unchanged after publication.
  def successful_publication_is_unchanged
    return if state_in_database != "successful"

    %i[artifact_prefix artifact_bytes local_package_completed_at].each do |attribute|
      errors.add(attribute, "cannot change") if public_send("will_save_change_to_#{attribute}?")
    end
  end

  # Allows the previous commit SHA to be added once but never replaced.
  def previous_commit_sha_cannot_be_replaced
    return if !will_save_change_to_previous_commit_sha?

    previous, = previous_commit_sha_change
    errors.add(:previous_commit_sha, "cannot change") if previous.present?
  end

  # Prevents a ref update from naming the same commit as both ends.
  def commit_shas_are_distinct
    return if previous_commit_sha.nil? || previous_commit_sha != commit_sha

    errors.add(:previous_commit_sha, "must differ from commit SHA")
  end

  # Requires the workflow run ID, attempt, and browser URL together.
  def workflow_identity_is_complete
    values = [ github_workflow_run_id, github_workflow_run_attempt, workflow_url ]
    return if values.all?(&:nil?)

    errors.add(:base, "workflow identity is incomplete") if values.any?(&:blank?)
  end

  # Requires a saved workflow identity before retaining GitHub's creation time.
  def workflow_creation_matches_identity
    return if workflow_created_at.nil?

    errors.add(:workflow_created_at, "requires a workflow run") if github_workflow_run_id.nil?
  end

  # Requires a recorded workflow run before recording its successful completion.
  def workflow_completion_matches_identity
    return if workflow_completed_at.nil?

    errors.add(:workflow_completed_at, "requires a workflow run") if github_workflow_run_id.nil?
    errors.add(:workflow_completed_at, "requires a running or completed build") if !%w[running failed successful].include?(state)
  end

  # Requires a completed successful workflow before selecting its artifact.
  def github_artifact_matches_completion
    return if github_artifact_id.nil?

    errors.add(:github_artifact_id, "requires a completed workflow") if workflow_completed_at.nil?
  end

  # Requires retained files to use this Build's canonical storage prefix.
  def artifact_prefix_matches_build
    return if artifact_prefix.nil? || id.nil? || artifact_prefix == "builds/#{id}"

    errors.add(:artifact_prefix, "must match this build")
  end

  # Stores a bounded failure explanation only for failed Builds.
  def failure_summary_matches_state
    return if failure_summary.nil?

    errors.add(:failure_summary, "requires a failed build") if state != "failed"
  end

  # Keeps timestamps consistent with the build state.
  def timestamps_match_state
    valid = case state
    when "queued" then started_at.nil? && finished_at.nil?
    when "running" then started_at.present? && finished_at.nil?
    when "superseded" then started_at.nil? && finished_at.present?
    when "failed", "successful" then started_at.present? && finished_at.present?
    else false
    end
    errors.add(:base, "build timestamps do not match state") if !valid
  end

  # Keeps retained package details exclusive to successful Builds.
  def publication_matches_state
    evidence = [ artifact_prefix, artifact_bytes ]
    valid = if state == "successful"
      source_complete = if prototype&.repository&.local?
        workflow_completed_at.nil? && github_artifact_id.nil? && local_package_completed_at.present?
      else
        workflow_completed_at.present? && github_artifact_id.present? && local_package_completed_at.nil?
      end
      evidence.all?(&:present?) && source_complete && failure_summary.nil?
    else
      evidence.all?(&:nil?) && local_package_completed_at.nil?
    end
    errors.add(:base, "build publication does not match state") if !valid
  end
end
