# == Schema Information
#
# Table name: improvement_comment_replies
# Database name: primary
#
#  id           :integer          not null, primary key
#  position     :integer          not null
#  thread_key   :string           not null
#  prototype_id :integer          not null
#  request_id   :integer          not null
#  response_id  :integer          not null
#  user_id      :integer          not null
#
# Indexes
#
#  idx_on_response_id_request_id_1aa61357ff                       (response_id,request_id) UNIQUE
#  improvement_comment_replies_thread                             (prototype_id,user_id,thread_key)
#  index_improvement_comment_replies_on_prototype_id              (prototype_id)
#  index_improvement_comment_replies_on_request_id                (request_id)
#  index_improvement_comment_replies_on_response_id_and_position  (response_id,position) UNIQUE
#  index_improvement_comment_replies_on_user_id                   (user_id)
#
# Foreign Keys
#
#  [request_id, prototype_id, user_id, thread_key]   ([request_id, prototype_id, user_id, thread_key] => improvement_comments[id, prototype_id, user_id, thread_key]) ON DELETE => restrict
#  [response_id, prototype_id, user_id, thread_key]  ([response_id, prototype_id, user_id, thread_key] => improvement_comments[id, prototype_id, user_id, thread_key]) ON DELETE => restrict
#
# Check Constraints
#
#  improvement_comment_replies_shape  (response_id <> request_id AND position >= 0)
#
# Links an agent response to one of the requests it answers in the same conversation.
class ImprovementCommentReply < ApplicationRecord
  belongs_to :response, class_name: "ImprovementComment", inverse_of: :request_links
  belongs_to :request, class_name: "ImprovementComment", inverse_of: :response_links
  belongs_to :prototype
  belongs_to :user

  validate :same_conversation
  validate :identity_is_unchanged, on: :update

  private

  # Allows agent responses to answer only earlier author requests in their own conversation.
  def same_conversation
    unless response&.role == "copilot" && request&.role == "author" &&
        response.root_id == (request.root_id || request.id) &&
        response.position > request.position &&
        [ response, request ].all? { _1.prototype_id == prototype_id && _1.user_id == user_id && _1.thread_key == thread_key }
      errors.add(:request, "must be an earlier author request in this response's conversation")
    end
  end

  # Keeps the requests answered by a saved response immutable.
  def identity_is_unchanged
    errors.add(:base, "Saved response links cannot change.") if changed?
  end
end
