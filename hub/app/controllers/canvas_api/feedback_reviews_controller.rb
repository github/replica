# Verifies current repository maintainer access before the plugin requests a review.
class CanvasApi::FeedbackReviewsController < CanvasApi::BaseController
  # @route POST /api/canvas/feedback_review (canvas_api_feedback_review)
  def create
    unless @repository.authorization.sufficient?(@repository_permission, minimum: :maintain)
      return render json: { error: "Reviewing repository feedback requires GitHub Admin or Maintain access." },
        status: :forbidden
    end

    render json: {
      repository: @repository.name_with_owner,
      canReviewFeedback: true,
      viewerLogin: Current.user.login
    }
  end
end
