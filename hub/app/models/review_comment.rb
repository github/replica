# == Schema Information
#
# Table name: review_comments
# Database name: primary
#
#  id                      :integer          not null, primary key
#  activity_version        :integer
#  anchor                  :json
#  body                    :text
#  capture                 :text
#  deleted_at              :datetime
#  edited_at               :datetime
#  kind                    :string           default("review"), not null
#  learning_removal_due_at :datetime
#  note_revision           :integer
#  note_status             :string
#  resolved_at             :datetime
#  created_at              :datetime         not null
#  updated_at              :datetime         not null
#  build_id                :integer
#  local_id                :string
#  prototype_id            :integer          not null
#  resolved_by_id          :integer
#  root_id                 :integer
#  user_id                 :integer          not null
#
# Indexes
#
#  index_review_comments_on_build_id                               (build_id)
#  index_review_comments_on_id_and_prototype                       (id,prototype_id) UNIQUE
#  index_review_comments_on_learning_removal_due_at                (learning_removal_due_at) WHERE learning_removal_due_at IS NOT NULL
#  index_review_comments_on_prototype_and_created_at               (prototype_id,created_at DESC,id DESC)
#  index_review_comments_on_prototype_id_and_user_id_and_local_id  (prototype_id,user_id,local_id) UNIQUE
#  index_review_comments_on_resolved_by_id                         (resolved_by_id)
#  index_review_comments_on_root_id                                (root_id)
#  index_review_comments_on_user_id                                (user_id)
#
# Foreign Keys
#
#  [build_id, prototype_id]  ([build_id, prototype_id] => builds[id, prototype_id]) ON DELETE => restrict
#  [root_id, prototype_id]   ([root_id, prototype_id] => review_comments[id, prototype_id]) ON DELETE => restrict
#  prototype_id              (prototype_id => prototypes.id) ON DELETE => restrict
#  resolved_by_id            (resolved_by_id => users.id) ON DELETE => restrict
#  user_id                   (user_id => users.id) ON DELETE => restrict
#
# Check Constraints
#
#  review_comments_activity_version  ((root_id IS NULL AND activity_version IS NOT NULL AND activity_version > 0) OR (root_id IS NOT NULL AND activity_version IS NULL))
#  review_comments_anchor_json       (anchor IS NULL OR json_valid(anchor))
#  review_comments_anchor_object     (anchor IS NULL OR json_type(anchor) = 'object')
#  review_comments_anchor_size       (anchor IS NULL OR length(CAST(anchor AS BLOB)) BETWEEN 2 AND 16384)
#  review_comments_body              (CASE WHEN deleted_at IS NULL THEN body IS NOT NULL AND length(trim(body)) > 0 AND length(CAST(body AS BLOB)) <= 10000 ELSE body IS NULL END)
#  review_comments_deletion_time     (deleted_at IS NULL OR deleted_at >= created_at)
#  review_comments_edit_state        (edited_at IS NULL OR (deleted_at IS NULL AND edited_at >= created_at))
#  review_comments_kind              ((kind = 'review' AND local_id IS NULL AND note_revision IS NULL AND note_status IS NULL AND capture IS NULL) OR (kind = 'improvement_note' AND root_id IS NULL AND build_id IS NULL AND local_id IS NOT NULL AND length(local_id) = 36 AND note_revision IS NOT NULL AND note_revision > 0 AND note_status IS NOT NULL AND note_status IN ('open', 'sent', 'ready', 'resolved', 'blocked') AND (capture IS NULL OR length(CAST(capture AS BLOB)) <= 1500000)))
#  review_comments_resolution        ((resolved_at IS NULL AND resolved_by_id IS NULL) OR (root_id IS NULL AND resolved_at IS NOT NULL AND resolved_by_id IS NOT NULL))
#  review_comments_root_not_self     (root_id IS NULL OR root_id <> id)
#  review_comments_thread_shape      ((root_id IS NULL AND anchor IS NOT NULL AND (build_id IS NOT NULL OR kind = 'improvement_note')) OR (kind = 'review' AND root_id IS NOT NULL AND build_id IS NULL AND anchor IS NULL))
#
# Stores one root comment or reply in a Prototype review thread.
class ReviewComment < ApplicationRecord
  ANCHOR_SCHEMA_VERSION = 1
  REQUEST_MAXIMUM_BYTES = 32_768
  BODY_MAXIMUM_BYTES = 10_000
  ANCHOR_MAXIMUM_BYTES = 16_384
  PATHNAME_MAXIMUM_BYTES = 2_048
  SEARCH_MAXIMUM_BYTES = 2_048
  HASH_MAXIMUM_BYTES = 1_024
  SELECTOR_MAXIMUM_BYTES = 4_096
  ACCESSIBLE_NAME_MAXIMUM_BYTES = 1_000
  TAG_NAME_MAXIMUM_BYTES = 64
  SELECTED_TEXT_MAXIMUM_BYTES = 2_000
  AREA_ROLE_MAXIMUM_BYTES = 64
  AREA_TEXT_EXCERPT_MAXIMUM_BYTES = 500
  AREA_PATH_MAXIMUM_POINTS = 160
  AREA_ELEMENTS_MAXIMUM = 8
  AREA_MINIMUM_DIAGONAL = 8
  GEOMETRY_ABSOLUTE_MAXIMUM = 1_000_000
  VIEWPORT_DIMENSION_MAXIMUM = 100_000
  DEFAULT_PAGE_SIZE = 200
  MAXIMUM_PAGE_SIZE = 200
  # How long Hub waits, after a deletion or after the removal job last started, before it queues the
  # removal of a deleted comment's text from the learning store again. It is longer than any wait
  # between the job's own retries, so Hub never adds a second job while the first still tries.
  LEARNING_REMOVAL_RETRY = 3.hours

  # Reports invalid comment page input.
  class InvalidPagination < StandardError; end
  class ResponseTooLarge < StandardError; end
  class ThreadChanged < StandardError; end
  class TooManyMentions < StandardError; end

  Page = Data.define(:records, :next_cursor, :has_more)

  belongs_to :prototype
  belongs_to :build, optional: true
  belongs_to :user
  belongs_to :root, \
    class_name: "ReviewComment",
    optional: true,
    inverse_of: :replies
  belongs_to :resolved_by, \
    class_name: "User",
    optional: true,
    inverse_of: :resolved_review_comments
  has_many :reactions, \
    class_name: "ReviewCommentReaction",
    inverse_of: :review_comment,
    dependent: :delete_all
  has_many :replies, \
    -> { order(:created_at, :id) },
    class_name: "ReviewComment",
    foreign_key: :root_id,
    inverse_of: :root,
    dependent: :restrict_with_exception
  has_many :thread_reads, \
    class_name: "ReviewThreadRead",
    foreign_key: :root_id,
    inverse_of: :root,
    dependent: :delete_all

  has_object :anchor_contract
  has_object :thread
  has_object :mentions

  has_many :comment_mentions, dependent: :destroy

  performs :remove_from_learning_store!, queue_as: :default do
    self.enqueue_after_transaction_commit = true
    limits_concurrency **Learning::CONCURRENCY, duration: 15.minutes
    retry_on Learning::ExecutionLock::Busy, **Learning::ExecutionLock::RETRY
    # Removing the text again changes nothing, so a removal that failed tries again, for about four
    # hours in all, enough to ride out a short outage of the store or Node.js. A job that still fails
    # stays in Solid Queue's failed jobs, and recover_learning_removals! queues the removal again.
    retry_on Learning::Error, wait: :polynomially_longer, attempts: 10
    discard_on ActiveJob::DeserializationError
  end

  # Queues the removal again for each deleted comment whose text may still be in its learning
  # store, because the job that removes it was never queued, for example when the queue database
  # refused it, or stopped trying. It never asks Copilot, so it also runs while Learnings is off.
  def self.recover_learning_removals!
    where(learning_removal_due_at: ..Time.current).find_each do |comment|
      claimed = where(id: comment.id, learning_removal_due_at: ..Time.current)
        .update_all(learning_removal_due_at: LEARNING_REMOVAL_RETRY.from_now)
      comment.remove_from_learning_store_later! if claimed.positive?
    end
  end

  # Creates a root and its verified mentions in one transaction.
  def self.create_with_mentions!(prototype:, user:, body:, **attributes)
    profiles = Mentions.resolve(repository: prototype.repository, body:)
    transaction do
      comment = create!(prototype:, user:, body:, **attributes)
      comment.mentions.sync!(profiles)
      Notification.record_comment!(comment) if comment.root_comment?
      comment
    end
  end

  before_validation :set_initial_activity_version, on: :create
  after_create :record_author_read, if: -> { root_comment? && !improvement_note? }
  after_create :record_analytics_creation, unless: :improvement_note?
  before_destroy :remove_notifications

  scope :roots, -> { where(root_id: nil) }
  scope :not_deleted, -> { where(deleted_at: nil) }
  scope :unresolved, -> { where(resolved_at: nil) }
  scope :ordinary, -> { where(kind: "review") }
  scope :improvement_notes, -> { where(kind: "improvement_note") }

  validates :body, presence: true, if: -> { deleted_at.nil? }
  validates :body, absence: true, if: -> { deleted_at.present? }
  validates :kind, inclusion: { in: %w[review improvement_note] }
  validates :build, presence: true, if: -> { root_comment? && !improvement_note? }
  validates :note_status, inclusion: { in: %w[open sent ready resolved blocked] }, if: :improvement_note?
  validates :note_revision, numericality: { only_integer: true, greater_than: 0 }, if: :improvement_note?
  validates :local_id, format: { with: /\A[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\z/ }, if: :improvement_note?
  validate :improvement_note_shape
  validates :build, absence: true, if: :reply?
  validates :anchor, presence: true, if: :root_comment?
  validates :anchor, absence: true, if: :reply?
  validates :root, presence: true, if: :reply?
  validates :activity_version, \
    numericality: { only_integer: true, greater_than: 0 },
    if: :root_comment?
  validates :activity_version, absence: true, if: :reply?
  validate :body_fits_limit
  validate -> { anchor_contract.validate_record }, if: :root_comment?
  validate :build_belongs_to_prototype
  validate :build_is_successful
  validate :prototype_is_reviewable
  validate :root_is_direct
  validate :resolution_matches_root
  validate :identity_is_unchanged, on: :update
  validate :deletion_is_permanent, on: :update

  class << self
    # Returns comments newest first with a signed token for the next page.
    def page_for(prototype, cursor:, page_size:, improvement_notes: "exclude")
      paginate \
        filtered_notes(improvement_notes).where(prototype:).includes(:build, :user, :resolved_by, :reactions, comment_mentions: :github_identity),
        purpose: "prototype/#{prototype.id}/#{improvement_notes}",
        cursor:,
        page_size:
    end

    # Returns one bounded stream across every reviewable branch in the repository.
    def page_for_repository(repository, viewer:, cursor:, page_size:, improvement_notes: "exclude")
      paginate \
        filtered_notes(improvement_notes).where(prototype: repository.reviewable_prototypes).includes(:prototype, :build, :user, :resolved_by, :reactions, comment_mentions: :github_identity),
        purpose: "repository/#{repository.id}/viewer/#{viewer.id}/#{improvement_notes}",
        cursor:,
        page_size:
    end

    # Reads only visible starting comments, with filters bound into the cursor.
    def summary_page_for_repository(repository, viewer:, cursor:, page_size:, filters:, &fits)
      relation = ordinary.roots.not_deleted.where(prototype: repository.reviewable_prototypes)
      relation = relation.where(resolved_at: nil) if filters[:resolution] == "unresolved"
      relation = relation.where.not(resolved_at: nil) if filters[:resolution] == "resolved"
      relation = relation.where(created_at: filters[:from]..) if filters[:from]
      relation = relation.where(created_at: ...filters[:to]) if filters[:to]
      cursor_filters = filters.transform_values { _1.is_a?(Time) ? _1.getutc.iso8601(6) : _1 }
      paginate \
        relation.includes(:prototype, :build, :user),
        purpose: "repository/#{repository.id}/summaries/viewer/#{viewer.id}/#{Digest::SHA256.hexdigest(cursor_filters.to_json)}",
        cursor:,
        page_size:,
        &fits
    end

    # Reads one thread's visible replies oldest first without loading other conversations.
    def reply_page_for(root, viewer:, cursor:, page_size:, &fits)
      paginate \
        root.replies.not_deleted.includes(:user, :reactions, comment_mentions: :github_identity),
        purpose: "thread/#{root.id}/viewer/#{viewer.id}",
        cursor:,
        page_size:,
        direction: :asc,
        activity_version: root.activity_version,
        &fits
    end

    private

    # Opts into author notes only on explicit authorized API reads.
    def filtered_notes(filter)
      case filter
      when "exclude" then ordinary
      when "include" then all
      when "only" then improvement_notes
      else raise InvalidPagination
      end
    end

    # Uses the same signed keyset pagination for prototype and repository readers.
    def paginate(relation, purpose:, cursor:, page_size:, direction: :desc, activity_version: nil, &fits)
      raise InvalidPagination if !page_size.is_a?(Integer) || !(1..MAXIMUM_PAGE_SIZE).cover?(page_size)

      relation = before_cursor(relation, purpose, cursor, direction:, activity_version:) if cursor.present?
      records = relation.reorder(created_at: direction, id: direction).limit(page_size + 1).to_a
      has_more = records.length > page_size
      records = records.first(page_size)
      make_page = lambda do |count|
        more = has_more || count < records.length
        next_cursor = encode_cursor(purpose, records[count - 1], activity_version:) if more && count.positive?
        Page.new(records: records.first(count), next_cursor:, has_more: more)
      end
      page = make_page.call(records.length)
      return page if !fits || fits.call(page)

      low = 1
      high = records.length - 1
      best = nil
      while low <= high
        count = (low + high) / 2
        candidate = make_page.call(count)
        if fits.call(candidate)
          best = candidate
          low = count + 1
        else
          high = count - 1
        end
      end
      raise ResponseTooLarge if best.nil?

      best
    end

    # Continues past the signed page position in the requested order.
    def before_cursor(relation, purpose, cursor, direction:, activity_version:)
      payload = Rails.application.message_verifier("review-comment-cursor").verified \
        cursor,
        purpose: purpose
      raise InvalidPagination if !payload.is_a?(Hash)

      created_at = Time.iso8601(payload.fetch("created_at"))
      id = payload.fetch("id")
      raise InvalidPagination if !id.is_a?(Integer) || !id.positive?
      raise ThreadChanged if activity_version && payload["activity_version"] != activity_version

      if direction == :asc
        later = relation.where(created_at: created_at..).where.not(created_at:)
        same_time = relation.where(created_at:, id: id..).where.not(id:)
        later.or(same_time)
      else
        older = relation.where(created_at: ...created_at)
        same_time = relation.where(created_at:, id: ...id)
        older.or(same_time)
      end
    rescue KeyError, ArgumentError
      raise InvalidPagination
    end

    # Signs the last comment's time and ID for the next page.
    def encode_cursor(purpose, comment, activity_version: nil)
      payload = { "created_at" => comment.created_at.iso8601(6), "id" => comment.id }
      payload["activity_version"] = activity_version if activity_version
      Rails.application.message_verifier("review-comment-cursor").generate \
        payload,
        purpose:
    end
  end

  # Reports whether this record owns one thread's anchor and Build.
  def root_comment?
    root_id.nil?
  end

  # Reports whether this record replies directly to a root comment.
  def reply?
    root_id.present?
  end

  # Reports whether the actor may change or delete this comment body.
  def editable_by?(actor)
    actor.present? && actor.id == user_id && deleted_at.nil?
  end

  # Removes a deleted comment's text, every version of it and the labels on them, from its
  # repository's learning store, which keeps its own copy of review comments. It adds nothing else
  # to the store and never asks Copilot, so it also works while Learnings is off. The store records
  # who removed the text: the person who deleted the comment, whom Hub names when it enqueues the
  # job, so the job needs no record of them later. A job that names no one names the comment's
  # author, the only person Hub lets delete a comment. Each attempt moves the time Hub would queue
  # the removal again, and once the text is gone, Hub stops queueing it.
  def remove_from_learning_store!(by: nil)
    self.class.where(id:).where.not(learning_removal_due_at: nil)
      .update_all(learning_removal_due_at: LEARNING_REMOVAL_RETRY.from_now)
    Learning::ExecutionLock.synchronize do
      Learning::Store.new(prototype.repository).remove_comment!(id, by: by || Learning.person_for(user))
    end
    self.class.where(id:).update_all(learning_removal_due_at: nil)
  end

  # Separates author improvement work from ordinary review threads.
  def improvement_note?
    kind == "improvement_note"
  end

  private

  # Keeps notes standalone, bounded and outside ordinary review interactions.
  def improvement_note_shape
    return unless improvement_note?

    errors.add(:root, "must be absent for improvement notes") if root_id.present?
    errors.add(:build, "must be absent for improvement notes") if build_id.present?
    if capture.present? && (capture.bytesize > 1_500_000 || !capture.match?(/\Adata:image\/png;base64,[A-Za-z0-9+\/]+=*\z/))
      errors.add(:capture, "must be a bounded PNG capture")
    end
  end

  # Cleans polymorphic resources when a message is physically removed.
  def remove_notifications
    Notification.remove_for_message!(self)
  end

  # Captures identifiers only, never review text or its saved target.
  def record_analytics_creation
    prototype.repository.with_lock do
      Analytics::Event.record! \
        repository: prototype.repository,
        name: root_comment? ? "review_comment_created" : "review_reply_added",
        source_key: "comment/#{id}/created",
        actor_id: Analytics.actor_id(user:),
        occurred_at: created_at,
        properties: {
          prototype_id:, build_id: build_id || root.build_id,
          thread_id: root_id || id, comment_id: id
        }
    end
  end

  # Starts each root at the first activity version and leaves replies without one.
  def set_initial_activity_version
    self.activity_version = root_comment? ? 1 : nil
  end

  # Records the first thread version as seen by the root author.
  def record_author_read
    ReviewThreadRead.record! \
      root: self,
      user:,
      activity_version:
  end

  # Limits the comment body to the allowed number of UTF-8 bytes.
  def body_fits_limit
    return if body.nil? || body.bytesize <= BODY_MAXIMUM_BYTES

    errors.add(:body, "must be #{BODY_MAXIMUM_BYTES} UTF-8 bytes or fewer")
  end

  # Requires the comment's Build to belong to the same Prototype.
  def build_belongs_to_prototype
    return if build.nil? || prototype.nil? || build.prototype_id == prototype_id

    errors.add(:build, "must belong to this prototype")
  end

  # Requires the recorded Build to be successful.
  def build_is_successful
    return if build.nil? || build.state == "successful"

    errors.add(:build, "must be successful")
  end

  # Default-branch Builds have no review conversations.
  def prototype_is_reviewable
    errors.add(:prototype, "must be a reviewable branch") unless prototype&.reviewable?
  end

  # Requires every reply to point directly to a root in the same Prototype.
  def root_is_direct
    return if root.nil?

    errors.add(:root, "must be a root comment") if root.root_id.present?
    errors.add(:root, "cannot be an improvement note") if root.improvement_note?
    errors.add(:root, "must belong to this prototype") if root.prototype_id != prototype_id
  end

  # Keeps resolution state on the root and records the resolving reviewer.
  def resolution_matches_root
    if resolved_at.present? != resolved_by.present?
      errors.add(:resolved_at, "must identify the reviewer who resolved the thread")
    end
    if reply? && (resolved_at.present? || resolved_by.present?)
      errors.add(:resolved_at, "must belong to the root comment")
    end
  end

  # Prevents thread identity and anchor fields from changing after creation.
  def identity_is_unchanged
    %i[prototype_id build_id user_id anchor root_id kind local_id].each do |attribute|
      errors.add(attribute, "cannot change") if public_send("will_save_change_to_#{attribute}?")
    end
  end

  # Prevents a deleted comment from being restored or moved to another time.
  def deletion_is_permanent
    return if deleted_at_was.nil?

    errors.add(:deleted_at, "cannot change") if will_save_change_to_deleted_at?
  end
end
