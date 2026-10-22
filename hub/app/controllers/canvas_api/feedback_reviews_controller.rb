# Verifies current repository access before the plugin requests a review.
class CanvasApi::FeedbackReviewsController < CanvasApi::BaseController
  # @route POST /api/canvas/feedback_review (canvas_api_feedback_review)
  def create
    render json: {
      repository: @repository.name_with_owner,
      canReviewFeedback: true,
      viewerLogin: Current.user.login
    }
  end
end
