# == Schema Information
#
# Table name: improvement_comments
# Database name: primary
#
#  id              :integer          not null, primary key
#  anchor          :json
#  author_snapshot :json
#  body            :text
#  deleted_at      :datetime
#  note_revision   :integer
#  note_status     :string
#  position        :integer          default(0), not null
#  role            :string           default("author"), not null
#  status          :string           default("open"), not null
#  thread_key      :string           not null
#  created_at      :datetime         not null
#  updated_at      :datetime         not null
#  build_id        :integer
#  local_id        :string           not null
#  prototype_id    :integer          not null
#  root_id         :integer
#  user_id         :integer          not null
#
# Indexes
#
#  idx_on_prototype_id_created_at_id_3f3dd1473e        (prototype_id,created_at,id)
#  idx_on_prototype_id_user_id_local_id_bce29f2a3a     (prototype_id,user_id,local_id) UNIQUE
#  improvement_comments_root_identity                  (id,prototype_id,user_id,local_id) UNIQUE
#  improvement_comments_thread_identity                (id,prototype_id,user_id,thread_key) UNIQUE
#  index_improvement_comments_on_build_id              (build_id)
#  index_improvement_comments_on_prototype_id          (prototype_id)
#  index_improvement_comments_on_root_id_and_position  (root_id,position) UNIQUE
#  index_improvement_comments_on_user_id               (user_id)
#
# Foreign Keys
#
#  [build_id, prototype_id]                      ([build_id, prototype_id] => builds[id, prototype_id]) ON DELETE => restrict
#  [root_id, prototype_id, user_id, thread_key]  ([root_id, prototype_id, user_id, thread_key] => improvement_comments[id, prototype_id, user_id, local_id]) ON DELETE => restrict
#  prototype_id                                  (prototype_id => prototypes.id) ON DELETE => restrict
#  user_id                                       (user_id => users.id) ON DELETE => restrict
#
# Check Constraints
#
#  improvement_comments_anchor       (anchor IS NULL OR (json_valid(anchor) AND json_type(anchor) = 'object' AND length(CAST(anchor AS BLOB)) <= 16384))
#  improvement_comments_author       (author_snapshot IS NULL OR (json_valid(author_snapshot) AND json_type(author_snapshot) = 'object'))
#  improvement_comments_body         (CASE WHEN deleted_at IS NULL THEN body IS NOT NULL AND length(trim(body)) > 0 AND length(CAST(body AS BLOB)) <= 10000 ELSE body IS NULL AND author_snapshot IS NULL END)
#  improvement_comments_local_id     (length(local_id) = 36 AND length(thread_key) = 36)
#  improvement_comments_role_status  ((role = 'author' AND status IN ('open', 'sent', 'ready', 'blocked')) OR (role = 'copilot' AND status IN ('ready', 'blocked') AND author_snapshot IS NULL))
#  improvement_comments_shape        ((root_id IS NULL AND position = 0 AND role = 'author' AND thread_key = local_id AND build_id IS NOT NULL AND anchor IS NOT NULL AND note_revision > 0 AND note_revision IS NOT NULL AND note_status IN ('open', 'sent', 'ready', 'resolved', 'blocked') AND note_status IS NOT NULL) OR (root_id IS NOT NULL AND root_id <> id AND position > 0 AND build_id IS NULL AND anchor IS NULL AND note_revision IS NULL AND note_status IS NULL))
#
# Stores one improvement request or agent response, independently of reviews.
class ImprovementComment < ApplicationRecord
  UUID = /\A[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\z/

  class Conflict < StandardError; end

  belongs_to :prototype
  belongs_to :user
  belongs_to :build, optional: true
  belongs_to :root, class_name: "ImprovementComment", optional: true, inverse_of: :replies
  has_many :replies, -> { order(:position) },
    class_name: "ImprovementComment", foreign_key: :root_id,
    inverse_of: :root, dependent: :restrict_with_exception
  has_many :request_links, -> { order(:position) },
    class_name: "ImprovementCommentReply", foreign_key: :response_id,
    inverse_of: :response, dependent: :restrict_with_exception
  has_many :requests, through: :request_links
  has_many :response_links,
    class_name: "ImprovementCommentReply", foreign_key: :request_id,
    inverse_of: :request, dependent: :restrict_with_exception
  has_many :responses, through: :response_links

  has_object :thread_contract
  has_object :message_contract

  before_validation :set_thread_identity, on: :create

  scope :roots, -> { where(root_id: nil) }

  validates :local_id, format: { with: UUID }
  validates :note_status, inclusion: { in: %w[open sent ready resolved blocked] }, if: :root_comment?
  validates :note_revision, numericality: { only_integer: true, greater_than: 0 }, if: :root_comment?
  validates :build, presence: true, if: :root_comment?
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :validate_message
  validate :validate_identity, on: :update
  validate -> { message_contract.validate(role:, body:, status:, author: author_snapshot, deleted: deleted_at.present?) }

  # Saves one complete client revision and its response links in a single transaction.
  def self.synchronize!(prototype:, user:, attributes:)
    prototype.with_lock do
      note = prototype.improvement_notes.find_or_initialize_by(user:, local_id: attributes[:local_id])
      revision = attributes.fetch(:revision)
      thread = attributes.fetch(:thread)
      deleted = attributes.fetch(:deleted)
      if note.persisted? && note.anchor != attributes[:anchor]
        raise Conflict, "A saved note's target cannot change."
      end
      if note.persisted? && attributes.key?(:build_number) && attributes[:build_number] != note.build.number
        raise Conflict, "A saved note's Build cannot change."
      end
      if note.persisted? && revision < note.note_revision
        raise Conflict, "The Hub note has a newer revision."
      end
      if note.persisted? && revision == note.note_revision
        if note.deleted_at.present? && thread
          retry_note = note.dup
          retry_note.thread_contract.validate!(thread, previous: nil)
        end
        same = note.body == (deleted ? nil : attributes[:body]) &&
          note.note_status == attributes[:status] &&
          note.deleted_at.present? == deleted &&
          note.note_thread == (deleted ? nil : thread)
        raise Conflict, "This note revision has different content." unless same

        return note
      end
      raise Conflict, "A deleted note cannot be restored." if note.deleted_at.present?
      if attributes[:previous_revision] != (note.persisted? ? note.note_revision : 0)
        raise Conflict, "The Hub note changed since its last synchronization."
      end
      if note.new_record?
        note.anchor = attributes[:anchor]
        note.build = prototype.builds.find_by(number: attributes[:build_number])
      end
      note.assign_attributes \
        body: deleted ? nil : attributes[:body],
        note_revision: revision,
        note_status: attributes[:status]
      note.deleted_at = Time.current if deleted
      note.save_conversation!(thread)
      note
    end
  end

  # Identifies the anchored request that owns the conversation.
  def root_comment?
    root_id.nil?
  end

  # Keeps mutations limited to the creator, even when readers can explicitly list notes.
  def editable_by?(actor)
    actor.present? && actor.id == user_id && deleted_at.nil?
  end

  # Reconstructs the conversation from message rows and ordered response links.
  def note_thread
    return if deleted_at.present?

    conversation_payload(status, author_snapshot)
  end

  # Validates and writes the root, messages and answer links as one explicit operation.
  def save_conversation!(thread)
    self.class.transaction do
      previous = conversation_payload(status_in_database, author_snapshot_in_database) if persisted?
      thread_contract.validate!(thread, previous:)
      self.status = thread.fetch("originalStatus")
      self.author_snapshot = deleted_at ? nil : thread["originalAuthor"]
      save!
      save_messages(thread)
    end
  end

  private

  # Uses the root UUID to enforce conversation boundaries on both foreign keys of a reply link.
  def set_thread_identity
    self.thread_key ||= root ? root.local_id : local_id
  end

  # Applies shared anchor rules and checks the root or reply shape without review callbacks.
  def validate_message
    errors.add(:prototype, "must be a reviewable branch") unless prototype&.reviewable?
    if root_comment?
      ReviewComment::AnchorContract.new(self).validate_record
      if build && (build.prototype_id != prototype_id || build.state != "successful")
        errors.add(:build, "must be a successful Build of this prototype")
      end
      errors.add(:role, "must be author for the original request") unless role == "author"
      errors.add(:position, "must be zero for the original request") unless position == 0
      errors.add(:thread_key, "must identify the original request") unless thread_key == local_id
    else
      unless root&.root_comment? && root.prototype_id == prototype_id && root.user_id == user_id && root.local_id == thread_key
        errors.add(:root, "must belong to this creator's conversation")
      end
      errors.add(:root, "cannot accept replies after deletion") if root&.deleted_at.present? && deleted_at.nil?
      errors.add(:position, "must be positive for a reply") unless position&.positive?
      %i[build_id anchor note_revision note_status].each do |attribute|
        errors.add(attribute, "must be absent for replies") if public_send(attribute).present?
      end
    end
  end

  # Keeps message identities and saved history immutable, except request statuses and deletion.
  def validate_identity
    %i[prototype_id build_id user_id root_id local_id thread_key role position anchor].each do |attribute|
      errors.add(attribute, "cannot change") if public_send("will_save_change_to_#{attribute}?")
    end
    if deleted_at_in_database && will_save_change_to_deleted_at?
      errors.add(:deleted_at, "cannot change")
    end
    return if deleted_at.present?

    errors.add(:body, "cannot change") if will_save_change_to_body?
    if author_snapshot_in_database.present? && will_save_change_to_author_snapshot?
      errors.add(:author_snapshot, "cannot change")
    end
    if role == "copilot" && will_save_change_to_status?
      errors.add(:status, "cannot change on agent responses")
    end
  end

  # Preserves conversation order, including the requests answered by each agent response.
  def conversation_payload(original_status, original_author)
    payload = {
      "originalStatus" => original_status,
      "messages" => replies.map do |message|
        value = { "id" => message.local_id, "role" => message.role, "body" => message.body, "status" => message.status }
        value["author"] = message.author_snapshot if message.author_snapshot
        value["requestIds"] = message.request_links.map { _1.request.local_id } if message.role == "copilot"
        value
      end
    }
    payload["originalAuthor"] = original_author if original_author
    payload
  end

  # Persists validated message changes with the root's revision; deleted rows retain no text.
  def save_messages(thread)
    if deleted_at.present?
      replies.update_all(body: nil, author_snapshot: nil, deleted_at:, updated_at: Time.current)
    else
      messages = { local_id => self }
      thread["messages"].each_with_index do |input, index|
        message = replies.find_or_initialize_by(local_id: input["id"])
        message.assign_attributes \
          prototype:, user:, thread_key: local_id,
          position: index + 1, role: input["role"], body: input["body"],
          status: input["status"], author_snapshot: input["author"]
        message.save!
        if message.role == "copilot" && message.request_links.empty?
          input["requestIds"].each_with_index do |request_id, position|
            message.request_links.create!(request: messages.fetch(request_id), prototype:, user:, thread_key: local_id, position:)
          end
        end
        messages[message.local_id] = message
      end
    end
    replies.reset
  end
end
