# Changes messages and resolution state within one review thread.
class ReviewComment::Thread < ActiveRecord::AssociatedObject
  # Adds one reply while the root thread remains open.
  def create_reply!(user:, body:)
    profiles = ReviewComment::Mentions.resolve(repository: record.prototype.repository, body:)
    record.with_lock do
      record.errors.add(:base, "Replies must target a root comment") if record.reply?
      record.errors.add(:base, "Deleted threads cannot receive replies") if record.deleted_at.present?
      if record.resolved_at.present?
        record.errors.add(:base, "Resolved threads must be reopened before replying")
      end
      raise ActiveRecord::RecordInvalid, record if record.errors.any?

      reply = record.replies.create! \
        prototype: record.prototype,
        user:,
        body: body
      advance_activity! record, user
      reply.mentions.sync!(profiles)
      Notification.record_reply!(reply)
      reply
    end
  end

  # Changes this comment's body and records that the author edited it.
  def edit_body!(body, actor:)
    profiles = ReviewComment::Mentions.resolve \
      repository: record.prototype.repository,
      body:,
      existing: record.comment_mentions.includes(:github_identity).to_a
    with_thread_lock do |root|
      record.errors.add(:base, "Deleted comments cannot be edited") if record.deleted_at.present?
      raise ActiveRecord::RecordInvalid, record if record.errors.any?
      return record if record.body == body

      record.update! \
        body:,
        edited_at: Time.current
      advance_activity! root, actor
      record.mentions.sync!(profiles)
      record
    end
  end

  # Removes this comment's body while retaining its thread position. A background job then removes
  # the text from the repository's learning store too. The deletion records when to queue that
  # removal again, so the text still goes when the job is never queued or keeps failing.
  def delete_body!(actor:)
    with_thread_lock do |root|
      return record if record.deleted_at.present?

      record.reactions.delete_all
      record.comment_mentions.destroy_all
      Notification.remove_for_message!(record)
      record.update! \
        body: nil,
        edited_at: nil,
        deleted_at: Time.current,
        learning_removal_due_at: ReviewComment::LEARNING_REMOVAL_RETRY.from_now
      advance_activity! root, actor
      record.remove_from_learning_store_later!(by: Learning.person_for(actor))
      record
    end
  end

  # Marks this root thread resolved by the authorized reviewer.
  def resolve_by!(actor)
    record.with_lock do
      return record if record.resolved_at.present?

      record.update! \
        resolved_at: Time.current,
        resolved_by: actor
      advance_activity! record, actor
      record_resolution_event!("review_thread_resolved", actor)
      Notification.record_resolution!(record, actor:, kind: "thread_resolved")
      record
    end
  end

  # Reopens this root thread without changing its comments.
  def reopen_by!(actor)
    record.with_lock do
      return record if record.resolved_at.nil?

      record.update! \
        resolved_at: nil,
        resolved_by: nil
      advance_activity! record, actor
      record_resolution_event!("review_thread_reopened", actor)
      Notification.record_resolution!(record, actor:, kind: "thread_reopened")
      record
    end
  end

  # Adds one fixed reaction and records the thread version shown to the reviewer.
  def add_reaction!(user:, content:, activity_version:)
    record.with_lock do
      record.errors.add(:base, "Deleted comments cannot receive reactions") if record.deleted_at.present?
      raise ActiveRecord::RecordInvalid, record if record.errors.any?

      reaction = record.reactions.find_or_create_by! \
        user: user,
        content: content
      if reaction.previously_new_record?
        Notification.record_reaction!(reaction)
        Analytics::Event.record! \
          repository: record.prototype.repository,
          name: "review_reaction_added",
          source_key: "reaction/#{reaction.id}/added",
          actor_id: Analytics.actor_id(user:),
          properties: record.analytics_properties
      end
      record_observed_activity! \
        user,
        activity_version
      reaction
    end
  end

  # Removes one reaction and records the thread version shown to the reviewer.
  def remove_reaction!(user:, content:, activity_version:)
    record.with_lock do
      reaction = record.reactions.find_by!(user:, content:)
      reaction.destroy!
      record_observed_activity! \
        user,
        activity_version
      reaction
    end
  end

  # Records the activity version this reviewer has seen.
  def record_read_by!(actor, activity_version:)
    root = thread_root
    root.with_lock do
      ReviewThreadRead.record! \
        root:,
        user: actor,
        activity_version:
    end
  end

  # Marks only this reviewer's thread unread without changing thread activity.
  def record_unread_by!(actor)
    root = thread_root
    root.with_lock do
      root.thread_reads.where(user: actor).destroy_all
    end
  end

  private

  # Uses the locked thread version to identify each real resolution transition.
  def record_resolution_event!(name, actor)
    record.prototype.repository.with_lock do
      Analytics::Event.record! \
        repository: record.prototype.repository,
        name:,
        source_key: "thread/#{record.id}/#{record.activity_version}/#{name}",
        actor_id: Analytics.actor_id(user: actor),
        properties: { prototype_id: record.prototype_id, thread_id: record.id, build_id: record.build_id }
    end
  end

  # Locks the root before changing either the root or one of its replies.
  def with_thread_lock
    root = thread_root
    root.with_lock do
      record.lock! if record != root
      yield root
    end
  end

  # Returns the root that owns this message's thread activity.
  def thread_root
    record.root_comment? ? record : record.root
  end

  # Records the version shown to the reviewer without advancing thread activity.
  def record_observed_activity!(actor, activity_version)
    ReviewThreadRead.record! \
      root: thread_root,
      user: actor,
      activity_version:
  end

  # Advances thread activity and keeps the actor caught up with that change.
  def advance_activity!(root, actor)
    root.update! activity_version: root.activity_version + 1
    ReviewThreadRead.record! \
      root:,
      user: actor,
      activity_version: root.activity_version
  end
end
