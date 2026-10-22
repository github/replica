class CanvasApi::RepositoryReviewCommentsController < CanvasApi::BaseController
  include CanvasCommentResponses

  # @route GET /api/canvas/repositories/:repository_github_id/review_comments (canvas_api_repository_review_comments)
  def index
    filter = improvement_notes_filter
    comments = canvas_comments_for(@repository.reviewable_prototypes, filter:)
    prepare_viewer_thread_reads(comments)
    render json: {
      comments: comments.map do |comment|
        prototype = comment.prototype
        canvas_comment_json(comment).merge \
          prototype: { id: prototype.id, name: prototype.name, branch: prototype.branch_name }
      end,
      nextCursor: nil,
      hasMore: false
    }
  end
end
