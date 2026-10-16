# == Schema Information
#
# Table name: prototypes
# Database name: primary
#
#  id                        :integer          not null, primary key
#  branch_deleted_at         :datetime
#  branch_name               :string           not null
#  description               :string(500)
#  first_published_at        :datetime
#  head_observation_revision :bigint           default(0), not null
#  local_head_observed_at    :datetime
#  name                      :string
#  registered_at             :datetime
#  replica                   :boolean          default(FALSE), not null
#  retired_head_sha          :string
#  start_page                :string(2048)
#  start_page_import_error   :string
#  start_page_set_at         :datetime
#  created_at                :datetime         not null
#  updated_at                :datetime         not null
#  author_id                 :integer
#  current_build_id          :integer
#  repository_id             :integer          not null
#
# Indexes
#
#  idx_on_repository_id_branch_name_branch_deleted_at_37960952d6  (repository_id,branch_name,branch_deleted_at)
#  index_prototypes_on_active_branch                              (repository_id,branch_name) UNIQUE WHERE branch_deleted_at IS NULL
#  index_prototypes_on_author_id                                  (author_id)
#  index_prototypes_on_current_build_id                           (current_build_id)
#  index_prototypes_on_repository_id                              (repository_id)
#
# Foreign Keys
#
#  [current_build_id, id]  ([current_build_id, id] => builds[id, prototype_id]) ON DELETE => restrict
#  author_id               (author_id => users.id)
#  repository_id           (repository_id => repositories.id)
#
# Check Constraints
#
#  prototypes_branch_name           (length(trim(branch_name)) BETWEEN 1 AND 255)
#  prototypes_description           (description IS NULL OR length(trim(description)) BETWEEN 1 AND 500)
#  prototypes_name                  (name IS NULL OR length(trim(name)) BETWEEN 1 AND 255)
#  prototypes_registration          (registered_at IS NULL OR name IS NOT NULL)
#  prototypes_replica_unregistered  (replica = 0 OR registered_at IS NULL)
#  prototypes_retired_head          (retired_head_sha IS NULL OR (branch_deleted_at IS NOT NULL AND length(retired_head_sha) = 40 AND retired_head_sha NOT GLOB '*[^0-9a-f]*'))
#  prototypes_start_page            (start_page IS NULL OR (length(CAST(start_page AS BLOB)) BETWEEN 1 AND 2048 AND substr(start_page, 1, 1) = '/' AND substr(start_page, 1, 2) != '//'))
#
class Prototype < ApplicationRecord
  DESCRIPTION_MAXIMUM_LENGTH = 500
  START_PAGE_MAXIMUM_BYTES = 2_048
  UNCHANGED_START_PAGE = Object.new.freeze

  scope :registered, -> { where.not(registered_at: nil) }
  scope :unregistered, -> { where(registered_at: nil) }
  scope :active, -> { where(branch_deleted_at: nil) }
  scope :retired, -> { where.not(branch_deleted_at: nil) }

  belongs_to :repository
  belongs_to :author, class_name: "User", optional: true
  belongs_to :current_build, class_name: "Build", optional: true
  has_many :builds
  has_many :branch_banner_dismissals, dependent: :delete_all
  has_many :prototype_introductions, dependent: :delete_all
  has_many :review_comments, -> { where(kind: "review") }, dependent: :restrict_with_exception
  has_many :improvement_notes, -> { where(kind: "improvement_note") },
    class_name: "ReviewComment", dependent: :restrict_with_exception
  has_many :share_links, dependent: :restrict_with_exception

  validates :branch_name, presence: true, length: { maximum: 255 }
  validates :branch_name, uniqueness: { scope: :repository_id, conditions: -> { active } },
    if: -> { branch_deleted_at.nil? }
  validates :retired_head_sha, format: { with: Build::COMMIT_SHA_FORMAT }, allow_nil: true
  validates :name, presence: true, if: :registered?
  validates :name, length: { maximum: 255 }, allow_nil: true
  validates :description, length: { maximum: DESCRIPTION_MAXIMUM_LENGTH }, allow_nil: true
  validate :metadata_is_not_blank
  validate :identity_is_unchanged, on: :update
  before_validation :normalize_start_page
  before_validation :mark_replica_build_owner
  before_validation :record_start_page_setting, if: :will_save_change_to_start_page?
  validate :start_page_is_local
  validate :first_publication_is_unchanged, on: :update
  validates :registered_at, absence: true, if: :replica?

  # Registers a branch, or edits its metadata unless registration-only intent was supplied.
  def register!(name: self.name, description: self.description, start_page: UNCHANGED_START_PAGE, author: nil,
    registration_only: false)
    repository.with_lock do
      lock!
      raise ActiveRecord::RecordNotFound unless reviewable?
      return if registration_only && registered?

      first_registration = !registered?

      unless start_page.equal?(UNCHANGED_START_PAGE)
        assign_attributes(start_page:, start_page_set_at: Time.current, start_page_import_error: nil)
      end

      update! \
        name: name&.strip,
        description: description&.strip.presence,
        author_id: registered_at.nil? && author_id.nil? ? author&.id : author_id,
        registered_at: registered_at || Time.current

      if first_registration
        Analytics::Event.record! \
          repository:,
          name: "prototype_registered",
          source_key: "prototype/#{id}/registered",
          actor_id: Analytics.actor_id(user: author || Current.user),
          occurred_at: registered_at,
          properties: { prototype_id: id }
      end
    end
  end

  # Remembers first publication after the event itself expires.
  def record_publication!(build)
    repository.with_lock do
      lock!
      return unless reviewable?

      first = first_published_at.nil?
      update!(first_published_at: build.finished_at) if first
      Analytics::Event.record! \
        repository:,
        name: first ? "prototype_first_published" : "build_published",
        source_key: "build/#{build.id}/published",
        actor_id: Analytics.actor_id(github_id: build.commit_author_github_id),
        occurred_at: build.finished_at,
        properties: { prototype_id: id, build_id: build.id }
    end
  end

  # Registers an imported checkout without replacing metadata saved by another canvas.
  def register_automatically!(commit_sha:, author:)
    repository.with_lock do
      with_lock do
        return false unless reviewable?
        return false if branch_deleted_at.present?

        return true if registered?
        return false if commit_sha.blank? ||
          builds.where(state: "successful").chronological.first&.commit_sha != commit_sha

        register!(name: name || branch_name, description: description, author: author)
        true
      end
    end
  end

  # Reports whether this branch belongs in the repository gallery.
  def registered?
    registered_at.present?
  end

  # Internal Build owners never become reviewable after a default-branch rename.
  def reviewable?
    !replica? && repository.prototype_branch?(branch_name)
  end

  # Default-branch previews always open at root, even with old prototype metadata.
  def preview_start_page
    reviewable? ? start_page.presence || "/" : "/"
  end

  # Reports whether a current collaborator may manage this Prototype's share links.
  def share_links_manageable_by?(user, repository_permission:)
    return false if !reviewable? || repository.local?

    authorization = repository.authorization
    return false if !authorization.sufficient?(repository_permission, minimum: :read)

    build_author = builds.where \
      state: "successful",
      commit_author_github_id: user.github_id
    build_author.exists? || authorization.sufficient?(repository_permission, minimum: :admin)
  end

  private

  # Existing prototype metadata does not make a new default branch a prototype.
  def mark_replica_build_owner
    self.replica = true if repository && branch_name == repository.default_branch
    self.registered_at = nil if replica?
    if replica_in_database && !replica?
      errors.add(:replica, "cannot change")
    end
  end

  # An explicit clear owns the setting too; imports must not undo it.
  def record_start_page_setting
    self.start_page_set_at ||= Time.current
    self.start_page_import_error = nil
  end

  # Stores routes independently of the Build host used when copying a preview URL.
  def normalize_start_page
    return if start_page.nil?

    value = start_page.strip
    return self.start_page = nil if value.empty?
    return if value.match?(/[[:cntrl:]\\]/)

    uri = URI.parse(value)
    if uri.absolute?
      return if !%w[http https].include?(uri.scheme) || uri.userinfo || !prototype_preview_url?(uri)

      value = uri.request_uri
      value += "##{uri.fragment}" unless uri.fragment.nil?
    elsif uri.host.nil?
      value = "/#{value}" unless value.start_with?("/")
    end
    self.start_page = value
  rescue URI::InvalidURIError
    # Leave invalid input intact so validation reports it instead of clearing the field.
  end

  # Accepts full URLs only for Builds belonging to this prototype.
  def prototype_preview_url?(uri)
    [ PreviewOrigin.current, SharePreviewOrigin.current ].any? do |origin|
      build_id = origin.build_id(uri.host)
      next false unless build_id && builds.exists?(id: build_id)

      expected = URI.parse(origin.url(build_id))
      uri.scheme == expected.scheme && uri.port == expected.port
    end
  end

  # Rejects external destinations, reserved endpoints, and ambiguous browser paths.
  def start_page_is_local
    return if start_page.nil?

    uri = URI.parse(start_page)
    path = URI::DEFAULT_PARSER.unescape(uri.path.to_s)
    valid = start_page.bytesize <= START_PAGE_MAXIMUM_BYTES &&
      start_page.start_with?("/") && !start_page.start_with?("//") &&
      uri.scheme.nil? && uri.host.nil? && !start_page.match?(/[[:cntrl:]\\]/) &&
      path.valid_encoding? && !path.match?(/[[:cntrl:]\\]/) && !path.start_with?("//") &&
      !path.split("/").intersect?([ ".", ".." ]) &&
      !path.match?(%r{\A/__replica(?:/|\z)})
    errors.add(:start_page, :invalid) unless valid
  rescue URI::InvalidURIError
    errors.add(:start_page, :invalid)
  end

  # Rejects values the database cannot store, including on direct model saves.
  def metadata_is_not_blank
    errors.add(:name, "can't be blank") if !name.nil? && name.strip.empty?
    errors.add(:description, "can't be blank") if !description.nil? && description.strip.empty?
  end

  # Keeps one prototype attached to its original repository branch.
  def identity_is_unchanged
    errors.add(:repository_id, "cannot change") if will_save_change_to_repository_id?
    errors.add(:branch_name, "cannot change") if will_save_change_to_branch_name?
  end

  # Prevents a later publication from being classified as the first again.
  def first_publication_is_unchanged
    if first_published_at_in_database.present? && will_save_change_to_first_published_at?
      errors.add(:first_published_at, "cannot change")
    end
  end
end
