# Shares pagination and serialization without selecting an authentication or prototype context.
module ReviewCommentPages
  extend ActiveSupport::Concern

  included do
    rescue_from ReviewComment::InvalidPagination, with: :invalid_pagination
    rescue_from ReviewComment::ResponseTooLarge, with: -> { head :content_too_large }
  end

  private

  def improvement_notes_filter
    value = params[:improvement_notes] || "exclude"
    raise ReviewComment::InvalidPagination unless %w[exclude include only].include?(value)

    value
  end

  def pagination_cursor
    cursor = params[:cursor]
    raise ReviewComment::InvalidPagination if cursor.present? && !cursor.is_a?(String)

    cursor
  end

  def page_size
    value = params[:pageSize]
    return ReviewComment::DEFAULT_PAGE_SIZE if value.nil?
    raise ReviewComment::InvalidPagination if !value.is_a?(String) || !value.match?(/\A[1-9]\d*\z/)

    value = value.to_i
    raise ReviewComment::InvalidPagination if value > ReviewComment::MAXIMUM_PAGE_SIZE

    value
  end

  def invalid_pagination
    head :bad_request
  end

  def review_comment_json(comment)
    payload = {
      id: comment.id,
      kind: comment.root_comment? ? "root" : "reply",
      body: comment.body,
      mentions: comment.comment_mentions.map { { login: _1.login, githubId: _1.github_identity.github_id } },
      createdAt: comment.created_at.iso8601(6),
      updatedAt: comment.updated_at.iso8601(6),
      editedAt: comment.edited_at&.iso8601(6),
      deletedAt: comment.deleted_at&.iso8601(6),
      author: author_json(comment.user),
      viewerCanEdit: comment.editable_by?(Current.user),
      viewerCanDelete: comment.editable_by?(Current.user),
      reactions: reaction_json(comment)
    }
    return payload.merge(rootId: comment.root_id) if comment.reply?

    viewer_read = viewer_thread_read(comment)
    build_path = repository_prototype_path \
      @repository.route_id,
      @prototype || comment.prototype,
      build: comment.build.number
    payload.merge \
      buildNumber: comment.build.number,
      buildPath: build_path,
      anchor: comment.anchor,
      resolvedAt: comment.resolved_at&.iso8601(6),
      resolvedBy: comment.resolved_by ? author_json(comment.resolved_by) : nil,
      activityVersion: comment.activity_version,
      viewerLastSeenActivityVersion: viewer_read&.last_seen_activity_version
  end

  def prepare_viewer_thread_reads(comments)
    root_ids = comments.filter_map { _1.id if _1.is_a?(ReviewComment) && _1.root_comment? }
    @viewer_thread_reads = ReviewThreadRead.where \
      root_id: root_ids,
      user: Current.user
    @viewer_thread_reads = @viewer_thread_reads.index_by(&:root_id)
  end

  def viewer_thread_read(root)
    return @viewer_thread_reads[root.id] if defined?(@viewer_thread_reads)

    root.thread_reads.find_by(user: Current.user)
  end

  def reaction_json(comment)
    reactions = comment.reactions.group_by(&:content)
    ReviewCommentReaction::CONTENTS.filter_map do |content|
      matching = reactions[content]
      next if matching.blank?

      {
        content:,
        count: matching.length,
        viewerHasReacted: matching.any? { _1.user_id == Current.user.id }
      }
    end
  end

  def author_json(user)
    {
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url
    }
  end
end
