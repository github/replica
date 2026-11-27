# == Schema Information
#
# Table name: comment_mentions
# Database name: primary
#
#  id                 :integer          not null, primary key
#  login              :string           not null
#  created_at         :datetime         not null
#  updated_at         :datetime         not null
#  github_identity_id :integer          not null
#  review_comment_id  :integer          not null
#
# Indexes
#
#  idx_on_review_comment_id_github_identity_id_54cb03314e  (review_comment_id,github_identity_id) UNIQUE
#  index_comment_mentions_on_github_identity_id            (github_identity_id)
#  index_comment_mentions_on_review_comment_id             (review_comment_id)
#
# Foreign Keys
#
#  github_identity_id  (github_identity_id => github_identities.id) ON DELETE => restrict
#  review_comment_id   (review_comment_id => review_comments.id) ON DELETE => cascade
#
# Check Constraints
#
#  comment_mentions_login  (length(trim(login)) > 0)
#
# Records one durable recipient and the token used in a review message.
class CommentMention < ApplicationRecord
  belongs_to :review_comment
  belongs_to :github_identity
  has_one :notification, dependent: :destroy

  validates :login, presence: true
  validates :github_identity_id, uniqueness: { scope: :review_comment_id }

  after_create :record_analytics_creation

  private

  # Attributes the mention to the message's author, not the recipient.
  def record_analytics_creation
    Analytics::Event.record! \
      repository: review_comment.prototype.repository,
      name: "review_mention_added",
      source_key: "mention/#{id}/added",
      actor_id: Analytics.actor_id(user: review_comment.user),
      properties: review_comment.analytics_properties
  end
end
