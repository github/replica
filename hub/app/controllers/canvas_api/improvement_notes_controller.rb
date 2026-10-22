class CanvasApi::ImprovementNotesController < CanvasApi::BaseController
  include HasReviewCommentContext
  include ReviewCommentMutations
  include ImprovementNoteResponses

  prepend_before_action -> { reject_large_request(maximum: 1_600_000) }, only: :create
  before_action :require_writer, only: :create
  rescue_from ActiveRecord::RecordInvalid, with: :invalid_note
  rescue_from ImprovementComment::Conflict, with: ->(error) { render json: { error: error.message }, status: :conflict }

  # @route GET /api/canvas/repositories/:repository_github_id/prototypes/:prototype_id/improvement_notes (canvas_api_improvement_notes)
  def index
    notes = @prototype.improvement_notes.where(user: Current.user)
      .includes(:build, :user, replies: { request_links: :request }).order(created_at: :desc, id: :desc)
    render json: { notes: notes.map { improvement_note_json(_1) } }
  end

  # @route POST /api/canvas/repositories/:repository_github_id/prototypes/:prototype_id/improvement_notes (canvas_api_improvement_notes)
  def create
    revision = params[:revision]
    previous_revision = params[:previous_revision]
    return head :bad_request unless revision.is_a?(Integer) && revision.positive?
    return head :bad_request unless previous_revision.is_a?(Integer) && previous_revision >= 0
    return head :bad_request unless [ true, false ].include?(params[:deleted])
    return head :bad_request unless params[:anchor].is_a?(ActionController::Parameters)
    return head :bad_request unless params[:thread].is_a?(ActionController::Parameters)
    return head :bad_request if params.key?(:note_thread)
    return head :bad_request if %i[local_id body status].any? { !params[_1].nil? && !params[_1].is_a?(String) }
    if params.key?(:build_number) && (!params[:build_number].is_a?(Integer) || !params[:build_number].positive?)
      return head :bad_request
    end

    attributes = params.permit(:local_id, :revision, :previous_revision, :build_number, :body, :status, :deleted).to_h.symbolize_keys
    attributes[:anchor] = params[:anchor].to_unsafe_h
    attributes[:thread] = params[:thread].to_unsafe_h
    note = ImprovementComment.synchronize!(prototype: @prototype, user: Current.user, attributes:)
    render json: improvement_note_json(note), status: :ok
  end

  private

  def load_prototype
    @prototype = @repository.reviewable_prototypes.find(params[:prototype_id])
  end

  def invalid_note(error)
    render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
  end
end
