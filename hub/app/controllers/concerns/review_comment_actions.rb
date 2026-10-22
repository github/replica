# Shares comment actions while each controller retains its own authentication.
module ReviewCommentActions
  extend ActiveSupport::Concern

  include HasReviewCommentContext
  include ReviewCommentMutations
  include CanvasCommentResponses

  included do
    prepend_before_action :reject_large_request, only: %i[create update]
  end

  # @route GET /repositories/:repository_github_id/prototypes/:prototype_id/review_comments (repository_prototype_review_comments)
  # @route GET /api/canvas/repositories/:repository_github_id/prototypes/:prototype_id/review_comments (canvas_api_review_comments)
  def index
    filter = is_a?(CanvasApi::BaseController) ? improvement_notes_filter : "exclude"
    comments = canvas_comments_for(@prototype, filter:)
    prepare_viewer_thread_reads(comments)
    render json: { comments: comments.map { canvas_comment_json(_1) }, nextCursor: nil, hasMore: false }
  end

  # @route POST /repositories/:repository_github_id/prototypes/:prototype_id/review_comments (repository_prototype_review_comments)
  # @route POST /api/canvas/repositories/:repository_github_id/prototypes/:prototype_id/review_comments (canvas_api_review_comments)
  def create
    attributes = review_comment_params
    build = @prototype.builds.where(state: "successful").find_by! \
      number: positive_build_number(attributes[:build_number])
    comment = ReviewComment.create_with_mentions! \
      prototype: @prototype,
      build:,
      user: Current.user,
      body: attributes[:body],
      anchor: attributes[:anchor]

    render_review_comment_change comment, status: :created
  end

  # @route PATCH /repositories/:repository_github_id/prototypes/:prototype_id/review_comments/:id (repository_prototype_review_comment)
  # @route PUT /repositories/:repository_github_id/prototypes/:prototype_id/review_comments/:id (repository_prototype_review_comment)
  # @route PATCH /api/canvas/repositories/:repository_github_id/prototypes/:prototype_id/review_comments/:id (canvas_api_review_comment)
  # @route PUT /api/canvas/repositories/:repository_github_id/prototypes/:prototype_id/review_comments/:id (canvas_api_review_comment)
  def update
    comment = @prototype.review_comments.find(params[:id])
    return head :forbidden if !comment.editable_by?(Current.user)

    comment.thread.edit_body! comment_body, actor: Current.user
    render_review_comment_change comment
  end

  # @route DELETE /repositories/:repository_github_id/prototypes/:prototype_id/review_comments/:id (repository_prototype_review_comment)
  # @route DELETE /api/canvas/repositories/:repository_github_id/prototypes/:prototype_id/review_comments/:id (canvas_api_review_comment)
  def destroy
    comment = @prototype.review_comments.find(params[:id])
    return head :forbidden if comment.user_id != Current.user.id

    comment.thread.delete_body! actor: Current.user
    render_review_comment_change comment
  end

  private

  def review_comment_params
    reject_note_thread_parameters!
    params.require(:review_comment).permit(:build_number, :body, anchor: {})
  end

  def positive_build_number(value)
    string = value.to_s
    raise ActiveRecord::RecordNotFound if !string.match?(/\A[1-9]\d*\z/)

    string.to_i
  end
end
