# == Schema Information
#
# Table name: notifications
# Database name: primary
#
#  id                 :integer          not null, primary key
#  analytics_opened   :boolean          default(FALSE), not null
#  kind               :string           not null
#  lock_version       :integer          default(0), not null
#  read_at            :datetime
#  source_key         :string           not null
#  created_at         :datetime         not null
#  updated_at         :datetime         not null
#  actor_id           :integer          not null
#  comment_mention_id :integer
#  recipient_id       :integer          not null
#
# Indexes
#
#  index_notifications_on_actor_id                            (actor_id)
#  index_notifications_on_comment_mention_id                  (comment_mention_id) UNIQUE
#  index_notifications_on_recipient_id                        (recipient_id)
#  index_notifications_on_recipient_id_and_created_at_and_id  (recipient_id,created_at,id)
#  index_notifications_on_recipient_id_and_source_key         (recipient_id,source_key) UNIQUE
#
# Foreign Keys
#
#  actor_id            (actor_id => users.id) ON DELETE => restrict
#  comment_mention_id  (comment_mention_id => comment_mentions.id) ON DELETE => cascade
#  recipient_id        (recipient_id => github_identities.id) ON DELETE => restrict
#
# Check Constraints
#
#  notifications_kind            (kind IN ('comment_created', 'comment_mention', 'comment_reply', 'comment_reaction', 'thread_resolved', 'thread_reopened'))
#  notifications_mention_source  ((kind = 'comment_mention' AND comment_mention_id IS NOT NULL) OR (kind <> 'comment_mention' AND comment_mention_id IS NULL))
#  notifications_version         (lock_version >= 0)
#
# Stores recipient-specific inbox state independently of thread read receipts.
class Notification < ApplicationRecord
  KINDS = {
    "comment_created" => "comment",
    "comment_mention" => "mention",
    "comment_reply" => "reply",
    "comment_reaction" => "reaction",
    "thread_resolved" => "resolved",
    "thread_reopened" => "reopened"
  }.freeze

  belongs_to :recipient, class_name: "GithubIdentity"
  belongs_to :actor, class_name: "User"
  belongs_to :comment_mention, optional: true
  has_many :notification_resources, dependent: :delete_all
  has_one :primary_resource, -> { where(role: "primary") }, class_name: "NotificationResource"
  has_one :review_comment, through: :primary_resource, source: :resource, source_type: "ReviewComment"

  validates :kind, inclusion: { in: KINDS.keys }
  validates :comment_mention, presence: true, if: -> { kind == "comment_mention" }
  validates :comment_mention_id, uniqueness: true, allow_nil: true
  validates :source_key, presence: true, uniqueness: { scope: :recipient_id }

  # Restricts inbox reads to the signed-in immutable GitHub identity.
  scope :for_user, ->(user) {
    where(recipient: GithubIdentity.where(github_id: user.github_id))
  }

  # Checks fresh access before loading message text or exposing an unread indicator.
  def self.visible_to(user)
    relation = for_user(user).joins(review_comment: :prototype)
      .where(review_comments: { deleted_at: nil })
    repository_ids = relation.distinct.pluck("prototypes.repository_id")
    prototype_ids = Repository.active.where(id: repository_ids).flat_map do |repository|
      next [] unless repository.authorization.authorized?(user, fresh: true)

      repository.reviewable_prototypes.ids
    end
    relation.where(prototypes: { id: prototype_ids })
  end

  # Counts an authorized recipient's first open even if the event later expires.
  def record_opened_by(user)
    return if analytics_opened?

    Analytics::Event.record_page_view do
      # An analytics write must not invalidate an inbox read/unread update.
      claimed = self.class.where(id:, analytics_opened: false).update_all \
        analytics_opened: true,
        lock_version: self.class.arel_table[:lock_version]
      next if claimed.zero?

      comment = review_comment
      Analytics::Event.record! \
        repository: comment.prototype.repository,
        name: "notification_opened",
        source_key: "notification/#{id}/opened",
        actor_id: Analytics.actor_id(user:),
        properties: comment.analytics_properties
    end
  end

  # Creates a mention notification and its primary and context resources atomically.
  def self.record_mention!(mention)
    comment = mention.review_comment
    record! \
      comment:,
      actor: comment.user,
      recipient: mention.github_identity,
      kind: "comment_mention",
      source_key: "mention/#{mention.id}",
      comment_mention: mention
  end

  # Notifies the prototype owner of a new conversation unless directly mentioned.
  def self.record_comment!(comment)
    return if comment.prototype.repository.local?

    owner = comment.prototype.author
    return if owner.nil? || owner.github_id == comment.user.github_id

    recipient = identity_for(owner)
    return if comment.comment_mentions.exists?(github_identity_id: recipient.id)

    record! comment:, actor: comment.user, recipient:, kind: "comment_created", source_key: "comment/#{comment.id}"
  end

  # Sends one reply update to participants not already notified by a direct mention.
  def self.record_reply!(reply)
    return if reply.prototype.repository.local?

    mentioned_ids = reply.comment_mentions.pluck(:github_identity_id)
    recipients = participants(reply.root, actor: reply.user)
    owner = reply.prototype.author
    recipients << identity_for(owner) if owner && owner.github_id != reply.user.github_id
    recipients.uniq(&:github_id).reject { mentioned_ids.include?(_1.id) }.each do |recipient|
      record! comment: reply, actor: reply.user, recipient:, kind: "comment_reply", source_key: "reply/#{reply.id}"
    end
  end

  # Sends a new reaction only to the message author, never to the reacting user.
  def self.record_reaction!(reaction)
    comment = reaction.review_comment
    return if comment.prototype.repository.local? || comment.user.github_id == reaction.user.github_id

    recipient = identity_for(comment.user)
    record! comment:, actor: reaction.user, recipient:, kind: "comment_reaction", source_key: "reaction/#{reaction.id}"
  end

  # Identifies a genuine resolution transition by its locked thread version.
  def self.record_resolution!(root, actor:, kind:)
    return if root.prototype.repository.local?

    participants(root, actor:).each do |recipient|
      record! comment: root, actor:, recipient:, kind:, source_key: "thread/#{root.id}/#{root.activity_version}/#{kind}"
    end
  end

  # Removes every activity notification whose primary message is being deleted.
  def self.remove_for_message!(comment)
    joins(:primary_resource).where(notification_resources: { resource_type: "ReviewComment", resource_id: comment.id }).destroy_all
  end

  # Withdraws the notification for a removed reaction without notifying anyone.
  def self.remove_for_reaction!(reaction)
    where(source_key: "reaction/#{reaction.id}").destroy_all
  end

  # Records the notification and its heterogeneous resources in the action's transaction.
  def self.record!(comment:, actor:, recipient:, kind:, source_key:, comment_mention: nil)
    transaction do
      notification = create! \
        recipient:,
        actor:,
        kind:,
        source_key:,
        comment_mention: comment_mention
      notification.notification_resources.create! resource: comment, role: "primary"
      notification.notification_resources.create! resource: comment.prototype, role: "context"
      notification
    end
  end
  private_class_method :record!

  # Authors remain participants; mention-only recipients need a remaining live mention.
  def self.participants(root, actor:)
    comments = ReviewComment.where(id: root.id).or(ReviewComment.where(root_id: root.id))
    authors = User.where(id: comments.select(:user_id)).where.not(github_id: actor.github_id)
    identities = authors.map { identity_for(_1) }
    mentioned = GithubIdentity.joins(:comment_mentions)
      .where(comment_mentions: { review_comment_id: comments.not_deleted.select(:id) })
    (identities + mentioned.to_a).uniq(&:github_id).reject { _1.github_id == actor.github_id }
  end
  private_class_method :participants

  # Uses the GitHub identity verified at sign-in without creating another Hub account.
  def self.identity_for(user)
    GithubIdentity.record! github_id: user.github_id, login: user.login, avatar_url: user.avatar_url
  end
  private_class_method :identity_for
end
